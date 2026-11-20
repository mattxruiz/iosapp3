import ExpoModulesCore
import UIKit

public class BlacRecHomeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BlacRecHome")

    Function("goHome") {
      DispatchQueue.main.async {
        // Soft-suspend to SpringBoard (sideloaded builds). Not App Store–safe.
        UIApplication.shared.perform(NSSelectorFromString("suspend"))
      }
    }
  }
}
