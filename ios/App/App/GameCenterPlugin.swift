import Foundation
import GameKit
import Capacitor

/// Game Center bridge for the global leaderboard.
///
/// An app-local Capacitor plugin (no npm package): registered on the bridge by
/// `MainViewController`, called from `src/engine/Leaderboard.ts` as
/// `registerPlugin('GameCenter')`. Kept deliberately tiny — sign in, submit a
/// score, read the top of one leaderboard.
///
/// The leaderboard itself (ID passed from JS) lives in App Store Connect →
/// Game Center, configured as "Best score", sorted high → low.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadTop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievements", returnType: CAPPluginReturnPromise)
    ]

    /// Calls waiting on the first authentication result. GameKit invokes the
    /// authenticate handler more than once over the app's life (e.g. after the
    /// player signs in from Settings), so pending calls are drained per result.
    private var pendingAuth: [CAPPluginCall] = []
    private var handlerInstalled = false

    private func playerInfo() -> [String: Any] {
        let p = GKLocalPlayer.local
        return [
            "authenticated": p.isAuthenticated,
            "playerId": p.isAuthenticated ? p.gamePlayerID : "",
            "alias": p.isAuthenticated ? p.alias : ""
        ]
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        if GKLocalPlayer.local.isAuthenticated {
            call.resolve(playerInfo())
            return
        }
        DispatchQueue.main.async {
            self.pendingAuth.append(call)
            guard !self.handlerInstalled else { return }
            self.handlerInstalled = true

            GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, _ in
                guard let self = self else { return }
                if let vc = viewController {
                    // Player isn't signed in: show Apple's sign-in sheet. The
                    // handler fires again with the outcome.
                    self.bridge?.viewController?.present(vc, animated: true)
                    return
                }
                let info = self.playerInfo()
                let waiting = self.pendingAuth
                self.pendingAuth.removeAll()
                waiting.forEach { $0.resolve(info) }
                self.notifyListeners("authChanged", data: info)
            }
        }
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard let leaderboardId = call.getString("leaderboardId"),
              let score = call.getInt("score") else {
            call.reject("leaderboardId and score are required")
            return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not signed in to Game Center")
            return
        }
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local,
                                  leaderboardIDs: [leaderboardId]) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func loadTop(_ call: CAPPluginCall) {
        guard let leaderboardId = call.getString("leaderboardId") else {
            call.reject("leaderboardId is required")
            return
        }
        let count = max(1, min(call.getInt("count") ?? 20, 100))
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not signed in to Game Center")
            return
        }

        GKLeaderboard.loadLeaderboards(IDs: [leaderboardId]) { boards, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            guard let board = boards?.first else {
                call.reject("Leaderboard \(leaderboardId) not found")
                return
            }
            board.loadEntries(for: .global, timeScope: .allTime,
                              range: NSRange(location: 1, length: count)) { local, entries, _, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                let me = GKLocalPlayer.local.gamePlayerID
                func row(_ e: GKLeaderboard.Entry) -> [String: Any] {
                    return [
                        "rank": e.rank,
                        "alias": e.player.alias,
                        "score": e.score,
                        "you": e.player.gamePlayerID == me
                    ]
                }
                var result: [String: Any] = ["entries": (entries ?? []).map(row)]
                if let local = local { result["local"] = row(local) }
                call.resolve(result)
            }
        }
    }

    /// `achievements: [{ id, percent }]` — percent 0…100. Game Center keeps
    /// the highest value ever reported, so re-sending is harmless; Apple shows
    /// its own banner when one reaches 100.
    @objc func reportAchievements(_ call: CAPPluginCall) {
        guard let items = call.getArray("achievements", JSObject.self), !items.isEmpty else {
            call.reject("achievements are required")
            return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not signed in to Game Center")
            return
        }
        let achievements: [GKAchievement] = items.compactMap { item in
            guard let id = item["id"] as? String else { return nil }
            let a = GKAchievement(identifier: id)
            a.percentComplete = max(0, min((item["percent"] as? Double) ?? 0, 100))
            a.showsCompletionBanner = true
            return a
        }
        GKAchievement.report(achievements) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }
}
