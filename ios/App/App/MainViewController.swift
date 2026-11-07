import UIKit
import Capacitor

/// Bridge view controller (set as the root in Main.storyboard). Exists only to
/// register the app-local plugins that don't ship as npm packages.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}
