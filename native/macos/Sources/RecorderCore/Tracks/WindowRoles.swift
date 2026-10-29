import ApplicationServices
import CoreGraphics

/// What a window is to `focusedWindow` mode, from the Accessibility API.
enum WindowRole: Sendable, Equatable {
    /// A main window (it can be minimized): focusing one switches the followed window.
    case standard
    /// A dialog, panel, popup, or sheet: shown alongside its app's followed window.
    case auxiliary
}

/// Reads an app's window roles through the Accessibility API. Needs Accessibility permission.
enum WindowRoles {
    static var isAvailable: Bool { AXIsProcessTrusted() }

    /// The app's windows and sheets with their frames in global points, or `nil` without permission or if the app
    /// doesn't expose its windows (then callers fall back to treating every normal window as standard).
    static func roles(pid: pid_t) -> [(frame: CGRect, role: WindowRole)]? {
        guard isAvailable else { return nil }
        let app = AXUIElementCreateApplication(pid)
        // A hung app mustn't stall following.
        AXUIElementSetMessagingTimeout(app, 0.2)
        guard let windows: [AXUIElement] = attribute(app, kAXWindowsAttribute), !windows.isEmpty
        else { return nil }

        var result: [(frame: CGRect, role: WindowRole)] = []
        for window in windows {
            guard let frame = frame(of: window) else { continue }
            result.append((frame, role(of: window)))
            // Sheets are children of their window rather than app windows.
            for child in attribute(window, kAXChildrenAttribute) as [AXUIElement]? ?? []
            where attribute(child, kAXRoleAttribute) as String? == kAXSheetRole {
                if let frame = self.frame(of: child) { result.append((frame, .auxiliary)) }
            }
        }
        return result
    }

    /// Standard only for a standard window with an enabled minimize button. Apps often give popups, command
    /// palettes, and settings windows the standard subrole, but those can't be minimized; neither can dialogs or
    /// sheets.
    private static func role(of window: AXUIElement) -> WindowRole {
        guard
            attribute(window, kAXRoleAttribute) as String? == kAXWindowRole,
            attribute(window, kAXSubroleAttribute) as String? == kAXStandardWindowSubrole,
            attribute(window, kAXModalAttribute) as Bool? != true,
            let minimize: AXUIElement = attribute(window, kAXMinimizeButtonAttribute),
            attribute(minimize, kAXEnabledAttribute) as Bool? == true
        else { return .auxiliary }
        return .standard
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        var origin = CGPoint.zero
        var size = CGSize.zero
        guard
            let position: AXValue = attribute(element, kAXPositionAttribute),
            let extent: AXValue = attribute(element, kAXSizeAttribute),
            AXValueGetValue(position, .cgPoint, &origin),
            AXValueGetValue(extent, .cgSize, &size)
        else { return nil }
        return CGRect(origin: origin, size: size)
    }

    private static func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
            return nil
        }
        return value as? T
    }
}
