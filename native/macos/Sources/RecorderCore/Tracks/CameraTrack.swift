import AVFoundation

/// Records one camera. Like `MicrophoneTrack`, it stays armed across interruptions: if the device is unplugged or
/// the Mac sleeps, the current segment ends and a new one begins when the device returns or `restore()` is called.
final class CameraTrack: DeviceTrack, CameraRecordingTrack,
    AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable
{
    /// The device stays the same; `setConfig` changes the rest. Confined to `queue`.
    private var config: CameraConfig
    private var restarts = 0
    private static let maxRestarts = 5

    init(
        id: String, config: CameraConfig, files: SegmentFiles,
        adopt: @escaping @Sendable (WarmTarget) async -> WarmCapture? = { _ in nil },
        signal: @escaping @Sendable (TrackSignal) -> Void
    ) {
        self.config = config
        super.init(
            id: id, kind: .camera, source: config.deviceId, files: files, adopt: adopt,
            signal: signal)
    }

    override func warmTarget() async throws -> WarmTarget {
        // Prompts the first time; without access the session would deliver no frames and fail silently.
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            throw HelperError(.deviceUnavailable, "camera access is not granted")
        }
        return .camera(await queue.run { self.config })
    }

    func setConfig(_ config: CameraConfig) async {
        let previous = await queue.run { () -> DeviceCapture? in
            self.config = config
            return self.takeCapture()
        }
        guard let previous else { return }
        await finalize(previous, reason: .configChanged)
        await queue.run { self.restoreCapture() }
    }

    // MARK: AVCaptureVideoDataOutputSampleBufferDelegate

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
            restarts = 0
            failures.reset()
            signal(
                .started(
                    trackId: id, file: capture.writer.url.lastPathComponent, hostTime: hostTime))
        case .appended:
            restarts = 0
        case .dropped:
            break
        case .failed(let failure):
            failures.report(failure.message, fatal: failure.isDiskFull)
            if !failure.isDiskFull, rollWriter() { return }
            endCapture(reason: failure.isDiskFull ? .diskFull : .error)
        }
    }

    // MARK: Capture lifecycle (on `queue`)

    /// Records from `warm`, already running, if given, rather than waiting for a new session to start.
    override func beginCapture(adopting warm: WarmCapture? = nil) throws {
        guard capture == nil else {
            warm?.session.stopRunning()
            return
        }
        let session: AVCaptureSession
        let output: AVCaptureVideoDataOutput
        var locked: AVCaptureDevice?
        if let warm, let warmOutput = warm.output as? AVCaptureVideoDataOutput {
            (session, output) = (warm.session, warmOutput)
        } else {
            warm?.session.stopRunning()
            guard let device = AVCaptureDevice(uniqueID: source) else {
                throw HelperError(.deviceUnavailable, "camera \(source) is not connected")
            }
            let made = try Self.makeSession(device, config: config)
            (session, output) = (made.0, made.1)
            if made.locked { locked = device }
        }
        // Held until the session is running, so starting it doesn't replace the chosen format with a preset's.
        defer { locked?.unlockForConfiguration() }
        output.setSampleBufferDelegate(self, queue: queue)

        try activate(session, writer: makeWriter)
    }

    /// A session capturing `device` with `config`, not yet running. Returns whether the device is left locked for
    /// configuration, which should last until the session is running.
    static func makeSession(
        _ device: AVCaptureDevice, config: CameraConfig
    ) throws -> (AVCaptureSession, AVCaptureVideoDataOutput, locked: Bool) {
        let session = AVCaptureSession()
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true

        session.beginConfiguration()
        if config.format == nil { session.sessionPreset = .high }
        guard session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            throw HelperError(.deviceUnavailable, "camera \(device.uniqueID) cannot be captured")
        }
        session.addInput(input)
        session.addOutput(output)
        let locked = try configure(device, config: config)
        session.commitConfiguration()
        return (session, output, locked)
    }

    /// Applies the configured format and frame rate. Returns whether the device is left locked for configuration.
    static func configure(_ device: AVCaptureDevice, config: CameraConfig) throws -> Bool {
        let source = device.uniqueID
        guard let size = config.format else { return false }
        let candidates = device.formats.filter {
            let d = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return Int(d.width) == size.width && Int(d.height) == size.height
        }
        let fps = Double(config.fps)
        // Rates like 29.97 are listed as 30, so a rate within half a frame of a range's top counts as that range.
        let covers = { (range: AVFrameRateRange) in
            range.minFrameRate - 0.5 <= fps && fps <= range.maxFrameRate + 0.5
        }
        guard
            let format = candidates.first(where: {
                $0.videoSupportedFrameRateRanges.contains(where: covers)
            })
                ?? candidates.max(by: { Self.maxFps($0) < Self.maxFps($1) })
        else {
            throw HelperError(
                .invalidConfig, "camera \(source) has no \(size.width)×\(size.height) format")
        }
        let ranges = format.videoSupportedFrameRateRanges
        let duration: CMTime? =
            if let range = ranges.first(where: { abs($0.maxFrameRate - fps) < 0.5 }) {
                range.minFrameDuration
            } else if ranges.contains(where: covers) {
                CMTime(value: 1, timescale: CMTimeScale(config.fps))
            } else {
                // Faster than the format allows: its top rate.
                ranges.max { $0.maxFrameRate < $1.maxFrameRate }?.minFrameDuration
            }

        try device.lockForConfiguration()
        device.activeFormat = format
        if let duration {
            device.activeVideoMinFrameDuration = duration
            device.activeVideoMaxFrameDuration = duration
        }
        return true
    }

    /// The sizes `listSources` reports for a camera, largest first, each with its highest frame rate.
    static func formats(of device: AVCaptureDevice) -> [CameraFormat] {
        var best: [String: CameraFormat] = [:]
        for format in device.formats {
            let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            let candidate = CameraFormat(
                width: Int(d.width), height: Int(d.height), maxFps: Int(maxFps(format).rounded()))
            guard candidate.width > 0, candidate.height > 0, candidate.maxFps > 0 else { continue }
            let key = "\(candidate.width)x\(candidate.height)"
            if (best[key]?.maxFps ?? 0) < candidate.maxFps { best[key] = candidate }
        }
        return best.values.sorted {
            ($0.width * $0.height, $0.maxFps) > ($1.width * $1.height, $1.maxFps)
        }
    }

    private static func maxFps(_ format: AVCaptureDevice.Format) -> Double {
        format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
    }

    private func makeWriter() throws -> SegmentWriter {
        let fps = config.fps
        let bitrate = config.bitrate
        // Frequent fragment writes make the MP4 writer fail mid-recording (`MovieHeaderMaker` -16341) on cameras, so
        // fragment less often; a crash loses at most this much video.
        return try SegmentWriter(url: files.next(), fileType: .mp4, fragmentInterval: 10) {
            format in
            let size = CMVideoFormatDescriptionGetDimensions(format)
            return AVAssetWriterInput(
                mediaType: .video,
                outputSettings: [
                    AVVideoCodecKey: AVVideoCodecType.h264,
                    AVVideoWidthKey: Int(size.width),
                    AVVideoHeightKey: Int(size.height),
                    AVVideoCompressionPropertiesKey: [
                        AVVideoAverageBitRateKey: bitrate
                            ?? max(Int(size.width) * Int(size.height) * 4, 1_000_000),
                        AVVideoExpectedSourceFrameRateKey: fps,
                        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                    ],
                ])
        }
    }

    /// The encoder can fail mid-recording while the camera keeps delivering frames. Swap in a fresh writer and file
    /// without stopping the capture session, so at most a frame or two is lost. Returns false when it keeps failing.
    private func rollWriter() -> Bool {
        guard var current = capture, restarts < Self.maxRestarts else { return false }
        guard let next = try? makeWriter() else { return false }
        restarts += 1
        let old = current.writer
        current.writer = next
        capture = current
        let finished = DeviceCapture(
            session: current.session, writer: old, clock: current.clock,
            errorObserver: current.errorObserver)
        Task { await finalize(finished, reason: .error) }
        return true
    }

    /// Camera streams can stall briefly (media services reset, USB or Continuity Camera hiccups). Restarting the same
    /// session keeps the same file going, so the track stays one continuous segment instead of splitting.
    override func runtimeError(_ sessionId: ObjectIdentifier, message: String) {
        guard let capture, ObjectIdentifier(capture.session) == sessionId else { return }
        Log.error("\(id): runtime error: \(message)")
        guard restarts < Self.maxRestarts else {
            failures.report(message)
            endCapture(reason: .error)
            return
        }
        restarts += 1
        queue.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, let capture = self.capture,
                ObjectIdentifier(capture.session) == sessionId
            else { return }
            if !capture.session.isRunning { capture.session.startRunning() }
        }
    }

}
