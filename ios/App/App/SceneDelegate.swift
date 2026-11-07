import UIKit
import Capacitor

/// UIScene lifecycle entry point.
///
/// Apps built with the iOS 26+ SDK must adopt the scene lifecycle: on iOS 27
/// UIKit terminates an app at launch (`EXC_BREAKPOINT` in
/// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`) when its
/// Info.plist has no `UIApplicationSceneManifest`. The window and the root
/// `MainViewController` still come from Main.storyboard — the manifest names
/// it as the scene's storyboard — so this class only has to hold the window
/// and forward URL / user-activity events to Capacitor, which the app
/// delegate's old `open url` / `continue userActivity` hooks no longer
/// receive under scenes.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
