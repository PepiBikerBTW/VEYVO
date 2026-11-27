import UIKit
import Capacitor

/// VEYVO's root view controller: Capacitor's bridge plus the app's own Swift plugins.
///
/// - `VeyvoWorkoutKitPlugin` -> `Capacitor.Plugins.VeyvoWorkoutKit` (Apple Watch, WorkoutKit, iOS 17+)
/// - `VeyvoHealthPlugin`     -> `Capacitor.Plugins.VeyvoHealth` (Apple Health, HealthKit, read only)
///
/// `SceneDelegate` creates it (Capacitor 8.5+ UIScene template); `Base.lproj/Main.storyboard` names
/// it as well. Local plugins are registered here as instances: Capacitor's automatic registration
/// only knows npm plugins (`packageClassList` in the generated `capacitor.config.json`), and
/// `registerPluginType` does nothing while automatic registration is on.
class VeyvoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(VeyvoWorkoutKitPlugin())
        bridge?.registerPluginInstance(VeyvoHealthPlugin())
    }
}
