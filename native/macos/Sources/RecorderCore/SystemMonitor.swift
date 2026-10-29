import AVFoundation
import AppKit

public enum SystemEvent: Sendable, Equatable {
    case willSleep
    case didWake
    /// Screen locked, or switched to another user.
    case screenLocked
    case screenUnlocked
    case displaysChanged
    /// A camera or microphone was connected or disconnected.
    case devicesChanged
}

/// Publishes sleep, lock, display, and capture device changes. Needs a running main run loop.
public final class SystemMonitor: @unchecked Sendable {
    public let events: AsyncStream<SystemEvent>
    private let sink: AsyncStream<SystemEvent>.Continuation
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    public init() {
        (events, sink) = AsyncStream.makeStream(of: SystemEvent.self)

        let workspace = NSWorkspace.shared.notificationCenter
        let distributed = DistributedNotificationCenter.default()
        let local = NotificationCenter.default
        let observed: [(NotificationCenter, Notification.Name, SystemEvent)] = [
            (workspace, NSWorkspace.willSleepNotification, .willSleep),
            (workspace, NSWorkspace.didWakeNotification, .didWake),
            (workspace, NSWorkspace.sessionDidResignActiveNotification, .screenLocked),
            (workspace, NSWorkspace.sessionDidBecomeActiveNotification, .screenUnlocked),
            (distributed, Notification.Name("com.apple.screenIsLocked"), .screenLocked),
            (distributed, Notification.Name("com.apple.screenIsUnlocked"), .screenUnlocked),
            (local, AVCaptureDevice.wasConnectedNotification, .devicesChanged),
            (local, AVCaptureDevice.wasDisconnectedNotification, .devicesChanged),
        ]
        let sink = self.sink
        observers = observed.map { center, name, event in
            (
                center,
                center.addObserver(forName: name, object: nil, queue: nil) { _ in sink.yield(event)
                }
            )
        }
        CGDisplayRegisterReconfigurationCallback(
            Self.displayCallback, Unmanaged.passUnretained(self).toOpaque())
    }

    deinit {
        CGDisplayRemoveReconfigurationCallback(
            Self.displayCallback, Unmanaged.passUnretained(self).toOpaque())
        for (center, observer) in observers {
            center.removeObserver(observer)
        }
        sink.finish()
    }

    private static let displayCallback: CGDisplayReconfigurationCallBack = { _, flags, context in
        guard !flags.contains(.beginConfigurationFlag), let context else { return }
        Unmanaged<SystemMonitor>.fromOpaque(context).takeUnretainedValue().sink.yield(
            .displaysChanged)
    }
}
