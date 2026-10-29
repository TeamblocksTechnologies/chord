import AVFoundation

struct WriterFailure: Error, Sendable {
    var message: String
    var isDiskFull: Bool

    init(_ error: Error?, context: String) {
        message = error.map { "\(context): \($0.localizedDescription)" } ?? context
        isDiskFull = error.map(Self.isDiskFull) ?? false
    }

    static func isDiskFull(_ error: Error) -> Bool {
        var current: NSError? = error as NSError
        while let error = current {
            switch (error.domain, error.code) {
            case (AVFoundationErrorDomain, AVError.Code.diskFull.rawValue),
                (NSPOSIXErrorDomain, Int(ENOSPC)),
                (NSCocoaErrorDomain, NSFileWriteOutOfSpaceError):
                return true
            default:
                current = error.userInfo[NSUnderlyingErrorKey] as? NSError
            }
        }
        return false
    }
}

enum AppendResult {
    /// The first sample was written; the segment has begun.
    case began
    case appended
    /// Skipped because the encoder is busy or the writer already failed.
    case dropped
    /// The writer can no longer write. Reported once; later appends are dropped.
    case failed(WriterFailure)
}

/// Writes one segment file. Confined to its track's queue; handed off once for `finish()`.
final class SegmentWriter: @unchecked Sendable {
    /// Ends a segment on the shared host clock, converting device timestamps when necessary.
    func finish(
        trackId: String, clock: CMClock = CMClockGetHostTimeClock(), reason: SegmentEndReason,
        at hostTime: Double? = nil, signal: @Sendable (TrackSignal) -> Void
    ) async {
        let hostClock = CMClockGetHostTimeClock()
        let cut = hostTime.map {
            CMSyncConvertTime(
                CMTime(seconds: $0, preferredTimescale: 1_000_000_000), from: hostClock, to: clock)
        }
        guard let range = await finish(at: cut) else { return }
        let end = CMSyncConvertTime(range.end, from: clock, to: hostClock).seconds
        signal(.ended(trackId: trackId, file: url.lastPathComponent, hostTime: end, reason: reason))
    }
    let url: URL
    private let writer: AVAssetWriter
    private let makeInput: (CMFormatDescription) -> AVAssetWriterInput
    private var input: AVAssetWriterInput?
    private var failed = false
    private var start: CMTime?
    private var end: CMTime?

    init(
        url: URL, fileType: AVFileType, fragmentInterval: Double = 2,
        makeInput: @escaping (CMFormatDescription) -> AVAssetWriterInput
    ) throws {
        self.url = url
        self.makeInput = makeInput
        writer = try AVAssetWriter(outputURL: url, fileType: fileType)
        // Fragments keep the file playable if the helper is killed mid-recording.
        writer.movieFragmentInterval = CMTime(seconds: fragmentInterval, preferredTimescale: 600)
    }

    func append(_ sample: CMSampleBuffer) -> AppendResult {
        guard !failed else { return .dropped }
        let time = sample.presentationTimeStamp
        var began = false

        if input == nil {
            guard let format = sample.formatDescription else { return .dropped }
            let input = makeInput(format)
            input.expectsMediaDataInRealTime = true
            guard writer.canAdd(input) else { return fail(nil, "cannot add input") }
            writer.add(input)
            guard writer.startWriting() else { return fail(writer.error, "cannot start writing") }
            writer.startSession(atSourceTime: time)
            self.input = input
            start = time
            end = time
            began = true
        }

        guard let input, writer.status == .writing else {
            return fail(writer.error, "writer stopped")
        }
        guard input.isReadyForMoreMediaData else { return began ? .began : .dropped }
        guard input.append(sample) else { return fail(writer.error, "append failed") }
        let duration = sample.duration
        end = duration.isValid ? time + duration : time
        return began ? .began : .appended
    }

    /// Finalizes the file, ending it at `cut` if given: later samples are trimmed, and the last one is held until
    /// then. Returns the written time range, or nil if nothing was written.
    func finish(at cut: CMTime? = nil) async -> (start: CMTime, end: CMTime)? {
        guard let start, var end else {
            if writer.status == .writing { writer.cancelWriting() }
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        if let cut { end = max(cut, start) }
        if writer.status == .writing {
            input?.markAsFinished()
            writer.endSession(atSourceTime: end)
            await writer.finishWriting()
        }
        if writer.status != .completed {
            Log.error(
                "failed to finish \(url.lastPathComponent): \(String(describing: writer.error))")
        }
        return (start, end)
    }

    private func fail(_ error: Error?, _ context: String) -> AppendResult {
        failed = true
        let failure = WriterFailure(error, context: "\(url.lastPathComponent): \(context)")
        Log.error(failure.message)
        return .failed(failure)
    }
}

/// Audio tracks are kept lossless so editing and export don't compress already-compressed audio. ALAC is a fraction
/// of the video's size and, unlike PCM, fits the fragmented `.m4a` files every audio segment is written as.
func losslessAudioSettings(channels: Int) -> [String: Any] {
    [
        AVFormatIDKey: kAudioFormatAppleLossless,
        AVSampleRateKey: 48_000,
        AVNumberOfChannelsKey: channels,
        AVEncoderBitDepthHintKey: 24,
    ]
}
