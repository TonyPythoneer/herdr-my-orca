import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]) else { fail("Usage: ax-press PID LABEL") }
guard AXIsProcessTrusted() else { fail("macOS Accessibility permission unavailable; no interaction performed") }
let wanted = CommandLine.arguments[2]
let app = AXUIElementCreateApplication(pid)
func value(_ e: AXUIElement, _ key: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, key as CFString, &v) == .success ? v : nil
}
var visited = Set<AXUIElement>()
var matches: [AXUIElement] = []
func walk(_ e: AXUIElement, _ depth: Int) {
    guard depth < 40, visited.count < 4000, visited.insert(e).inserted else { return }
    let labels = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute].compactMap { value(e, $0) as? String }
    var actions: CFArray?
    if labels.contains(wanted),
       AXUIElementCopyActionNames(e, &actions) == .success,
       (actions as? [String])?.contains(kAXPressAction) == true {
        matches.append(e)
    }
    for child in (value(e,kAXChildrenAttribute) as? [AXUIElement] ?? []) { walk(child,depth+1) }
}
walk(app,0)
guard matches.count == 1 else { fail("Expected exactly one actionable AX element '\(wanted)', found \(matches.count)") }
guard AXUIElementPerformAction(matches[0],kAXPressAction as CFString) == .success else { fail("AXPress failed for \(wanted)") }
print("AXPress: \(wanted)")
