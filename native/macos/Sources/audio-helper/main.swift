import AVFoundation
import AudioToolbox
import Foundation

// Cleans recorded audio with Apple's Sound Isolation audio unit, offline.
//   available                              prints JSON: whether the unit can run here, and which modes.
//   isolate <input> <output.wav> [mode]    mode is voice (default) or highQuality. Writes 24-bit WAV the same length
//                                          as the input, lined up with it. Prints `progress <0 to 1>` lines, then JSON.
// The unit reports no latency but delays its output, so the delay is measured on a loud stretch of the file
// and cut from the start; without that the cleaned audio would trail the video.

struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func fail(_ error: Error) -> Never {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}

func say(_ text: String) {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

enum Mode: String {
    case voice
    case highQuality

    /// kAUSoundIsolationSoundType_Voice is 1 and HighQualityVoice (macOS 15) is 0.
    var soundType: Float { self == .voice ? 1 : 0 }
    var isAvailable: Bool {
        self == .voice
            || ProcessInfo.processInfo.isOperatingSystemAtLeast(
                OperatingSystemVersion(majorVersion: 15, minorVersion: 0, patchVersion: 0))
    }
    /// What the unit was measured to delay by, in seconds, for when a file has no stretch loud enough to measure on.
    var typicalDelay: Double { self == .voice ? 0.0563 : 0.0925 }
}

/// 'vois', kAudioUnitSubType_AUSoundIsolation, in Apple's effect type.
func soundIsolation() -> AudioComponentDescription {
    AudioComponentDescription(
        componentType: kAudioUnitType_Effect, componentSubType: 0x766F_6973,
        componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0,
        componentFlagsMask: 0)
}

func makeUnit(mode: Mode, wetPercent: Float) throws -> AVAudioUnitEffect {
    var description = soundIsolation()
    guard AudioComponentFindNext(nil, &description) != nil else {
        throw Failure(message: "Apple Sound Isolation isn't available on this Mac")
    }
    let unit = AVAudioUnitEffect(audioComponentDescription: description)
    guard let tree = unit.auAudioUnit.parameterTree, let type = tree.parameter(withAddress: 1),
        let mix = tree.parameter(withAddress: 0)
    else {
        throw Failure(message: "Apple Sound Isolation has no settings to set")
    }
    type.value = mode.soundType
    mix.value = wetPercent
    return unit
}

let block: AVAudioFrameCount = 4096

/// Plays frames `start ..< start + count` of `file` through a fresh unit, offline, and hands each rendered block to
/// `sink` until `total` frames have come out (more than `count`, to let the unit's delay play out).
func render(
    file: AVAudioFile, start: AVAudioFramePosition, count: AVAudioFrameCount,
    total: AVAudioFramePosition, mode: Mode, wetPercent: Float,
    sink: (AVAudioPCMBuffer) throws -> Void
) throws {
    let format = file.processingFormat
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let unit = try makeUnit(mode: mode, wetPercent: wetPercent)
    engine.attach(player)
    engine.attach(unit)
    try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: block)
    engine.connect(player, to: unit, format: format)
    engine.connect(unit, to: engine.mainMixerNode, format: format)
    try engine.start()
    player.scheduleSegment(file, startingFrame: start, frameCount: count, at: nil)
    player.play()
    guard
        let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: block)
    else { throw Failure(message: "Could not allocate audio") }
    var rendered: AVAudioFramePosition = 0
    while rendered < total {
        let wanted = AVAudioFrameCount(min(AVAudioFramePosition(block), total - rendered))
        switch try engine.renderOffline(wanted, to: buffer) {
        case .success:
            try sink(buffer)
            rendered += AVAudioFramePosition(buffer.frameLength)
        case .insufficientDataFromInputNode, .cannotDoInCurrentContext:
            continue
        case .error:
            throw Failure(message: "Apple Sound Isolation failed while rendering")
        @unknown default:
            throw Failure(message: "Apple Sound Isolation failed while rendering")
        }
    }
    player.stop()
    engine.stop()
}

func mono(_ buffer: AVAudioPCMBuffer, into samples: inout [Float]) {
    guard let channels = buffer.floatChannelData else { return }
    let count = Int(buffer.frameLength)
    let n = Int(buffer.format.channelCount)
    for i in 0..<count {
        var sum: Float = 0
        for c in 0..<n { sum += channels[c][i] }
        samples.append(sum / Float(n))
    }
}

/// How many frames the unit delays its output by in `file`, found by playing a loud stretch of it through the unit and
/// seeing where the result lines up with what went in. Nil when no stretch is loud enough to tell.
func measureDelay(file: AVAudioFile, mode: Mode, wetPercent: Float) throws -> Int? {
    let rate = file.processingFormat.sampleRate
    let length = file.length
    guard length > Int64(rate * 0.3) else { return nil }
    // The loudest quarter second among those sampled every five seconds.
    let probe = AVAudioFrameCount(rate / 4)
    guard let scratch = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: probe)
    else { return nil }
    var best: (position: AVAudioFramePosition, rms: Float) = (0, 0)
    var position: AVAudioFramePosition = 0
    while position + AVAudioFramePosition(probe) <= length {
        file.framePosition = position
        try file.read(into: scratch, frameCount: probe)
        var samples: [Float] = []
        mono(scratch, into: &samples)
        let rms = (samples.reduce(0) { $0 + $1 * $1 } / Float(max(samples.count, 1))).squareRoot()
        if rms > best.rms { best = (position, rms) }
        position += AVAudioFramePosition(rate * 5)
    }
    guard best.rms > 1e-4 else { return nil }
    let start = max(0, best.position - AVAudioFramePosition(rate * 3))
    let count = AVAudioFrameCount(min(AVAudioFramePosition(rate * 8), length - start))
    var input: [Float] = []
    file.framePosition = start
    guard let window = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: count)
    else { return nil }
    try file.read(into: window, frameCount: count)
    mono(window, into: &input)
    var output: [Float] = []
    let tail = AVAudioFramePosition(rate * 0.4)
    try render(
        file: file, start: start, count: count, total: AVAudioFramePosition(count) + tail,
        mode: mode, wetPercent: wetPercent
    ) { mono($0, into: &output) }
    return lag(input: input, output: output, rate: rate)
}

/// The shift in frames that lines `output` up with `input`, from the energy envelopes and then the samples; nil when
/// the two don't resemble each other.
func lag(input: [Float], output: [Float], rate: Double) -> Int? {
    let step = max(1, Int(rate / 200))
    func envelope(_ x: [Float]) -> [Float] {
        stride(from: 0, to: x.count - step, by: step).map { i in
            (x[i..<i + step].reduce(0) { $0 + $1 * $1 } / Float(step)).squareRoot()
        }
    }
    func correlation(_ a: ArraySlice<Float>, _ b: ArraySlice<Float>) -> Float {
        let n = min(a.count, b.count)
        guard n > 0 else { return 0 }
        let a = a.prefix(n)
        let b = b.prefix(n)
        let ma = a.reduce(0, +) / Float(n)
        let mb = b.reduce(0, +) / Float(n)
        var num: Float = 0
        var da: Float = 0
        var db: Float = 0
        for (x, y) in zip(a, b) {
            num += (x - ma) * (y - mb)
            da += (x - ma) * (x - ma)
            db += (y - mb) * (y - mb)
        }
        return da > 0 && db > 0 ? num / (da * db).squareRoot() : 0
    }
    let (ei, eo) = (envelope(input), envelope(output))
    var coarse: (lag: Int, score: Float) = (0, -1)
    for candidate in 0...Int(0.3 * rate / Double(step)) where candidate < eo.count {
        let score = correlation(ei[...], eo[candidate...])
        if score > coarse.score { coarse = (candidate, score) }
    }
    guard coarse.score > 0.5 else { return nil }
    // Refine on the samples themselves, over the middle few seconds of the window.
    let from = input.count / 4
    let length = min(Int(rate * 4), input.count / 2)
    var fine: (lag: Int, score: Float) = (coarse.lag * step, -1)
    for candidate in max(0, coarse.lag * step - 2 * step)...(coarse.lag * step + 2 * step)
    where from + candidate + length <= output.count {
        let score = correlation(
            input[from..<from + length], output[from + candidate..<from + candidate + length])
        if score > fine.score { fine = (candidate, score) }
    }
    return fine.score > 0.5 ? fine.lag : nil
}

func isolate(input: URL, output: URL, mode: Mode) throws {
    guard mode.isAvailable else {
        throw Failure(message: "This mode needs a newer version of macOS")
    }
    let wet: Float = 100
    let file = try AVAudioFile(forReading: input)
    let format = file.processingFormat
    let measured = try measureDelay(file: file, mode: mode, wetPercent: wet)
    let delay = measured ?? Int(mode.typicalDelay * format.sampleRate)
    file.framePosition = 0
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: format.channelCount,
        AVLinearPCMBitDepthKey: 24, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
    ]
    let length = file.length
    var skipped: AVAudioFramePosition = 0
    var written: AVAudioFramePosition = 0
    var reported = -1
    do {
        let out = try AVAudioFile(
            forWriting: output, settings: settings, commonFormat: .pcmFormatFloat32,
            interleaved: false)
        try render(
            file: file, start: 0, count: AVAudioFrameCount(length),
            total: length + AVAudioFramePosition(delay), mode: mode, wetPercent: wet
        ) { buffer in
            // The first `delay` frames out are the unit catching up; the rest are the input's frames, in order.
            let drop = AVAudioFrameCount(
                min(AVAudioFramePosition(buffer.frameLength), AVAudioFramePosition(delay) - skipped)
            )
            skipped += AVAudioFramePosition(drop)
            let keep = AVAudioFrameCount(
                min(AVAudioFramePosition(buffer.frameLength - drop), length - written))
            if keep > 0 {
                guard let slice = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: keep),
                    let from = buffer.floatChannelData, let to = slice.floatChannelData
                else { return }
                for c in 0..<Int(buffer.format.channelCount) {
                    to[c].update(from: from[c] + Int(drop), count: Int(keep))
                }
                slice.frameLength = keep
                try out.write(from: slice)
                written += AVAudioFramePosition(keep)
            }
            let step = Int(Double(written) / Double(max(length, 1)) * 100)
            if step != reported {
                reported = step
                say("progress \(Double(step) / 100)")
            }
        }
    }
    guard written == length else {
        throw Failure(message: "Apple Sound Isolation returned \(written) of \(length) frames")
    }
    say("{\"delay\":\(delay),\"measured\":\(measured != nil)}")
}

let arguments = CommandLine.arguments
do {
    switch arguments.dropFirst().first {
    case "available":
        var description = soundIsolation()
        let there = AudioComponentFindNext(nil, &description) != nil
        let modes = [Mode.voice, Mode.highQuality].filter(\.isAvailable).map {
            "\"\($0.rawValue)\""
        }.joined(separator: ",")
        say(
            there
                ? "{\"available\":true,\"modes\":[\(modes)]}"
                : "{\"available\":false,\"reason\":\"Apple Sound Isolation needs macOS 13 or later\"}"
        )
    case "isolate":
        guard arguments.count >= 4 else {
            throw Failure(
                message: "usage: audio-helper isolate <input> <output.wav> [voice|highQuality]")
        }
        guard let mode = Mode(rawValue: arguments.count > 4 ? arguments[4] : "voice") else {
            throw Failure(message: "Unknown mode")
        }
        do {
            try isolate(
                input: URL(fileURLWithPath: arguments[2]),
                output: URL(fileURLWithPath: arguments[3]), mode: mode)
        } catch {
            try? FileManager.default.removeItem(atPath: arguments[3])
            throw error
        }
    default:
        throw Failure(
            message:
                "usage: audio-helper available | isolate <input> <output.wav> [voice|highQuality]")
    }
} catch {
    fail(error)
}
