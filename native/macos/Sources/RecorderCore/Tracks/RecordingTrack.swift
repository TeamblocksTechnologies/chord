import Foundation
import os

public enum TrackKind: String, Codable, Sendable {
    case screen
    case microphone
    case camera
    case systemAudio
}

public enum SegmentEndReason: String, Codable, Sendable {
    case stopped
    case paused
    case deviceDisconnected
    case systemSleep
    case screenLocked
    case diskFull
    case modeChanged
    /// Pinned window tracks: the window closed. They don't continue.
    case windowClosed
    /// Pinned window tracks: the window was unpinned. They continue if it's pinned again.
    case unpinned
    /// `updateSession` switched the source off. It continues on the same track if switched back on.
    case removed
    /// `updateSession` changed how the source is recorded, e.g. its quality; the next segment uses the new settings.
    case configChanged
    case error
}

/// Reported by tracks as capture happens. Host times are in `HostClock` seconds.
public enum TrackSignal: Sendable {
    case started(trackId: String, file: String, hostTime: Double)
    case ended(trackId: String, file: String, hostTime: Double, reason: SegmentEndReason)
    /// `fatal` failures (disk full) end the whole session.
    case failed(trackId: String, message: String, fatal: Bool)
    /// `focusedWindow`: the followed window changed or was hidden or shown; `window` is nil when nothing is
    /// followed any more.
    case window(hostTime: Double, window: RecordedWindow?, hidden: Bool)
    /// `focusedWindow`: the followed window's bounds changed in a recorded frame; `frame` is nil when it left the
    /// track's display.
    case bounds(trackId: String, hostTime: Double, window: UInt32?, frame: Rect?)
}

/// One capture source writing a sequence of segment files.
/// A track may end and begin segments on its own (e.g. device unplugged and replugged).
public protocol RecordingTrack: AnyObject, Sendable {
    var id: String { get }
    var kind: TrackKind { get }
    /// Identifies what is captured, e.g. a display or device id.
    var source: String { get }
    /// Screen tracks: the display recorded.
    var display: TrackDisplay? { get }
    /// Pinned window tracks: the window recorded, as it was when pinned.
    var window: RecordedWindow? { get }

    /// Begins capturing into a new segment.
    func start() async throws
    /// Stops capturing and finalizes the current segment, ending it at `hostTime` if given rather than at its last
    /// sample, so every track stopped together ends together.
    func stop(reason: SegmentEndReason, at hostTime: Double?) async
    /// Ends the current segment but stays armed, so `restore()` can continue in a new segment.
    func interrupt(reason: SegmentEndReason) async
    /// Starts a new segment if armed and not capturing. Failures are reported as signals.
    func restore() async
}

extension RecordingTrack {
    public func stop(reason: SegmentEndReason) async {
        await stop(reason: reason, at: nil)
    }

    public var display: TrackDisplay? { nil }
    public var window: RecordedWindow? { nil }
}

/// A session's screen tracks (one per display, and one per area) share a mode, which can change mid-session. Pinned
/// windows have screen tracks of their own, one per display, whichever the mode.
public protocol ScreenRecordingTrack: RecordingTrack {
    /// Changes the mode of every screen track in the session but pinned windows'. Tracks whose capture changes
    /// continue in a new segment after one ended with `modeChanged`; tracks paused pick it up on resume. Returns new,
    /// unstarted tracks for areas the session hasn't had before. Throws without changing anything if `mode` can't
    /// start.
    func setMode(_ mode: ScreenMode) async throws -> [any RecordingTrack]
    /// Pins exactly `windowIds`. Tracks of windows no longer pinned end with `unpinned`; those of windows pinned
    /// again continue. Returns new, unstarted tracks for windows the session hasn't pinned before. Throws without
    /// changing anything if a newly pinned window isn't open.
    func setPinnedWindows(_ windowIds: [UInt32]) async throws -> [any RecordingTrack]
    /// Throws `window_unavailable`, changing nothing, if any of `windowIds` not already pinned isn't open.
    func checkPinnedWindows(_ windowIds: [UInt32]) async throws
    /// Applies `config`'s cursor, exclusions, and quality to every screen track; the mode and pins are set on their
    /// own. Tracks capturing continue in a new segment after one ended with `configChanged`.
    func setSettings(_ config: ScreenConfig) async
}

/// A camera track whose format, frame rate, and bitrate can change mid-session.
public protocol CameraRecordingTrack: RecordingTrack {
    /// Records with `config` from now on: a capturing track continues in a new segment after one ended with
    /// `configChanged`.
    func setConfig(_ config: CameraConfig) async
}

public struct TrackContext: Sendable {
    public let directory: URL
    public let clock: HostClock
    public let levels: LevelBoard
    public let signal: @Sendable (TrackSignal) -> Void
    /// Numbers a session's tracks of each kind, including ones added mid-session.
    public let ids: TrackIds
    /// Hands over a device `warmUp` has running with exactly these settings, so a track starts without waiting for it.
    public let adopt: @Sendable (WarmTarget) async -> (any WarmDevice)?

    public init(
        directory: URL, clock: HostClock, levels: LevelBoard, ids: TrackIds = TrackIds(),
        adopt: @escaping @Sendable (WarmTarget) async -> (any WarmDevice)? = { _ in nil },
        signal: @escaping @Sendable (TrackSignal) -> Void
    ) {
        self.directory = directory
        self.clock = clock
        self.levels = levels
        self.ids = ids
        self.adopt = adopt
        self.signal = signal
    }

    public func files(for trackId: String, ext: String) -> SegmentFiles {
        SegmentFiles(directory: directory, trackId: trackId, ext: ext)
    }
}

/// Hands out track ids in order for each prefix: `mic-1`, `mic-2`, ...
public final class TrackIds: Sendable {
    private let counts = OSAllocatedUnfairLock(initialState: [String: Int]())

    public init() {}

    public func next(_ prefix: String) -> String {
        let number = counts.withLock { counts in
            counts[prefix, default: 0] += 1
            return counts[prefix]!
        }
        return "\(prefix)-\(number)"
    }
}

/// Makes the tracks for `config`'s sources. Called at session start, and by `updateSession` with only the sources
/// the session hasn't had before.
public typealias TrackFactory =
    @Sendable (SessionConfig, TrackContext) throws -> [any RecordingTrack]
