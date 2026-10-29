import AVFoundation
import ScreenCaptureKit
import os

// MARK: - Models

/// An audio input metered outside a session, to preview it before recording.
public enum AudioSource: Codable, Sendable, Hashable {
    case microphone(deviceId: String)
    case systemAudio

    private enum CodingKeys: String, CodingKey { case kind, deviceId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "microphone":
            self = .microphone(deviceId: try c.decode(String.self, forKey: .deviceId))
        case "systemAudio": self = .systemAudio
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "unknown audio source kind \(kind)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .microphone(let deviceId):
            try c.encode("microphone", forKey: .kind)
            try c.encode(deviceId, forKey: .deviceId)
        case .systemAudio:
            try c.encode("systemAudio", forKey: .kind)
        }
    }
}

public struct AudioSourceLevel: Codable, Sendable, Equatable {
    public var source: AudioSource
    public var averageDb: Float
    public var peakDb: Float

    public init(source: AudioSource, averageDb: Float, peakDb: Float) {
        self.source = source
        self.averageDb = TrackLevel.clamp(averageDb)
        self.peakDb = TrackLevel.clamp(peakDb)
    }
}

public struct AudioSourceFailure: Codable, Sendable, Equatable {
    public var source: AudioSource
    public var message: String

    public init(source: AudioSource, message: String) {
        self.source = source
        self.message = message
    }
}

// MARK: - Preview

/// A running meter for one source.
public protocol AudioMeter: Sendable {
    func stop() async
}

/// Starts metering `source`, reporting each buffer's average and peak dBFS through `update`.
public typealias AudioMeterFactory =
    @Sendable (
        _ source: AudioSource,
        _ update: @escaping @Sendable (_ averageDb: Float, _ peakDb: Float) -> Void
    ) async throws -> any AudioMeter

/// Meters the sources `setAudioPreview` asks for without recording them. Independent of any session.
actor AudioPreview {
    private struct Board {
        /// The requested order, so `snapshot` is stable.
        var order: [AudioSource] = []
        var levels: [AudioSource: AudioSourceLevel] = [:]
    }

    private let makeMeter: AudioMeterFactory
    private var meters: [AudioSource: any AudioMeter] = [:]
    private let board = OSAllocatedUnfairLock(initialState: Board())

    init(makeMeter: @escaping AudioMeterFactory) {
        self.makeMeter = makeMeter
    }

    var isActive: Bool { !meters.isEmpty }

    /// Meters exactly `sources`: stops the rest, starts the new ones, and returns those that couldn't start.
    func set(_ sources: [AudioSource]) async -> [AudioSourceFailure] {
        var wanted: [AudioSource] = []
        for source in sources where !wanted.contains(source) { wanted.append(source) }

        for (source, meter) in meters where !wanted.contains(source) {
            meters[source] = nil
            board.withLock { $0.levels[source] = nil }
            await meter.stop()
        }

        var failures: [AudioSourceFailure] = []
        for source in wanted where meters[source] == nil {
            do {
                meters[source] = try await makeMeter(source) { [board] averageDb, peakDb in
                    let level = AudioSourceLevel(
                        source: source, averageDb: averageDb, peakDb: peakDb)
                    board.withLock { $0.levels[source] = level }
                }
            } catch {
                failures.append(AudioSourceFailure(source: source, message: Self.message(error)))
            }
        }
        let running = wanted.filter { meters[$0] != nil }
        board.withLock { $0.order = running }
        return failures
    }

    /// Latest level of every source that has delivered audio.
    nonisolated func snapshot() -> [AudioSourceLevel] {
        board.withLock { board in board.order.compactMap { board.levels[$0] } }
    }

    private static func message(_ error: Error) -> String {
        (error as? HelperError)?.message ?? error.localizedDescription
    }
}

/// Meters real devices: AVFoundation for microphones, ScreenCaptureKit for system audio, as the tracks record them.
public let liveAudioMeters: AudioMeterFactory = { source, update in
    switch source {
    case .microphone(let deviceId): try MicrophoneMeter(deviceId: deviceId, update: update)
    case .systemAudio: try await SystemAudioMeter.start(update: update)
    }
}

// MARK: - Meters

final class MicrophoneMeter: NSObject, AudioMeter, AVCaptureAudioDataOutputSampleBufferDelegate,
    @unchecked Sendable
{
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "chord.preview.microphone")
    private let update: @Sendable (Float, Float) -> Void

    init(deviceId: String, update: @escaping @Sendable (Float, Float) -> Void) throws {
        guard let device = AVCaptureDevice(uniqueID: deviceId) else {
            throw HelperError(.deviceUnavailable, "microphone \(deviceId) is not connected")
        }
        self.update = update
        super.init()

        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: queue)
        session.beginConfiguration()
        guard session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            throw HelperError(.deviceUnavailable, "microphone \(deviceId) cannot be captured")
        }
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()
        session.startRunning()
    }

    func stop() async {
        await queue.run { self.session.stopRunning() }
    }

    func captureOutput(
        _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let channels = connection.audioChannels
        update(
            channels.map(\.averagePowerLevel).max() ?? -160,
            channels.map(\.peakHoldLevel).max() ?? -160)
    }
}

final class SystemAudioMeter: NSObject, AudioMeter, SCStreamOutput, @unchecked Sendable {
    private let queue = DispatchQueue(label: "chord.preview.system-audio")
    private let update: @Sendable (Float, Float) -> Void
    private var stream: SCStream?

    private init(update: @escaping @Sendable (Float, Float) -> Void) {
        self.update = update
    }

    static func start(update: @escaping @Sendable (Float, Float) -> Void) async throws
        -> SystemAudioMeter
    {
        let meter = SystemAudioMeter(update: update)
        let stream = try await SystemAudioTrack.makeStream(delegate: nil)
        try stream.addStreamOutput(meter, type: .audio, sampleHandlerQueue: meter.queue)
        try await stream.startCapture(within: SCStream.callbackTimeout)
        meter.stream = stream
        return meter
    }

    func stop() async {
        await stream?.stopCapture(within: SCStream.callbackTimeout)
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid,
            let level = SystemAudioTrack.level(of: sampleBuffer)
        else { return }
        update(level.average, level.peak)
    }
}
