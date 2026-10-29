import Foundation
import ScreenCaptureKit
import os

/// Hands out sequential segment file names for one track: `mic-1-001.m4a`, `mic-1-002.m4a`, ...
public final class SegmentFiles: Sendable {
    private let directory: URL
    private let trackId: String
    private let ext: String
    private let counter = OSAllocatedUnfairLock(initialState: 0)

    public init(directory: URL, trackId: String, ext: String) {
        self.directory = directory
        self.trackId = trackId
        self.ext = ext
    }

    public func next() -> URL {
        let n = counter.withLock { count in
            count += 1
            return count
        }
        return directory.appending(path: "\(trackId)-\(String(format: "%03d", n)).\(ext)")
    }
}

/// Reports track failures, suppressing repeats of the same non-fatal message until a segment starts.
struct FailureReporter {
    let trackId: String
    let signal: @Sendable (TrackSignal) -> Void
    private var last: String?

    init(trackId: String, signal: @escaping @Sendable (TrackSignal) -> Void) {
        self.trackId = trackId
        self.signal = signal
    }

    mutating func report(_ message: String, fatal: Bool = false) {
        guard fatal || message != last else { return }
        last = message
        signal(.failed(trackId: trackId, message: message, fatal: fatal))
    }

    mutating func reset() {
        last = nil
    }
}

extension DispatchQueue {
    /// Runs `body` on this queue and awaits its result.
    func perform<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            async {
                continuation.resume(with: Result { try body() })
            }
        }
    }

    /// Non-throwing `perform`.
    func run<T: Sendable>(_ body: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { continuation in
            async {
                continuation.resume(returning: body())
            }
        }
    }
}

/// A wait that finishes once, whichever of its callers gets there first.
final class StartWait: Sendable {
    private let continuation = OSAllocatedUnfairLock<CheckedContinuation<Void, Error>?>(
        initialState: nil)

    /// Fails with `timeout` if nothing finishes the wait within `limit`.
    func wait(timeout limit: Duration, _ timeout: HelperError, starting start: () -> Void)
        async throws
    {
        let timer = Task { [weak self] in
            try await Task.sleep(for: limit)
            self?.finish(timeout)
        }
        defer { timer.cancel() }
        try await withCheckedThrowingContinuation { continuation in
            self.continuation.withLock { $0 = continuation }
            start()
        }
    }

    func finish(_ error: Error?) {
        let continuation = self.continuation.withLock { current in
            defer { current = nil }
            return current
        }
        if let error { continuation?.resume(throwing: error) } else { continuation?.resume() }
    }
}

extension SCStream {
    /// ScreenCaptureKit drops these callbacks when its connection breaks, e.g. while another process at the same
    /// executable path is capturing, so waiting on them is bounded.
    static let callbackTimeout = Duration.seconds(5)

    /// `startCapture`, failing if it doesn't call back in time.
    func startCapture(within limit: Duration) async throws {
        let wait = StartWait()
        try await wait.wait(
            timeout: limit, HelperError(.startFailed, "screen capture didn't start")
        ) {
            startCapture { error in wait.finish(error) }
        }
    }

    /// `stopCapture`, giving up if it doesn't call back in time.
    func stopCapture(within limit: Duration) async {
        let wait = StartWait()
        try? await wait.wait(
            timeout: limit, HelperError(.startFailed, "screen capture didn't stop")
        ) {
            stopCapture { _ in wait.finish(nil) }
        }
    }
}

extension SCShareableContent {
    /// On-screen windows and displays, failing if ScreenCaptureKit doesn't answer within `limit`.
    static func onScreen(within limit: Duration) async throws -> SCShareableContent {
        let found = OSAllocatedUnfairLock<SCShareableContent?>(uncheckedState: nil)
        let wait = StartWait()
        try await wait.wait(
            timeout: limit, HelperError(.startFailed, "screen capture isn't responding")
        ) {
            getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
                found.withLockUnchecked { $0 = content }
                wait.finish(
                    content == nil
                        ? error ?? HelperError(.startFailed, "no shareable content") : nil)
            }
        }
        return found.withLockUnchecked { $0! }
    }
}
