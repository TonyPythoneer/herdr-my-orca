import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
guard [3,7].contains(CommandLine.arguments.count),
      let pid = Int32(CommandLine.arguments[1]) else { fail("Usage: ax-press PID LABEL") }
guard AXIsProcessTrusted() else { fail("macOS Accessibility permission unavailable; no interaction performed") }
let wanted = CommandLine.arguments[2]
if wanted == "--escape" {
    guard let running = NSRunningApplication(processIdentifier: pid) else { fail("Missing target app") }
    _ = running.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    Thread.sleep(forTimeInterval:0.2)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
          let down = CGEvent(keyboardEventSource:nil,virtualKey:53,keyDown:true),
          let up = CGEvent(keyboardEventSource:nil,virtualKey:53,keyDown:false)
    else { fail("Cannot send Escape to foreground Herdr") }
    down.post(tap:.cghidEventTap)
    up.post(tap:.cghidEventTap)
    print("Native Escape")
    exit(0)
}
if ["--click","--right-click","--move"].contains(wanted) {
    guard CommandLine.arguments.count == 7,
          let x = Double(CommandLine.arguments[3]), let y = Double(CommandLine.arguments[4]),
          let w = Double(CommandLine.arguments[5]), let h = Double(CommandLine.arguments[6]),
          x >= 0, y >= 0, x < w, y < h,
          let running = NSRunningApplication(processIdentifier: pid)
    else { fail("Invalid mouse target") }
    _ = running.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    Thread.sleep(forTimeInterval: 0.35)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
          let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]]
    else { fail("Herdr is not the foreground app") }
    let windows = entries.compactMap { entry -> CGRect? in
        guard (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (entry[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let dict = entry[kCGWindowBounds as String] as? NSDictionary,
              let r = CGRect(dictionaryRepresentation: dict as CFDictionary),
              abs(r.width-w)<2, abs(r.height-h)<2 else { return nil }
        return r
    }
    guard windows.count == 1 else { fail("Window geometry does not match calibrated screenshot") }
    let p = CGPoint(x:windows[0].minX+x,y:windows[0].minY+y)
    let right = wanted == "--right-click"
    let button: CGMouseButton = right ? .right : .left
    guard let move = CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:p,mouseButton:button),
          let down = CGEvent(mouseEventSource:nil,mouseType:right ? .rightMouseDown : .leftMouseDown,mouseCursorPosition:p,mouseButton:button),
          let up = CGEvent(mouseEventSource:nil,mouseType:right ? .rightMouseUp : .leftMouseUp,mouseCursorPosition:p,mouseButton:button)
    else { fail("Cannot create native mouse events") }
    move.post(tap:.cghidEventTap)
    if wanted == "--move" { exit(0) }
    Thread.sleep(forTimeInterval:0.12)
    down.post(tap:.cghidEventTap)
    Thread.sleep(forTimeInterval:0.08)
    up.post(tap:.cghidEventTap)
    print("Native mouse click \(x),\(y)")
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
