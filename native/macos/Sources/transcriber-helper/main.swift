import AVFoundation
import FluidAudio
import Foundation
import Speech

// Runs one command, printing JSON lines on stdout and errors on stderr, then exits.
//
//   speech-assets [locale]                      {"status":"installed","locale":"en-CA","locales":["de-DE",…],"system":"en-CA"}
//   install-speech-assets [locale]              {"progress":0.42} while downloading, then the status line
//   transcribe-speech <audio file> [locale]     {"text":"…","words":[{"start":0.2,"end":0.8,"text":"…"}]}
//   transcribe-parakeet <audio file> <folder>   {"text":"…","words":[{"start":0.2,"end":0.8,"text":"…"}]}
//
// Word times are narrowed to where the audio is voiced, so pauses between words aren't counted as part of them.
//
// The first three are about Apple's speech model for `locale` (a BCP 47 tag), or the system's language without one.
// `status` is `unavailable` (before macOS 26, or no model for the language), `supported` (not downloaded),
// `downloading`, or `installed`. `locale` is the language the model transcribes, when there's one. `locales` are the
// languages Apple has models for, and `system` is the one closest to the system's language. `transcribe-parakeet`
// runs Parakeet v3 from the folder the app downloaded it into.

struct AssetsReply: Encodable {
    let status: String
    let locale: String?
    let locales: [String]
    let system: String?

    static let unavailable = AssetsReply(
        status: "unavailable", locale: nil, locales: [], system: nil)
}

struct ProgressReply: Encodable {
    let progress: Double
}

struct TimedText: Encodable, Sendable {
    let start: Double
    let end: Double
    let text: String
}

struct TranscriptReply: Encodable, Sendable {
    var text: String
    var words: [TimedText]
}

func send(_ reply: some Encodable) {
    guard let data = try? JSONEncoder().encode(reply) else { return }
    FileHandle.standardOutput.write(data + Data("\n".utf8))
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = Array(CommandLine.arguments.dropFirst())

/// The language asked for as the argument at `index`, or the system's.
func language(at index: Int) -> Locale {
    arguments.indices.contains(index) ? Locale(identifier: arguments[index]) : .current
}

/// The audio file named by the first argument after the command.
func audioFile() -> URL {
    guard arguments.count > 1 else {
        fail("usage: transcriber-helper \(arguments[0]) <audio file> …")
    }
    return URL(fileURLWithPath: arguments[1])
}

@available(macOS 26, *)
func transcriber(_ requested: Locale) async -> (SpeechTranscriber, Locale)? {
    guard SpeechTranscriber.isAvailable,
        let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested)
    else { return nil }
    return (
        SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [],
            attributeOptions: [.audioTimeRange]), locale
    )
}

@available(macOS 26, *)
func assets(_ requested: Locale) async -> AssetsReply {
    guard SpeechTranscriber.isAvailable else { return .unavailable }
    let locales = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }.sorted()
    let system = await SpeechTranscriber.supportedLocale(equivalentTo: .current)?.identifier(.bcp47)
    guard let (module, locale) = await transcriber(requested) else {
        return AssetsReply(status: "unavailable", locale: nil, locales: locales, system: system)
    }
    let status =
        switch await AssetInventory.status(forModules: [module]) {
        case .unsupported: "unavailable"
        case .supported: "supported"
        case .downloading: "downloading"
        case .installed: "installed"
        @unknown default: "unavailable"
        }
    return AssetsReply(
        status: status, locale: locale.identifier(.bcp47), locales: locales, system: system)
}

/// Makes room to reserve `locale`: macOS keeps the models of a few languages per app, so past that, one is let go.
@available(macOS 26, *)
func reserve(_ locale: Locale) async throws {
    let reserved = await AssetInventory.reservedLocales
    if reserved.contains(where: { $0.identifier(.bcp47) == locale.identifier(.bcp47) }) { return }
    if reserved.count >= AssetInventory.maximumReservedLocales, let oldest = reserved.first {
        await AssetInventory.release(reservedLocale: oldest)
    }
    try await AssetInventory.reserve(locale: locale)
}

@available(macOS 26, *)
func install(_ requested: Locale) async {
    guard let (module, locale) = await transcriber(requested) else {
        fail("Apple's speech model isn't available for this language")
    }
    do {
        try await reserve(locale)
        // Nil when everything is already installed.
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
            let progress = Task {
                while !Task.isCancelled {
                    send(ProgressReply(progress: request.progress.fractionCompleted))
                    try? await Task.sleep(for: .milliseconds(250))
                }
            }
            defer { progress.cancel() }
            try await request.downloadAndInstall()
        }
    } catch {
        fail("Couldn't download Apple's speech model: \(error.localizedDescription)")
    }
    send(await assets(requested))
}

@available(macOS 26, *)
func transcribeSpeech(_ url: URL, _ requested: Locale) async {
    guard let (module, _) = await transcriber(requested) else {
        fail("Apple's speech model isn't available for this language")
    }
    guard await AssetInventory.status(forModules: [module]) == .installed else {
        fail("Apple's speech model isn't downloaded")
    }
    do {
        let file = try AVAudioFile(forReading: url)
        let analyzer = SpeechAnalyzer(modules: [module])
        // Final results only. Each attributed run carries the audio's own time range.
        async let collected = module.results.reduce(into: TranscriptReply(text: "", words: [])) {
            reply, result in
            reply.text += String(result.text.characters)
            for run in result.text.runs {
                guard let range = run.audioTimeRange else { continue }
                let text = String(result.text[run.range].characters).trimmingCharacters(
                    in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    reply.words.append(
                        TimedText(
                            start: range.start.seconds, end: CMTimeRangeGetEnd(range).seconds,
                            text: text))
                }
            }
        }
        if let end = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: end)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        var reply = try await collected
        reply.text = reply.text.trimmingCharacters(in: .whitespacesAndNewlines)
        reply.words = voiced(reply.words, in: url)
        send(reply)
    } catch {
        fail("Couldn't transcribe: \(error.localizedDescription)")
    }
}

func transcribeParakeet(_ url: URL) async {
    guard arguments.count > 2 else {
        fail("usage: transcriber-helper transcribe-parakeet <audio file> <folder>")
    }
    do {
        let models = try AsrModels.loadLocal(from: URL(fileURLWithPath: arguments[2]), version: .v3)
        let manager = AsrManager(models: models)
        var state = TdtDecoderState.make()
        let result = try await manager.transcribe(url, decoderState: &state)
        let words = buildWordTimings(from: result.tokenTimings ?? []).map {
            TimedText(start: $0.startTime, end: $0.endTime, text: $0.word)
        }
        send(
            TranscriptReply(
                text: result.text.trimmingCharacters(in: .whitespacesAndNewlines),
                words: voiced(words, in: url)))
    } catch {
        fail("Couldn't transcribe: \(error.localizedDescription)")
    }
}

switch arguments.first {
case "media-duration":
    do {
        let duration = try await AVURLAsset(url: audioFile()).load(.duration)
        send(["duration": duration.seconds])
    } catch { fail("Couldn't read media duration: \(error.localizedDescription)") }
case "speech-assets":
    if #available(macOS 26, *) {
        send(await assets(language(at: 1)))
    } else {
        send(AssetsReply.unavailable)
    }
case "install-speech-assets":
    if #available(macOS 26, *) {
        await install(language(at: 1))
    } else {
        fail("Apple's speech model needs macOS 26")
    }
case "transcribe-speech":
    let url = audioFile()
    if #available(macOS 26, *) {
        await transcribeSpeech(url, language(at: 2))
    } else {
        fail("Apple's speech model needs macOS 26")
    }
case "transcribe-parakeet":
    await transcribeParakeet(audioFile())
default:
    fail(
        "usage: transcriber-helper speech-assets [locale] | install-speech-assets [locale]"
            + " | transcribe-speech <audio file> [locale] | transcribe-parakeet <audio file> <folder>"
    )
}
