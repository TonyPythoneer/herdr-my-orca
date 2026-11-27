import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
guard [3,4,5,7,8].contains(CommandLine.arguments.count),
      let pid = Int32(CommandLine.arguments[1]) else { fail("Usage: ax-press PID LABEL") }
guard AXIsProcessTrusted() else { fail("macOS Accessibility permission unavailable; no interaction performed") }
let wanted = CommandLine.arguments[2]
let local = ProcessInfo.processInfo.environment["HERDR_SNAPSHOT_LOCAL"] == "1"
let guardInputTarget = local || ProcessInfo.processInfo.environment["HERDR_SNAPSHOT_GUARD_INPUT"] == "1"
let allowNativeResizeDrag = local || ProcessInfo.processInfo.environment["HERDR_SNAPSHOT_RESIZE"] == "1"
func requireForeground(_ pid: Int32) {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
        let frontmost = NSWorkspace.shared.frontmostApplication
        fail("Herdr is not the foreground app: target \(pid), frontmost \(frontmost?.processIdentifier ?? -1) \(frontmost?.localizedName ?? "unknown")")
    }
}
func postInput(_ event: CGEvent) {
    event.post(tap:.cghidEventTap)
}
func activate(_ running: NSRunningApplication) {
    _ = running.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    Thread.sleep(forTimeInterval: 0.2)
}
if wanted == "--focus" {
    guard local, let running = NSRunningApplication(processIdentifier: pid) else { fail("Missing local focus target") }
    activate(running)
    if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
        var error: NSDictionary?
        NSAppleScript(source: "tell application \"System Events\" to set frontmost of first process whose unix id is \(pid) to true")?.executeAndReturnError(&error)
        if let error = error { fail("Cannot focus Herdr: \(error)") }
        Thread.sleep(forTimeInterval: 0.2)
    }
    requireForeground(pid)
    exit(0)
}
if wanted == "--check-focus" {
    guard local else { fail("Focus check requires local mode") }
    requireForeground(pid)
    exit(0)
}
func windowBounds(_ pid: Int32) -> [CGRect] {
    guard let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] else { return [] }
    return entries.compactMap { entry in
        guard (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (entry[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let dict = entry[kCGWindowBounds as String] as? NSDictionary else { return nil }
        return CGRect(dictionaryRepresentation: dict as CFDictionary)
    }
}
func pointTargetsProcess(_ point: CGPoint, _ pid: Int32) -> Bool {
    var element: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &element) == .success,
          let element = element else { return false }
    var owner: pid_t = 0
    return AXUIElementGetPid(element, &owner) == .success && owner == pid
}
if wanted == "--bounds" {
    let windows = windowBounds(pid)
    guard windows.count == 1 else { fail("Expected exactly one visible Herdr window, found \(windows.count): \(windows)") }
    print("[\(windows[0].width),\(windows[0].height)]")
    exit(0)
}
if wanted == "--resize" {
    guard CommandLine.arguments.count == 5,
          let w = Double(CommandLine.arguments[3]), let h = Double(CommandLine.arguments[4]),
          w >= 800, h >= 550 else { fail("Invalid viewport") }
    if local { requireForeground(pid) }
    let app = AXUIElementCreateApplication(pid)
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app,kAXWindowsAttribute as CFString,&raw) == .success,
          let windows = raw as? [AXUIElement], windows.count == 1 else { fail("Unsafe native resize: expected one AX window") }
    var current = windowBounds(pid)
    guard current.count == 1 else { fail("Unsafe native resize: expected one visible window for resize, found \(current)") }
    let originalFrame = current[0]
    var size = CGSize(width:w,height:h)
    var settable: DarwinBoolean = false
    let settableResult = AXUIElementIsAttributeSettable(windows[0],kAXSizeAttribute as CFString,&settable)
    var resized = false
    if settableResult == .success, settable.boolValue, let value = AXValueCreate(.cgSize,&size) {
        resized = AXUIElementSetAttributeValue(windows[0], kAXSizeAttribute as CFString, value) == .success
    }
    current = windowBounds(pid)
    guard current.count == 1 else {
        fail("Unsafe native resize: expected one visible window after AX request, found \(current)")
    }
    guard abs(current[0].minX-originalFrame.minX)<1, abs(current[0].minY-originalFrame.minY)<1 else {
        fail("Unsafe native resize: window origin changed after AX request")
    }
    if resized {
        let deadline = Date().addingTimeInterval(1.5)
        repeat {
            Thread.sleep(forTimeInterval:0.1)
            current = windowBounds(pid)
            guard current.count == 1 else {
                fail("Unsafe native resize: expected one visible window while waiting for AX resize, found \(current)")
            }
            guard abs(current[0].minX-originalFrame.minX)<1, abs(current[0].minY-originalFrame.minY)<1 else {
                fail("Unsafe native resize: window origin changed while waiting for AX resize")
            }
            if abs(current[0].width-w)<2, abs(current[0].height-h)<2 {
                if local { requireForeground(pid) }
                exit(0)
            }
        } while Date() < deadline
        resized = false
    }
    guard current.count == 1 else {
        fail("Unsafe native resize: expected one visible window after AX size set, found (current)")
    }
    if !resized {
        guard allowNativeResizeDrag else { fail("AX window does not support resize outside local mode") }
        requireForeground(pid)
        let frame = current[0]
        let start = CGPoint(x:frame.maxX-2,y:frame.maxY-2)
        let finish = CGPoint(x:frame.minX+w-2,y:frame.minY+h-2)
        guard pointTargetsProcess(start, pid) else { fail("Native resize corner is not owned by Herdr") }
        guard let move = CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:start,mouseButton:.left),
              let down = CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:start,mouseButton:.left)
        else { fail("Cannot create native resize drag") }
        postInput(move)
        Thread.sleep(forTimeInterval:0.05)
        let rechecked = windowBounds(pid)
        guard rechecked.count == 1,
              abs(rechecked[0].minX-frame.minX)<1, abs(rechecked[0].minY-frame.minY)<1,
              abs(rechecked[0].width-frame.width)<1, abs(rechecked[0].height-frame.height)<1,
              pointTargetsProcess(start,pid) else { fail("Window moved or resize corner changed before drag") }
        requireForeground(pid)
        postInput(down)
        Thread.sleep(forTimeInterval:0.1)
        let heldFrame = windowBounds(pid)
        let heldCornerOwned = pointTargetsProcess(start,pid)
        let stillForeground = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
        guard heldFrame.count == 1,
              abs(heldFrame[0].minX-frame.minX)<1, abs(heldFrame[0].minY-frame.minY)<1,
              abs(heldFrame[0].width-frame.width)<1, abs(heldFrame[0].height-frame.height)<1,
              heldCornerOwned, stillForeground else {
            if let release = CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:start,mouseButton:.left) { postInput(release) }
            fail("Unsafe native resize: window, corner or foreground changed while dragging")
        }
        guard let drag = CGEvent(mouseEventSource:nil,mouseType:.leftMouseDragged,mouseCursorPosition:finish,mouseButton:.left),
              let up = CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:finish,mouseButton:.left) else {
            let release = CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:start,mouseButton:.left)
            if let release { postInput(release) }
            fail("Cannot create native resize drag events")
        }
        postInput(drag)
        postInput(up)
    }
    Thread.sleep(forTimeInterval:0.3)
    let final = windowBounds(pid)
    guard final.count == 1 else {
        fail("Unsafe native resize: expected one visible window after drag, found \(final)")
    }
    guard abs(final[0].minX-originalFrame.minX)<1, abs(final[0].minY-originalFrame.minY)<1 else {
        fail("Unsafe native resize: window origin changed during drag; bounds=\(final)")
    }
    guard abs(final[0].width-w)<2, abs(final[0].height-h)<2 else {
        fail("Native resize did not reach \(w)x\(h); AX settable=\(settable.boolValue), AX result=\(settableResult.rawValue), bounds=\(final)")
    }
        if allowNativeResizeDrag { requireForeground(pid) }
    exit(0)
}
if wanted == "--paste" {
    guard CommandLine.arguments.count == 4,
          let running=NSRunningApplication(processIdentifier:pid) else { fail("Missing paste target") }
    if !local { activate(running) }
    requireForeground(pid)
    let board=NSPasteboard.general
    let originalCount = board.changeCount
    let saved = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
        let copy = NSPasteboardItem()
        for type in item.types {
            guard let data = item.data(forType:type) else { fail("Cannot preserve clipboard") }
            guard copy.setData(data,forType:type) else { fail("Cannot preserve clipboard") }
        }
        return copy
    }
    guard board.changeCount == originalCount else { fail("Clipboard changed during backup") }
    board.clearContents()
    guard board.setString(CommandLine.arguments[3],forType:.string) else {
        if !saved.isEmpty && !board.writeObjects(saved) { fail("Cannot restore clipboard") }
        fail("Cannot stage fixture text")
    }
    let stagedCount = board.changeCount
    func restoreClipboard() {
        if board.changeCount == stagedCount {
            board.clearContents()
            if !saved.isEmpty && !board.writeObjects(saved) { fail("Cannot restore clipboard") }
        }
    }
    for key: CGKeyCode in [0,9] {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            restoreClipboard()
            fail("Herdr is not the foreground app")
        }
        guard let down=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:true),
              let up=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:false) else {
            restoreClipboard()
            fail("Cannot create key event")
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        postInput(down)
        postInput(up)
        Thread.sleep(forTimeInterval:0.15)
    }
    restoreClipboard()
    exit(0)
}
if wanted == "--key" {
    let codes: [String: CGKeyCode] = ["escape":53,"return":36,"enter":76,"tab":48,"space":49,
        "up":126,"down":125,"left":123,"right":124,"backspace":51,"delete":117,
        "home":115,"end":119,"pageup":116,"pagedown":121]
    guard CommandLine.arguments.count == 4, let code = codes[CommandLine.arguments[3].lowercased()] else {
        fail("Usage: ax-press PID --key escape|return|enter|tab|space|up|down|left|right|backspace|delete|home|end|pageup|pagedown")
    }
    guard let running = NSRunningApplication(processIdentifier: pid) else { fail("Missing target app") }
    if !local { activate(running) }
    requireForeground(pid)
    guard let down = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:true),
          let up = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:false)
    else { fail("Cannot send \(CommandLine.arguments[3]) to foreground Herdr") }
    postInput(down)
    postInput(up)
    print("Native key \(CommandLine.arguments[3].lowercased())")
    exit(0)
}
if wanted == "--escape" {
    guard let running = NSRunningApplication(processIdentifier: pid) else { fail("Missing target app") }
    if !local { activate(running) }
    requireForeground(pid)
    guard let down = CGEvent(keyboardEventSource:nil,virtualKey:53,keyDown:true),
          let up = CGEvent(keyboardEventSource:nil,virtualKey:53,keyDown:false)
    else { fail("Cannot send Escape to foreground Herdr") }
    postInput(down)
    postInput(up)
    print("Native Escape")
    exit(0)
}
if ["--click","--right-click","--move","--scroll"].contains(wanted) {
    guard CommandLine.arguments.count == (wanted == "--scroll" ? 8 : 7),
          let x = Double(CommandLine.arguments[3]), let y = Double(CommandLine.arguments[4]),
          let w = Double(CommandLine.arguments[5]), let h = Double(CommandLine.arguments[6]),
          x >= 0, y >= 0, x < w, y < h,
          let running = NSRunningApplication(processIdentifier: pid)
    else { fail("Invalid mouse target") }
    if !local { activate(running) }
    requireForeground(pid)
    let windows = windowBounds(pid).filter { abs($0.width-w)<2 && abs($0.height-h)<2 }
    guard windows.count == 1 else { fail("Window geometry does not match calibrated screenshot") }
    let p = CGPoint(x:windows[0].minX+x,y:windows[0].minY+y)
    let right = wanted == "--right-click"
    let button: CGMouseButton = right ? .right : .left
    guard let move = CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:p,mouseButton:button),
          let down = CGEvent(mouseEventSource:nil,mouseType:right ? .rightMouseDown : .leftMouseDown,mouseCursorPosition:p,mouseButton:button),
          let up = CGEvent(mouseEventSource:nil,mouseType:right ? .rightMouseUp : .leftMouseUp,mouseCursorPosition:p,mouseButton:button)
    else { fail("Cannot create native mouse events") }
    if local { requireForeground(pid) }
    postInput(move)
    if wanted == "--move" { exit(0) }
    if wanted == "--scroll" {
        guard let amount=Int32(CommandLine.arguments[7]), let event=CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:1,wheel1:amount,wheel2:0,wheel3:0) else { fail("Invalid scroll") }
        event.location=p
        if guardInputTarget {
            requireForeground(pid)
            guard pointTargetsProcess(p,pid) else { fail("Herdr window is not the input target") }
        }
        postInput(event)
        exit(0)
    }
    Thread.sleep(forTimeInterval:0.12)
    if guardInputTarget {
        requireForeground(pid)
        guard windowBounds(pid).contains(where: { $0.contains(p) && abs($0.width-w)<2 && abs($0.height-h)<2 }), pointTargetsProcess(p,pid) else { fail("Herdr window is not the input target") }
    }
    postInput(down)
    Thread.sleep(forTimeInterval:0.08)
    postInput(up)
    print("Native mouse click \(x),\(y)")
    exit(0)
}
if local { requireForeground(pid) }
let app = AXUIElementCreateApplication(pid)
func value(_ e: AXUIElement, _ key: String) -> (CFTypeRef?, AXError) {
    var v: CFTypeRef?
    let result=AXUIElementCopyAttributeValue(e, key as CFString, &v)
    return (result == .success ? v : nil,result)
}
var visited = Set<AXUIElement>()
var matches: [AXUIElement] = []
var traversalErrors: [String] = []
func walk(_ e: AXUIElement, _ depth: Int) {
    guard depth < 40, visited.count < 4000 else {
        traversalErrors.append("AX tree traversal limit reached")
        return
    }
    guard visited.insert(e).inserted else { return }
    var labels: [String] = []
    for key in [kAXTitleAttribute,kAXDescriptionAttribute,kAXHelpAttribute] {
        let (label,result)=value(e,key)
        if let label=label as? String { labels.append(label) }
        else if result != .success && result != .noValue && result != .attributeUnsupported {
            traversalErrors.append("Cannot read AX label: "+String(result.rawValue))
        }
    }
    var actions: CFArray?
    if labels.contains(wanted) {
        let actionResult=AXUIElementCopyActionNames(e,&actions)
        if actionResult == .success {
            if (actions as? [String])?.contains(kAXPressAction) == true { matches.append(e) }
        } else {
            traversalErrors.append("Cannot inspect actions for matching AX element '"+wanted+"'")
        }
    }
    var children: CFTypeRef?
    let childResult=AXUIElementCopyAttributeValue(e,kAXChildrenAttribute as CFString,&children)
    if childResult == .success {
        guard let childElements=children as? [AXUIElement] else {
            traversalErrors.append("Cannot decode AX child tree")
            return
        }
        for child in childElements { walk(child,depth+1) }
    } else if depth == 0 || (childResult != .noValue && childResult != .attributeUnsupported) {
        traversalErrors.append("Cannot inspect AX child tree: "+String(childResult.rawValue))
    }
}
walk(app,0)
guard traversalErrors.isEmpty else { fail("AX lookup incomplete: "+traversalErrors[0]) }
guard matches.count == 1 else { fail("Expected exactly one actionable AX element '\(wanted)', found \(matches.count)") }
if local { requireForeground(pid) }
guard AXUIElementPerformAction(matches[0],kAXPressAction as CFString) == .success else { fail("AXPress failed for \(wanted)") }
print("AXPress: \(wanted)")
