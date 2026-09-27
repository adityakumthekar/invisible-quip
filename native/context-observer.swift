import AppKit
import ApplicationServices
import Foundation

func attr(_ element: AXUIElement, _ key: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
func string(_ element: AXUIElement, _ key: String) -> String { return attr(element, key) as? String ?? "" }
if CommandLine.arguments.contains("--apps") {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && $0.bundleIdentifier != nil }.map { ["bundleId": $0.bundleIdentifier!, "name": $0.localizedName ?? $0.bundleIdentifier!] }
    let data = try JSONSerialization.data(withJSONObject: apps)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}
guard let app = NSWorkspace.shared.frontmostApplication else { print("null"); exit(0) }
let application = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(application, 0.3)
let window = attr(application, kAXFocusedWindowAttribute) as! AXUIElement?
let focused = attr(application, kAXFocusedUIElementAttribute) as! AXUIElement?
let secure = focused.map { string($0, kAXSubroleAttribute) == "AXSecureTextField" } ?? false
let title = window.map { string($0, kAXTitleAttribute) } ?? ""
let document = window.map { string($0, kAXDocumentAttribute) } ?? ""
var texts: [String] = []
var visited = 0
func read(_ element: AXUIElement, _ depth: Int) {
    if depth > 4 || visited >= 120 { return }
    visited += 1
    if string(element, kAXSubroleAttribute) == "AXSecureTextField" { return }
    for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
        let text = string(element, key)
        if !text.isEmpty { texts.append(String(text.prefix(1500))) }
    }
    if let children = attr(element, kAXChildrenAttribute) as? [AXUIElement] {
        for child in children.prefix(30) { read(child, depth + 1) }
    }
}
// Metadata-only probes never walk other applications' content.
let enabled = CommandLine.arguments.dropFirst().contains(app.bundleIdentifier ?? "")
if enabled && !secure, let focused = focused { read(focused, 0) }
if enabled && !secure, let window = window { read(window, 0) }
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let match = windows.first { info in
    (info[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) &&
    (info[kCGWindowLayer as String] as? Int) == 0 &&
    (info[kCGWindowName as String] as? String ?? "") == title
}
let rect = match?[kCGWindowBounds as String] as? [String: Any] ?? [:]
let bounds = ["x": rect["X"] as? Double ?? 0, "y": rect["Y"] as? Double ?? 0, "width": rect["Width"] as? Double ?? 0, "height": rect["Height"] as? Double ?? 0]
let result: [String: Any] = [
    "app": ["bundleId": app.bundleIdentifier ?? "", "name": app.localizedName ?? "Unknown"],
    "window": ["title": title, "document": document, "id": match?[kCGWindowNumber as String] as? Int ?? 0, "bounds": bounds],
    "text": String(texts.joined(separator: "\n").prefix(12000)),
    "selectedText": enabled && !secure ? focused.map { String(string($0, kAXSelectedTextAttribute).prefix(6000)) } ?? "" : "",
    "secure": secure
]
let data = try JSONSerialization.data(withJSONObject: result)
print(String(data: data, encoding: .utf8)!)
