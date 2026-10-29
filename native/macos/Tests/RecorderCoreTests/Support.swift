import Foundation
import os

@testable import RecorderCore

actor Collector<Element: Sendable> {
    private(set) var items: [Element] = []
    func add(_ item: Element) { items.append(item) }
}

final class FakeClock: Sendable {
    private let time: OSAllocatedUnfairLock<Double>

    init(_ start: Double = 100) {
        time = OSAllocatedUnfairLock(initialState: start)
    }

    var clock: HostClock {
        HostClock { [time] in time.withLock { $0 } }
    }

    func now() -> Double { time.withLock { $0 } }
    func advance(_ seconds: Double) { time.withLock { $0 += seconds } }
}

/// Mirrors real track semantics: armed between start and stop, interruptible, restorable.
final class FakeTrack: ScreenRecordingTrack, CameraRecordingTrack, @unchecked Sendable {
    let id: String
    let kind: TrackKind
    let source: String
    let window: RecordedWindow?
    private let files: SegmentFiles
    private let context: TrackContext
    private let failsToStart: Bool
    private var armed = false
    private var current: URL?
    /// Windows given tracks by `setPinnedWindows`, in order.
    private var pinned: [UInt32] = []
    /// The most areas a mode had.
    private var areas = 0

    init(
        id: String, kind: TrackKind = .microphone, source: String = "fake",
        window: RecordedWindow? = nil,
        context: TrackContext, failsToStart: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.source = source
        self.window = window
        self.context = context
        self.failsToStart = failsToStart
        files = context.files(for: id, ext: kind == .screen ? "mp4" : "m4a")
    }

    func start() async throws {
        if failsToStart { throw HelperError(.deviceUnavailable, "gone") }
        armed = true
        begin()
    }

    func stop(reason: SegmentEndReason, at hostTime: Double?) async {
        armed = false
        end(reason, at: hostTime)
    }

    func interrupt(reason: SegmentEndReason) async {
        end(reason)
    }

    func restore() async {
        if armed, current == nil { begin() }
    }

    /// A track for each area beyond the most a mode had, like the real group, but numbered across displays.
    func setMode(_ mode: ScreenMode) async throws -> [any RecordingTrack] {
        if current != nil {
            end(.modeChanged)
            begin()
        }
        guard case .area(let modeAreas, _, _) = mode, modeAreas.count > areas else { return [] }
        defer { areas = modeAreas.count }
        return (areas + 1...modeAreas.count).map {
            FakeTrack(id: "area-\($0)", kind: .screen, context: context)
        }
    }

    /// A track for each window not pinned before, like the real group, but one per window rather than per display.
    /// Window ids above 100 aren't open.
    func setPinnedWindows(_ windowIds: [UInt32]) async throws -> [any RecordingTrack] {
        if let closed = windowIds.first(where: { $0 > 100 }) {
            throw HelperError(.windowUnavailable, "window \(closed) is not open")
        }
        return windowIds.filter { !pinned.contains($0) }.map { windowId in
            pinned.append(windowId)
            return FakeTrack(
                id: "window-\(pinned.count)", kind: .screen,
                window: RecordedWindow(id: windowId, bundleId: "com.apple.Notes"), context: context
            )
        }
    }

    func checkPinnedWindows(_ windowIds: [UInt32]) async throws {
        if let closed = windowIds.first(where: { $0 > 100 }) {
            throw HelperError(.windowUnavailable, "window \(closed) is not open")
        }
    }

    func setSettings(_ config: ScreenConfig) async {
        restart(.configChanged)
    }

    func setConfig(_ config: CameraConfig) async {
        restart(.configChanged)
    }

    private func restart(_ reason: SegmentEndReason) {
        guard current != nil else { return }
        end(reason)
        begin()
    }

    /// Simulates a writer failure, as a real track reports it.
    func fail(diskFull: Bool) {
        context.signal(.failed(trackId: id, message: "write failed", fatal: diskFull))
        end(diskFull ? .diskFull : .error)
    }

    private func begin() {
        let url = files.next()
        current = url
        context.levels.update(TrackLevel(trackId: id, averageDb: -30, peakDb: -12))
        context.signal(
            .started(trackId: id, file: url.lastPathComponent, hostTime: context.clock.now()))
    }

    private func end(_ reason: SegmentEndReason, at hostTime: Double? = nil) {
        guard let url = current else { return }
        current = nil
        context.levels.clear(trackId: id)
        context.signal(
            .ended(
                trackId: id, file: url.lastPathComponent, hostTime: hostTime ?? context.clock.now(),
                reason: reason
            ))
    }
}

/// Fake tracks for exactly the sources a config asks for, numbered as live tracks are.
let fakeTracks: TrackFactory = { config, context in
    var tracks: [any RecordingTrack] = []
    if config.screen != nil {
        tracks.append(FakeTrack(id: "screen-1", kind: .screen, context: context))
    }
    if config.systemAudio {
        tracks.append(FakeTrack(id: "system-audio", kind: .systemAudio, context: context))
    }
    for microphone in config.microphones {
        tracks.append(
            FakeTrack(id: context.ids.next("mic"), source: microphone.deviceId, context: context))
    }
    for camera in config.cameras {
        tracks.append(
            FakeTrack(
                id: context.ids.next("camera"), kind: .camera, source: camera.deviceId,
                context: context))
    }
    return tracks
}

/// Polls until `condition` holds or about a second passes.
func eventually(_ condition: () async -> Bool) async -> Bool {
    for _ in 0..<100 {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return false
}

func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appending(path: "chord-tests-\(UUID().uuidString)")
}
