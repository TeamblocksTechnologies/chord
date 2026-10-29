import AVFoundation

/// Records one microphone. Stays armed across interruptions: if the device is unplugged or the Mac sleeps,
/// the current segment ends and a new one begins when the device returns or `restore()` is called.
final class MicrophoneTrack: DeviceTrack, AVCaptureAudioDataOutputSampleBufferDelegate,
    @unchecked Sendable
{
    private let levels: LevelBoard

    init(
        id: String,
        deviceId: String,
        files: SegmentFiles,
        levels: LevelBoard,
        adopt: @escaping @Sendable (WarmTarget) async -> WarmCapture? = { _ in nil },
        signal: @escaping @Sendable (TrackSignal) -> Void
    ) {
        self.levels = levels
        super.init(
            id: id, kind: .microphone, source: deviceId, files: files, adopt: adopt, signal: signal)
    }

    override func warmTarget() async throws -> WarmTarget {
        .microphone(MicrophoneConfig(deviceId: source))
    }
    override func didStopCapture() { levels.clear(trackId: id) }

    // MARK: AVCaptureAudioDataOutputSampleBufferDelegate

    func captureOutput(
        _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let capture else { return }
        let hostTime = CMSyncConvertTime(
            sampleBuffer.presentationTimeStamp, from: capture.clock, to: CMClockGetHostTimeClock()
        ).seconds

        switch capture.writer.append(sampleBuffer) {
        case .began:
            failures.reset()
            signal(
                .started(
                    trackId: id, file: capture.writer.url.lastPathComponent, hostTime: hostTime))
        case .appended, .dropped:
            break
        case .failed(let failure):
            failures.report(failure.message, fatal: failure.isDiskFull)
            endCapture(reason: failure.isDiskFull ? .diskFull : .error)
            return
        }

        let channels = connection.audioChannels
        levels.update(
            TrackLevel(
                trackId: id,
                averageDb: channels.map(\.averagePowerLevel).max() ?? -160,
                peakDb: channels.map(\.peakHoldLevel).max() ?? -160
            ))
    }

    // MARK: Capture lifecycle (on `queue`)

    /// Records from `warm`, already running, if given, rather than waiting for a new session to start.
    override func beginCapture(adopting warm: WarmCapture? = nil) throws {
        guard capture == nil else {
            warm?.session.stopRunning()
            return
        }
        guard let device = AVCaptureDevice(uniqueID: source) else {
            warm?.session.stopRunning()
            throw HelperError(.deviceUnavailable, "microphone \(source) is not connected")
        }

        let session: AVCaptureSession
        let output: AVCaptureAudioDataOutput
        if let warm, let warmOutput = warm.output as? AVCaptureAudioDataOutput {
            (session, output) = (warm.session, warmOutput)
        } else {
            warm?.session.stopRunning()
            (session, output) = try Self.makeSession(device)
        }
        let channels = Self.channelCount(device)
        output.setSampleBufferDelegate(self, queue: queue)

        try activate(session) {
            try SegmentWriter(url: files.next(), fileType: .m4a) { _ in
                AVAssetWriterInput(
                    mediaType: .audio, outputSettings: losslessAudioSettings(channels: channels))
            }
        }
    }

    /// A session capturing `device` as the track records it, not yet running.
    static func makeSession(_ device: AVCaptureDevice) throws -> (
        AVCaptureSession, AVCaptureAudioDataOutput
    ) {
        let session = AVCaptureSession()
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        output.audioSettings = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: channelCount(device),
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: false,
        ]

        session.beginConfiguration()
        guard session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            throw HelperError(
                .deviceUnavailable, "microphone \(device.uniqueID) cannot be captured")
        }
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()
        return (session, output)
    }

    /// Mono or stereo; multichannel interfaces are folded to stereo.
    private static func channelCount(_ device: AVCaptureDevice) -> Int {
        let description = CMAudioFormatDescriptionGetStreamBasicDescription(
            device.activeFormat.formatDescription)
        let channels = Int(description?.pointee.mChannelsPerFrame ?? 1)
        return min(max(channels, 1), 2)
    }
}
