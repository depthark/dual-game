import Foundation
import StoreKit
import Capacitor

/// StoreKit 2 bridge for the one-time "Full Game" unlock (levels 6–10).
///
/// An app-local Capacitor plugin like `GameCenterPlugin`: registered by
/// `MainViewController`, called from `src/engine/Store.ts` as
/// `registerPlugin('Store')`. Apple handles the whole purchase, so the app
/// never sees payment details and no third-party SDK is involved.
///
/// Players who first installed DUAL 1.0 (build 9 or earlier) got all ten
/// levels for free and keep them: `AppTransaction.originalAppVersion` is the
/// CFBundleVersion of the build they first downloaded. Only trusted in the
/// production environment — in TestFlight and Xcode it is always "1.0", which
/// would otherwise grandfather every tester and hide the paywall.
@objc(StorePlugin)
public class StorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorePlugin"
    public let jsName = "Store"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    static let productId = "com.lukaschylik.dualmind.fullgame"
    /// Last build number of version 1.0, which shipped with every level free.
    static let lastFreeBuild = 9

    private var updates: Task<Void, Never>?

    override public func load() {
        // Purchases that complete outside a purchase() call: Ask to Buy
        // approvals, Family Sharing, a purchase made on another device.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let tx) = result else { continue }
                await tx.finish()
                if tx.productID == StorePlugin.productId {
                    let unlocked = await StorePlugin.ownsFullGame()
                    self?.notifyListeners("unlockChanged", data: ["unlocked": unlocked])
                }
            }
        }
    }

    deinit { updates?.cancel() }

    // MARK: - entitlement checks

    static func ownsFullGame() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let tx) = result, tx.productID == productId, tx.revocationDate == nil {
                return true
            }
        }
        return false
    }

    /// nil = could not tell (iOS 15, or App Store unreachable on first launch).
    static func isLegacyPlayer() async -> Bool? {
        guard #available(iOS 16.0, *) else { return nil }
        guard let result = try? await AppTransaction.shared,
              case .verified(let app) = result else { return nil }
        guard app.environment == .production else { return false }
        guard let build = Double(app.originalAppVersion) else { return nil }
        return build <= Double(lastFreeBuild)
    }

    private func product() async throws -> Product {
        let products = try await Product.products(for: [StorePlugin.productId])
        guard let p = products.first else {
            throw NSError(domain: "Store", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Product unavailable"])
        }
        return p
    }

    private func statusPayload() async -> [String: Any] {
        var out: [String: Any] = ["unlocked": await StorePlugin.ownsFullGame()]
        if let legacy = await StorePlugin.isLegacyPlayer() { out["legacy"] = legacy }
        if let p = try? await product() { out["price"] = p.displayPrice }
        return out
    }

    // MARK: - plugin methods

    /// { unlocked, legacy?, price? }
    @objc func status(_ call: CAPPluginCall) {
        Task { call.resolve(await self.statusPayload()) }
    }

    /// { unlocked, cancelled? }
    @objc func purchase(_ call: CAPPluginCall) {
        Task {
            do {
                let p = try await self.product()
                switch try await p.purchase() {
                case .success(let result):
                    guard case .verified(let tx) = result else {
                        call.reject("Purchase could not be verified")
                        return
                    }
                    await tx.finish()
                    call.resolve(["unlocked": true])
                case .userCancelled:
                    call.resolve(["unlocked": false, "cancelled": true])
                case .pending:
                    // Ask to Buy: Transaction.updates fires once a parent approves.
                    call.resolve(["unlocked": false, "pending": true])
                @unknown default:
                    call.resolve(["unlocked": false])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// App Store sync (may ask for the Apple ID password), then a fresh status.
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(await self.statusPayload())
        }
    }
}
