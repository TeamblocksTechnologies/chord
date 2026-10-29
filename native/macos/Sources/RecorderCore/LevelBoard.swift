import os

public struct TrackLevel: Codable, Sendable, Equatable {
    public var trackId: String
    public var averageDb: Float
    public var peakDb: Float

    /// Silence can report values far below -160 dB or -infinity, which JSON can't encode, so clamp.
    public init(trackId: String, averageDb: Float, peakDb: Float) {
        self.trackId = trackId
        self.averageDb = Self.clamp(averageDb)
        self.peakDb = Self.clamp(peakDb)
    }

    static func clamp(_ db: Float) -> Float {
        db.isNaN ? -160 : min(max(db, -160), 0)
    }
}

/// Latest audio level per track. Tracks overwrite their entry on every buffer; the metering loop samples
/// it on a timer. Nothing queues, so meters can never back up behind a slow reader.
public final class LevelBoard: Sendable {
    private let levels = OSAllocatedUnfairLock<[String: TrackLevel]>(initialState: [:])

    public init() {}

    public func update(_ level: TrackLevel) {
        levels.withLock { $0[level.trackId] = level }
    }

    public func clear(trackId: String) {
        levels.withLock { $0[trackId] = nil }
    }

    public func snapshot() -> [TrackLevel] {
        levels.withLock { $0.values.sorted { $0.trackId < $1.trackId } }
    }
}
