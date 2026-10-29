import AVFoundation
import ScreenCaptureKit

/// Records the sound the Mac is playing (everything except Chord itself), independent of the screen tracks and
/// their mode. Stays armed across interruptions (sleep, stream errors) so `restore()` can continue in a new segment.
final class SystemAudioTrack: NSObject, RecordingTrack, SCStreamOutput, SCStreamDelegate,
    @unchecked Sendable
{
    let id: String
    let kind = TrackKind.systemAudio
    let source = "system"

    private let files: SegmentFiles
    private let levels: LevelBoard
    private let signal: @Sendable (TrackSignal) -> Void
    private let queue: DispatchQueue

    private struct Capture: @unchecked Sendable {
        let stream: SCStream
        let writer: SegmentWriter
    }

    private static let channels = 2

    // Confined to `queue`.
    private var armed = false
    private var starting = false
    private var capture: Capture?
    private var failures: FailureReporter

    init(
        id: String,
        files: SegmentFiles,
        levels: LevelBoard,
        signal: @escaping @Sendable (TrackSignal) -> Void
    ) {
        self.id = id
        self.files = files
        self.levels = levels
        self.signal = signal
        queue = DispatchQueue(label: "chord.track.\(id)")
        failures = FailureReporter(trackId: id, signal: signal)
    }

    func start() async throws {
        await queue.run { self.armed = true }
        do {
            try await beginCapture()
        } catch {
            await stop(reason: .error)
            throw error
        }
    }

    func stop(reason: SegmentEndReason, at hostTime: Double?) async {
        let capture = await queue.run { () -> Capture? in
            self.armed = false
            return self.takeCapture()
        }
        if let capture { await end(capture, reason: reason, at: hostTime) }
    }

    func interrupt(reason: SegmentEndReason) async {
        if let capture = await queue.run({ self.takeCapture() }) {
            await end(capture, reason: reason)
        }
    }

    func restore() async {
        do {
            try await beginCapture()
        } catch {
            let message = "\(error)"
            queue.async { self.failures.report(message) }
        }
    }

    // MARK: SCStreamOutput / SCStreamDelegate

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, let capture, capture.stream === stream, sampleBuffer.isValid,
            sampleBuffer.numSamples > 0
        else { return }

        switch capture.writer.append(sampleBuffer) {
        case .began:
            failures.reset()
            signal(
                .started(
                    trackId: id,
                    file: capture.writer.url.lastPathComponent,
                    hostTime: sampleBuffer.presentationTimeStamp.seconds
                ))
        case .appended, .dropped:
            break
        case .failed(let failure):
            guard let capture = takeCapture() else { return }
            failures.report(failure.message, fatal: failure.isDiskFull)
            Task { await end(capture, reason: failure.isDiskFull ? .diskFull : .error) }
            return
        }

        if let level = Self.level(of: sampleBuffer) {
            levels.update(TrackLevel(trackId: id, averageDb: level.average, peakDb: level.peak))
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let message = error.localizedDescription
        queue.async {
            guard let capture = self.capture, capture.stream === stream else { return }
            self.capture = nil
            self.failures.report(message)
            Task { await self.end(capture, reason: .error) }
        }
    }

    // MARK: Capture lifecycle

    private func beginCapture() async throws {
        let claimed = await queue.run { () -> Bool in
            guard self.armed, self.capture == nil, !self.starting else { return false }
            self.starting = true
            return true
        }
        guard claimed else { return }

        let capture: Capture
        do {
            capture = try await makeCapture()
        } catch {
            await queue.run { self.starting = false }
            throw error
        }

        // Disarmed (stopped) while starting: discard.
        let installed = await queue.run { () -> Bool in
            self.starting = false
            guard self.armed else { return false }
            self.capture = capture
            return true
        }
        guard installed else {
            _ = await capture.writer.finish()
            return
        }

        do {
            try await capture.stream.startCapture(within: SCStream.callbackTimeout)
        } catch {
            let stillInstalled = await queue.run { () -> Bool in
                guard let current = self.capture, current.stream === capture.stream else {
                    return false
                }
                self.capture = nil
                return true
            }
            if stillInstalled { _ = await capture.writer.finish() }
            throw error
        }
    }

    private func makeCapture() async throws -> Capture {
        let stream = try await Self.makeStream(delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)

        let channels = Self.channels
        let writer = try SegmentWriter(url: files.next(), fileType: .m4a) { _ in
            AVAssetWriterInput(
                mediaType: .audio, outputSettings: losslessAudioSettings(channels: channels))
        }
        return Capture(stream: stream, writer: writer)
    }

    /// On `queue`.
    private func takeCapture() -> Capture? {
        guard let capture else { return nil }
        self.capture = nil
        levels.clear(trackId: id)
        return capture
    }

    /// Sample times are host times, so `hostTime` cuts the segment as is.
    private func end(_ capture: Capture, reason: SegmentEndReason, at hostTime: Double? = nil) async
    {
        await capture.stream.stopCapture(within: SCStream.callbackTimeout)
        await capture.writer.finish(trackId: id, reason: reason, at: hostTime, signal: signal)
    }

    /// An audio-only stream of the Mac's output, excluding the helper's own sound. Also used by the preview meter.
    static func makeStream(delegate: SCStreamDelegate?) async throws -> SCStream {
        let content = try await SCShareableContent.onScreen(within: SCStream.callbackTimeout)
        guard
            let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
                ?? content.displays.first
        else {
            throw HelperError(
                .displayUnavailable, "no display is available to capture system audio")
        }

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = channels
        // Audio only: keep the unused video side as small as possible.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let filter = SCContentFilter(display: display, excludingWindows: [])
        return SCStream(filter: filter, configuration: config, delegate: delegate)
    }

    // MARK: Metering

    /// Average and peak level in dBFS across channels, for float or 16-bit PCM.
    static func level(of sampleBuffer: CMSampleBuffer) -> (average: Float, peak: Float)? {
        guard
            let format = sampleBuffer.formatDescription,
            let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
            asbd.mFormatID == kAudioFormatLinearPCM
        else { return nil }
        let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
        guard isFloat && asbd.mBitsPerChannel == 32 || !isFloat && asbd.mBitsPerChannel == 16 else {
            return nil
        }

        var sumSquares = 0.0
        var peak = 0.0
        var count = 0
        do {
            try sampleBuffer.withAudioBufferList { list, _ in
                for buffer in list {
                    guard let data = buffer.mData else { continue }
                    if isFloat {
                        let samples = UnsafeBufferPointer(
                            start: data.assumingMemoryBound(to: Float.self),
                            count: Int(buffer.mDataByteSize) / 4
                        )
                        for sample in samples {
                            let value = Double(abs(sample))
                            sumSquares += value * value
                            peak = max(peak, value)
                        }
                        count += samples.count
                    } else {
                        let samples = UnsafeBufferPointer(
                            start: data.assumingMemoryBound(to: Int16.self),
                            count: Int(buffer.mDataByteSize) / 2
                        )
                        for sample in samples {
                            let value = abs(Double(sample)) / 32_768
                            sumSquares += value * value
                            peak = max(peak, value)
                        }
                        count += samples.count
                    }
                }
            }
        } catch {
            return nil
        }
        guard count > 0 else { return nil }
        func db(_ amplitude: Double) -> Float {
            amplitude > 0 ? Float(20 * log10(amplitude)) : -160
        }
        return (average: db((sumSquares / Double(count)).squareRoot()), peak: db(peak))
    }
}
