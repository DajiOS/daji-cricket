import ExpoModulesCore
import Intents
import IntentsUI
import UIKit

// Add to Siri for one voice action (mobile/src/voice.ts). The shortcut is an NSUserActivity that carries only the action id and the
// app link: no booking, money or customer data, and it is never offered to Spotlight search. When Siri runs it, the app opens at the
// link (DajiVoiceAppDelegate) and the screen does the rest with the person's normal sign-in.
let dajiVoiceActivityType = (Bundle.main.bundleIdentifier ?? "com.dajicricket") + ".voice"

private func makeActivity(action: String, title: String, phrase: String, url: String) -> NSUserActivity {
  let a = NSUserActivity(activityType: dajiVoiceActivityType)
  a.title = title
  a.userInfo = ["action": action, "url": url]
  a.requiredUserInfoKeys = ["action", "url"]
  a.isEligibleForSearch = false
  a.isEligibleForHandoff = false
  a.isEligibleForPublicIndexing = false
  a.isEligibleForPrediction = true // needed for a voice shortcut; the app never donates it, so Siri does not suggest it on its own
  a.suggestedInvocationPhrase = phrase
  a.persistentIdentifier = "\(dajiVoiceActivityType).\(action)"
  return a
}

public class DajiVoiceModule: Module {
  private var delegate: SiriDelegate?

  public func definition() -> ModuleDefinition {
    Name("DajiVoice")

    Function("isAvailable") { () -> Bool in true }

    AsyncFunction("listPhrases") { (promise: Promise) in
      INVoiceShortcutCenter.shared.getAllVoiceShortcuts { list, _ in
        let out: [[String: String]] = (list ?? []).compactMap { v in
          guard let act = v.shortcut.userActivity, act.activityType == dajiVoiceActivityType, let id = act.userInfo?["action"] as? String else { return nil }
          return ["action": id, "phrase": v.invocationPhrase]
        }
        promise.resolve(out)
      }
    }

    AsyncFunction("addToSiri") { (o: [String: String], promise: Promise) in
      guard let action = o["action"], let title = o["title"], let phrase = o["phrase"], let url = o["url"] else {
        promise.reject("ERR_VOICE_ARGS", "Missing action, title, phrase or url"); return
      }
      INVoiceShortcutCenter.shared.getAllVoiceShortcuts { list, _ in
        let existing = (list ?? []).first { v in
          v.shortcut.userActivity?.activityType == dajiVoiceActivityType && (v.shortcut.userActivity?.userInfo?["action"] as? String) == action
        }
        DispatchQueue.main.async {
          guard let top = Self.topController() else { promise.reject("ERR_VOICE_UI", "The Add to Siri screen could not be shown"); return }
          let d = SiriDelegate(promise: promise) { [weak self] in self?.delegate = nil }
          self.delegate = d
          if let v = existing {
            let vc = INUIEditVoiceShortcutViewController(voiceShortcut: v)
            vc.delegate = d
            top.present(vc, animated: true)
          } else {
            let vc = INUIAddVoiceShortcutViewController(shortcut: INShortcut(userActivity: makeActivity(action: action, title: title, phrase: phrase, url: url)))
            vc.delegate = d
            top.present(vc, animated: true)
          }
        }
      }
    }.runOnQueue(.main)
  }

  static func topController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
    var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
    while let p = top?.presentedViewController { top = p }
    return top
  }
}

private class SiriDelegate: NSObject, INUIAddVoiceShortcutViewControllerDelegate, INUIEditVoiceShortcutViewControllerDelegate {
  let promise: Promise
  let done: () -> Void
  init(promise: Promise, done: @escaping () -> Void) { self.promise = promise; self.done = done }
  private func finish(_ vc: UIViewController, _ result: String) { vc.dismiss(animated: true) { self.promise.resolve(result); self.done() } }

  func addVoiceShortcutViewController(_ vc: INUIAddVoiceShortcutViewController, didFinishWith voiceShortcut: INVoiceShortcut?, error: Error?) {
    if let error = error { vc.dismiss(animated: true) { self.promise.reject("ERR_VOICE_ADD", error.localizedDescription); self.done() }; return }
    finish(vc, voiceShortcut == nil ? "cancelled" : "added")
  }
  func addVoiceShortcutViewControllerDidCancel(_ vc: INUIAddVoiceShortcutViewController) { finish(vc, "cancelled") }
  func editVoiceShortcutViewController(_ vc: INUIEditVoiceShortcutViewController, didUpdate voiceShortcut: INVoiceShortcut?, error: Error?) {
    if let error = error { vc.dismiss(animated: true) { self.promise.reject("ERR_VOICE_EDIT", error.localizedDescription); self.done() }; return }
    finish(vc, "updated")
  }
  func editVoiceShortcutViewController(_ vc: INUIEditVoiceShortcutViewController, didDeleteVoiceShortcutWithIdentifier deletedVoiceShortcutIdentifier: UUID) { finish(vc, "deleted") }
  func editVoiceShortcutViewControllerDidCancel(_ vc: INUIEditVoiceShortcutViewController) { finish(vc, "cancelled") }
}

/// When Siri runs a recorded phrase, iOS hands the app its activity: open the app link it carries, the same way a tapped link would.
public class DajiVoiceAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    guard userActivity.activityType == dajiVoiceActivityType, let s = userActivity.userInfo?["url"] as? String, let url = URL(string: s), Self.isOwnLink(url) else { return false }
    DispatchQueue.main.async { UIApplication.shared.open(url) }
    return true
  }
  /// Only this app's own voice links (<scheme>://voice/...), never any other address.
  static func isOwnLink(_ url: URL) -> Bool {
    let schemes = ((Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]]) ?? []).flatMap { ($0["CFBundleURLSchemes"] as? [String]) ?? [] }
    return url.host == "voice" && schemes.contains(url.scheme ?? "")
  }
}
