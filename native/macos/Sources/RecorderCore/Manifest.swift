import Foundation

/// `session.json`: describes every file in a session folder on a shared timeline.
/// All times are seconds since the session started.
public struct Manifest: Codable, Sendable, Equatable {
    public var version = 1
    public var id: String
    public var createdAt: Date
    /// Host clock seconds at session start, for debugging alignment.
    public var hostTimeOrigin: Double
    public var config: SessionConfig
    public var tracks: [ManifestTrack]
    public var pauses: [Pause] = []
    public var marks: [Mark] = []
    /// `focusedWindow`: which window was followed over time.
    public var windows: [WindowSample] = []
    /// A JSON Lines file of `InputEvent`: the mouse and the keys that matter, while recording.
    public var input: String?
    public var stoppedAt: Double?
    public var stopReason: StopReason?
}

public struct ManifestTrack: Codable, Sendable, Equatable {
    public var id: String
    public var kind: TrackKind
    /// What was captured at session start.
    public var source: String
    public var display: TrackDisplay?
    /// Pinned window tracks: the window recorded, as it was when pinned.
    public var window: RecordedWindow?
    /// `focusedWindow` and pinned windows: a JSON Lines file of `BoundsSample`, one per recorded frame where the
    /// window's bounds changed.
    public var bounds: String?
    public var segments: [ManifestSegment] = []
}

public struct ManifestSegment: Codable, Sendable, Equatable {
    public var file: String
    public var start: Double
    public var end: Double?
    public var endReason: SegmentEndReason?
    /// Screen tracks only, except pinned windows': the mode this segment started in. An area track records the nth
    /// of the mode's areas on its display.
    public var screenMode: ScreenMode?
}

/// In global display coordinates: points, origin at the top left of the main display.
public struct Rect: Codable, Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(_ rect: CGRect) {
        x = rect.origin.x
        y = rect.origin.y
        width = rect.width
        height = rect.height
    }
}

public struct TrackDisplay: Codable, Sendable, Equatable {
    public var id: UInt32
    public var frame: Rect
    /// Pixels per point.
    public var scale: Double
}

public struct RecordedWindow: Codable, Sendable, Equatable {
    public var id: UInt32
    public var bundleId: String
    public var title: String?
}

/// The followed window from `time` until the next sample. `window` is nil when nothing is followed; `hidden` is set
/// while it's off screen (minimized, hidden, or on another Space).
public struct WindowSample: Codable, Sendable, Equatable {
    public var time: Double
    public var window: RecordedWindow?
    public var hidden: Bool?
}

/// One line of a screen track's bounds file: the followed window's bounds from the frame at `time` on. `frame` is
/// nil when no part of the window is on the track's display.
public struct BoundsSample: Codable, Sendable, Equatable {
    public var time: Double
    public var window: UInt32?
    public var frame: Rect?
}

public struct Pause: Codable, Sendable, Equatable {
    public var start: Double
    public var end: Double?
}

public enum ManifestStore {
    public static let fileName = "session.json"

    public static func write(_ manifest: Manifest, to directory: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(manifest).write(
            to: directory.appending(path: fileName), options: .atomic)
    }

    public static func read(from directory: URL) throws -> Manifest {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(
            Manifest.self, from: Data(contentsOf: directory.appending(path: fileName)))
    }
}
