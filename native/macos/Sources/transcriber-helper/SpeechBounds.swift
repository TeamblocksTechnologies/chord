import AVFoundation

// Speech models time words for reading, not for pauses: Apple's runs touch end to end, so a pause becomes part of the
// word before it. The audio's loudness shows where each word is actually voiced, so pauses stay silent.

/// How long each loudness measurement covers, in seconds.
private let step = 0.01
/// Kept either side of the voiced part, so soft onsets and decays stay inside the word.
private let lead = 0.03
private let tail = 0.06
/// Shorter than this and the measurement is more likely wrong than the model.
private let shortest = 0.06
/// A silence this long is a pause rather than a gap within a word, like a stop consonant.
private let pauseFrames = 12
/// A voiced stretch this short is more likely noise or the previous word's tail.
private let shortestFrames = 6

/// The loudest channel's level in each 10 ms of `url`, in dBFS.
func loudness(of url: URL) throws -> [Float] {
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    let frame = max(1, Int((format.sampleRate * step).rounded()))
    let capacity = AVAudioFrameCount(frame * 1000)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
        return []
    }
    var levels: [Float] = []
    while file.framePosition < file.length {
        try file.read(into: buffer, frameCount: capacity)
        let count = Int(buffer.frameLength)
        guard count > 0, let channels = buffer.floatChannelData else { break }
        for offset in stride(from: 0, to: count, by: frame) {
            let end = min(offset + frame, count)
            var loudest: Float = 0
            for channel in 0..<Int(format.channelCount) {
                var sum: Float = 0
                for index in offset..<end {
                    sum += channels[channel][index] * channels[channel][index]
                }
                loudest = max(loudest, sum / Float(end - offset))
            }
            levels.append(10 * log10(max(loudest, 1e-12)))
        }
    }
    return levels
}

/// The level above which the recording is speech: near how loud speech gets, and clear of the background noise.
func speechThreshold(_ levels: [Float]) -> Float? {
    guard levels.count > 10 else { return nil }
    let sorted = levels.sorted()
    let floor = sorted[sorted.count / 10]
    let loud = sorted[sorted.count * 95 / 100]
    guard loud - floor > 12 else { return nil }
    return max(floor + 9, loud - 18)
}

/// Each word narrowed to where it's voiced. Words are only ever shortened, never moved past the model's own times,
/// and are left as they were where no speech is measured in them. A pause inside a word's time belongs to the next
/// word starting early, as Apple's do, so the word is the voiced stretch after it.
func voiced(_ words: [TimedText], levels: [Float]) -> [TimedText] {
    guard let threshold = speechThreshold(levels) else { return words }
    return words.map { word in
        let first = max(0, Int(word.start / step))
        let last = min(levels.count - 1, Int((word.end / step).rounded(.up)) - 1)
        guard first <= last else { return word }
        // Voiced stretches, split at silences of a pause's length.
        var stretches: [ClosedRange<Int>] = []
        for frame in first...last where levels[frame] >= threshold {
            if let current = stretches.last, frame - current.upperBound - 1 < pauseFrames {
                stretches[stretches.count - 1] = current.lowerBound...frame
            } else {
                stretches.append(frame...frame)
            }
        }
        guard
            let stretch = stretches.last(where: { $0.count >= shortestFrames })
                ?? stretches.max(by: { $0.count < $1.count })
        else { return word }
        let start = max(word.start, Double(stretch.lowerBound) * step - lead)
        let end = min(word.end, Double(stretch.upperBound + 1) * step + tail)
        return end - start >= shortest ? TimedText(start: start, end: end, text: word.text) : word
    }
}

/// `words` narrowed to their voiced parts in `url`, or as they were if the audio can't be read.
func voiced(_ words: [TimedText], in url: URL) -> [TimedText] {
    guard let levels = try? loudness(of: url) else { return words }
    return voiced(words, levels: levels)
}
