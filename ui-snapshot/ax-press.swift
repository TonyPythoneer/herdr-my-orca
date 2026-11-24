import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
guard [3,5].contains(CommandLine.arguments.count),
      let pid = Int32(CommandLine.arguments[1]) else { fail("Usage: ax-press PID LABEL") }
guard AXIsProcessTrusted() else { fail("macOS Accessibility permission unavailable; no interaction performed") }
let wanted = CommandLine.arguments[2]
if wanted == "--welcome-close" {
    guard CommandLine.arguments.count == 5,
          let width = Double(CommandLine.arguments[3]), let height = Double(CommandLine.arguments[4]),
          width > 0, height > 0 else { fail("Missing screenshot dimensions") }
    guard let running = NSRunningApplication(processIdentifier: pid),
          let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]]
    else { fail("No native window list") }
    let bounds = windows.compactMap { entry -> CGRect? in
        guard (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (entry[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let dict = entry[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: dict as CFDictionary),
              rect.width > 300, rect.height > 200 else { return nil }
        return rect
    }.sorted { $0.width*$0.height > $1.width*$1.height }
    guard let window = bounds.first, abs(window.width/window.height-width/height) < 0.05 else {
        fail("Native window geometry does not match screenshot; refusing blind click")
    }
    guard abs(width/height - 1024.0/681.0) < 0.05 else { fail("Welcome geometry changed; refusing blind click") }
    _ = running.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    Thread.sleep(forTimeInterval: 0.2)
    let point = CGPoint(x:window.minX+window.width*817/1024, y:window.minY+window.height*67/681)
    guard let down = CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left),
          let up = CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left)
    else { fail("Could not create click event") }
    down.postToPid(pid)
    up.postToPid(pid)
    print("Native welcome close click")
    exit(0)
}
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
