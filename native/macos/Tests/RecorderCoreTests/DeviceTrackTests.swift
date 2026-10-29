import AVFoundation
import Testing

@testable import RecorderCore

/// Exercises the shared lifecycle without opening a device or asking for capture permission.
private final class TestDeviceTrack: DeviceTrack, @unchecked Sendable {
    var starts = 0
    var stops = 0

    init(directory: URL) {
        super.init(
            id: "test", kind: .microphone, source: "fixture",
            files: SegmentFiles(directory: directory, trackId: "test", ext: "m4a"),
            adopt: { _ in nil }, signal: { _ in })
    }
    override func warmTarget() async throws -> WarmTarget {
        .microphone(MicrophoneConfig(deviceId: source))
    }
    override func beginCapture(adopting warm: WarmCapture? = nil) throws {
        guard capture == nil else { return }
        starts += 1
        let session = AVCaptureSession()
        let writer = try SegmentWriter(url: files.next(), fileType: .m4a) { _ in
            AVAssetWriterInput(
                mediaType: .audio, outputSettings: losslessAudioSettings(channels: 1))
        }
        let observer = NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil
        ) { _ in }
        capture = DeviceCapture(
            session: session, writer: writer, clock: CMClockGetHostTimeClock(),
            errorObserver: observer)
    }
    override func didStopCapture() { stops += 1 }
}

@Test func deviceTracksStayArmedAcrossInterruptionsAndDisarmOnStop() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let track = TestDeviceTrack(directory: directory)
    try await track.start()
    await track.restore()
    #expect(await track.queue.run { track.starts == 1 && track.armed && track.capture != nil })
    await track.interrupt(reason: .systemSleep)
    #expect(await track.queue.run { track.stops == 1 && track.armed && track.capture == nil })
    await track.restore()
    #expect(await track.queue.run { track.starts == 2 && track.capture != nil })
    await track.stop(reason: .stopped, at: 10)
    await track.restore()
    #expect(
        await track.queue.run {
            track.starts == 2 && track.stops == 2 && !track.armed && track.capture == nil
        })
}
