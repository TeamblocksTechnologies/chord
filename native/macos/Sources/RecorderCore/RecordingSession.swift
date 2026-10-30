import Foundation
import os

/// One recording: a folder of segment files plus `session.json`.
/// Pausing is a hard stop of every track; resuming starts new segments. Sleep, screen lock, and lost devices
/// end segments; tracks continue in new segments once the cause clears.
public actor RecordingSession {
    public nonisolated let id: String
    public nonisolated let directory: URL
    public private(set) var state: SessionState = .idle

    /// Grows when a window is pinned for the first time, or `update` adds a source.
    private var tracks: [any RecordingTrack]
    /// Tracks `update` switched off, which stay stopped until it switches them back on.
    private var removed: Set<String> = []
    /// What the session records now, as `update` last set it.
    private var current: SessionUpdate
    /// The screen settings last applied to the screen tracks, kept while the screen is switched off.
    private var screenConfig: ScreenConfig?
    /// The settings last applied to each camera track, by device.
    private var cameraConfigs: [String: CameraConfig]
    private let context: TrackContext
    private let makeTracks: TrackFactory
    private let clock: HostClock
    private let origin: Double
    private let restoreInterval: Duration
    private let stopDrain: Duration
    private let emit: @Sendable (Event) async -> Void
    /// Each signal with the screen mode as it was sent, since signals are applied a little later.
    private let signals: AsyncStream<(TrackSignal, ScreenMode?)>
    private let signalSink: AsyncStream<(TrackSignal, ScreenMode?)>.Continuation
    private var signalTask: Task<Void, Never>?
    private var restoreTask: Task<Void, Never>?
    private var manifest: Manifest
    /// Locked so tracks' signals can read it as they're sent.
    private let currentScreenMode: OSAllocatedUnfairLock<ScreenMode?>
    private var screenMode: ScreenMode? {
        get { currentScreenMode.withLock { $0 } }
        set { currentScreenMode.withLock { $0 = newValue } }
    }
    private var boundsFiles: [String: FileHandle] = [:]
    private let input: InputRecorder?
    private var asleep = false
    private var locked = false

    public init(
        config: SessionConfig,
        clock: HostClock = .host,
        levels: LevelBoard = LevelBoard(),
        restoreInterval: Duration = .seconds(3),
        stopDrain: Duration = .milliseconds(250),
        makeTracks: @escaping TrackFactory = liveTracks,
        readInput: (@Sendable () -> InputState)? = nil,
        inputInterval: Duration = .milliseconds(10),
        adopt: @escaping @Sendable (WarmTarget) async -> (any WarmDevice)? = { _ in nil },
        emit: @escaping @Sendable (Event) async -> Void
    ) throws {
        let createdAt = Date()
        let id = Self.makeId(createdAt)
        let directory = URL(filePath: config.outputDirectory, directoryHint: .isDirectory)
            .appending(path: id, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let currentScreenMode = OSAllocatedUnfairLock(initialState: config.screen?.mode)
        let (signals, signalSink) = AsyncStream.makeStream(of: (TrackSignal, ScreenMode?).self)
        let context = TrackContext(
            directory: directory, clock: clock, levels: levels, ids: TrackIds(), adopt: adopt,
            signal: { signal in signalSink.yield((signal, currentScreenMode.withLock { $0 })) }
        )
        let tracks: [any RecordingTrack]
        do {
            tracks = try makeTracks(config, context)
            guard !tracks.isEmpty else {
                throw HelperError(.invalidConfig, "session has nothing to record")
            }
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }

        self.id = id
        self.directory = directory
        self.tracks = tracks
        self.context = context
        self.makeTracks = makeTracks
        current = SessionUpdate(
            screen: config.screen, microphones: config.microphones, cameras: config.cameras,
            systemAudio: config.systemAudio
        )
        screenConfig = config.screen
        cameraConfigs = Dictionary(
            config.cameras.map { ($0.deviceId, $0) }, uniquingKeysWith: { first, _ in first })
        self.clock = clock
        self.restoreInterval = restoreInterval
        self.stopDrain = stopDrain
        self.emit = emit
        self.signals = signals
        self.signalSink = signalSink
        let origin = clock.now()
        self.origin = origin
        self.currentScreenMode = currentScreenMode
        input = readInput.map {
            InputRecorder(
                directory: directory, read: $0, interval: inputInterval,
                now: { clock.now() - origin })
        }
        manifest = Manifest(
            id: id,
            createdAt: createdAt,
            hostTimeOrigin: origin,
            config: config,
            tracks: tracks.map(Self.describe),
            input: input == nil ? nil : InputRecorder.fileName
        )
    }

    public var info: SessionInfo {
        SessionInfo(
            id: id, directory: directory.path, state: state, stopReason: manifest.stopReason)
    }

    public func start() async throws -> SessionInfo {
        guard state == .idle else { throw HelperError(.invalidState, "session already started") }
        signalTask = Task { [signals] in
            for await (signal, screenMode) in signals {
                await self.apply(signal, screenMode: screenMode)
            }
        }
        state = .recording
        persist()

        // All at once, so the camera and microphones begin with the screen rather than after it.
        let results = await withTaskGroup(of: (any RecordingTrack, Error?).self) { group in
            for track in tracks {
                group.addTask {
                    do {
                        try await track.start()
                        return (track, nil)
                    } catch {
                        return (track, error)
                    }
                }
            }
            var results: [(any RecordingTrack, Error?)] = []
            for await result in group { results.append(result) }
            return results
        }
        if let (track, error) = results.first(where: { $0.1 != nil }) {
            await Self.stopAll(results.filter { $0.1 == nil }.map(\.0), reason: .error)
            signalSink.finish()
            await signalTask?.value
            state = .stopped
            try? FileManager.default.removeItem(at: directory)
            throw HelperError(.startFailed, "\(track.id): \(error!)")
        }

        // Safety net for anything that ended a segment without a system event to bring it back.
        restoreTask = Task { [restoreInterval] in
            while !Task.isCancelled {
                try? await Task.sleep(for: restoreInterval)
                await self.restoreTracks()
            }
        }
        await input?.start()
        await emit(.sessionState(info))
        return info
    }

    /// Pauses as of `hostTime`, when the user asked, if given.
    public func pause(at hostTime: Double? = nil) async throws -> SessionInfo {
        guard state == .recording else {
            throw HelperError(.invalidState, "session is not recording")
        }
        state = .paused
        manifest.pauses.append(Pause(start: (hostTime ?? clock.now()) - origin))
        await input?.stop()
        await stopTracks(reason: .paused, at: hostTime)
        persist()
        await emit(.sessionState(info))
        return info
    }

    public func resume() async throws -> SessionInfo {
        guard state == .paused else { throw HelperError(.invalidState, "session is not paused") }
        state = .recording
        closePause()
        for track in tracks where !removed.contains(track.id) {
            do {
                try await track.start()
            } catch {
                // Keep recording the tracks that can; the restore loop retries the rest.
                await emit(.trackError(trackId: track.id, message: "\(error)"))
            }
        }
        await input?.start()
        persist()
        await emit(.sessionState(info))
        return info
    }

    /// Stops as of `hostTime`, when the user asked, if given.
    public func stop(reason: StopReason = .requested, at hostTime: Double? = nil) async
        -> SessionInfo
    {
        let previous = state
        guard previous != .stopped else { return info }
        // Set first, so nothing restores tracks while they drain.
        state = .stopped
        await input?.close()
        switch previous {
        case .recording: await stopTracks(reason: .stopped, at: hostTime)
        case .paused: closePause()
        case .idle, .stopped: break
        }
        restoreTask?.cancel()
        signalSink.finish()
        await signalTask?.value
        for file in boundsFiles.values { try? file.close() }
        boundsFiles = [:]
        manifest.stoppedAt =
            previous == .recording ? hostTime.map { $0 - origin } ?? elapsed() : elapsed()
        manifest.stopReason = reason
        persist()
        await emit(.sessionState(info))
        return info
    }

    public func setScreenMode(_ mode: ScreenMode) async throws {
        guard state == .recording || state == .paused else {
            throw HelperError(.invalidState, "session is not active")
        }
        if let error = mode.configError(field: "mode") { throw HelperError(.invalidConfig, error) }
        guard let track = tracks.first(where: { $0.kind == .screen }) as? any ScreenRecordingTrack
        else {
            throw HelperError(.invalidConfig, "session has no screen track")
        }
        // Set first so the new segment's `started` signal records the new mode.
        let previous = screenMode
        screenMode = mode
        let added: [any RecordingTrack]
        do {
            added = try await track.setMode(mode)
        } catch {
            screenMode = previous
            throw error
        }
        await add(added)
    }

    /// Pins exactly `windowIds`: see `ScreenRecordingTrack.setPinnedWindows`. Windows pinned for the first time get
    /// new tracks, which start now if recording, or on resume.
    public func setPinnedWindows(_ windowIds: [UInt32]) async throws {
        guard state == .recording || state == .paused else {
            throw HelperError(.invalidState, "session is not active")
        }
        guard let screen = tracks.first(where: { $0.kind == .screen }) as? any ScreenRecordingTrack
        else {
            throw HelperError(.invalidConfig, "session has no screen track")
        }
        await add(try await screen.setPinnedWindows(windowIds))
    }

    /// Makes the session record `next`: see `updateSession` in the protocol. Sources are matched to tracks by device;
    /// one switched back on continues on its old track. Fails without changing anything if `next` is invalid, the
    /// screen mode can't start, or a newly pinned window isn't open. Tracks that start now but fail are reported with
    /// `trackError`, like tracks resuming.
    public func update(_ next: SessionUpdate) async throws {
        guard state == .recording || state == .paused else {
            throw HelperError(.invalidState, "session is not active")
        }
        guard next.recordsAnything else {
            throw HelperError(.invalidConfig, "session has nothing to record")
        }
        if let error = next.screen?.mode.configError(field: "screen.mode") {
            throw HelperError(.invalidConfig, error)
        }
        for (index, camera) in next.cameras.enumerated()
        where !(camera.fps > 0 && camera.format.map({ $0.width > 0 && $0.height > 0 }) ?? true) {
            throw HelperError(.invalidConfig, "cameras[\(index)] needs a positive format and fps")
        }

        let microphones = Self.unique(next.microphones.map(\.deviceId))
        var cameras: [String: CameraConfig] = [:]
        for camera in next.cameras where cameras[camera.deviceId] == nil {
            cameras[camera.deviceId] = camera
        }
        let cameraIds = Self.unique(next.cameras.map(\.deviceId))
        let known = { (kind: TrackKind) in Set(self.tracks.filter { $0.kind == kind }.map(\.source))
        }
        let screen = tracks.first { $0.kind == .screen } as? any ScreenRecordingTrack

        // Everything that can fail comes first, so a failure changes nothing.
        let pinsChanged =
            next.screen.map { $0.pinnedWindowIds != screenConfig?.pinnedWindowIds } ?? false
        if let next = next.screen, pinsChanged, let screen {
            try await screen.checkPinnedWindows(next.pinnedWindowIds)
        }
        let added = try makeTracks(
            SessionConfig(
                outputDirectory: directory.deletingLastPathComponent().path,
                screen: screen == nil ? next.screen : nil,
                microphones: microphones.filter { !known(.microphone).contains($0) }.map(
                    MicrophoneConfig.init),
                cameras: cameraIds.filter { !known(.camera).contains($0) }.compactMap {
                    cameras[$0]
                },
                systemAudio: next.systemAudio && !tracks.contains { $0.kind == .systemAudio }
            ),
            context
        )
        var created: [any RecordingTrack] = []
        if let next = next.screen, let screen, next.mode != screenMode {
            let previous = screenMode
            screenMode = next.mode
            do {
                created += try await screen.setMode(next.mode)
            } catch {
                screenMode = previous
                throw error
            }
        }
        if screen == nil, let mode = next.screen?.mode { screenMode = mode }

        // Nothing fails from here.
        var switchedOn: [any RecordingTrack] = []
        var switchedOff: [any RecordingTrack] = []
        func set(_ track: any RecordingTrack, on: Bool) {
            if on, removed.remove(track.id) != nil { switchedOn.append(track) }
            if !on, !removed.contains(track.id) {
                removed.insert(track.id)
                switchedOff.append(track)
            }
        }
        if let next = next.screen, let screen {
            if pinsChanged {
                // Checked above; a window that closed since starts no track and records nothing.
                created += (try? await screen.setPinnedWindows(next.pinnedWindowIds)) ?? []
            }
            await screen.setSettings(next)
        }
        for track in tracks {
            switch track.kind {
            case .screen: set(track, on: next.screen != nil)
            case .microphone: set(track, on: microphones.contains(track.source))
            case .systemAudio: set(track, on: next.systemAudio)
            case .camera:
                set(track, on: cameras[track.source] != nil)
                if let config = cameras[track.source], config != cameraConfigs[track.source],
                    let camera = track as? any CameraRecordingTrack
                {
                    await camera.setConfig(config)
                }
            }
        }
        if let next = next.screen { screenConfig = next }
        cameraConfigs.merge(cameras) { _, new in new }
        current = next

        if state == .recording {
            await Self.stopAll(switchedOff, reason: .removed)
            for track in switchedOn {
                do {
                    try await track.start()
                } catch {
                    await emit(.trackError(trackId: track.id, message: "\(error)"))
                }
            }
        }
        persist()
        await add(created + added)
    }

    public func addMark(kind: String, note: String?, hostTime: Double) throws -> Mark {
        guard state == .recording || state == .paused else {
            throw HelperError(.invalidState, "session is not active")
        }
        let mark = Mark(
            id: UUID().uuidString.lowercased(), time: hostTime - origin, kind: kind, note: note)
        manifest.marks.append(mark)
        persist()
        return mark
    }

    public func handle(_ event: SystemEvent) async {
        switch event {
        case .willSleep:
            asleep = true
            await interrupt(tracks, reason: .systemSleep)
        case .didWake:
            asleep = false
            await restoreTracks()
        case .screenLocked:
            locked = true
            await interrupt(tracks.filter { $0.kind == .screen }, reason: .screenLocked)
        case .screenUnlocked:
            locked = false
            await restoreTracks()
        case .displaysChanged:
            await restoreTracks()
        case .devicesChanged:
            // Microphones and cameras watch their own device.
            break
        }
    }

    // MARK: Private

    /// `screenMode`: the session's when the track sent `signal`, which a segment starting then records with.
    private func apply(_ signal: TrackSignal, screenMode: ScreenMode?) async {
        switch signal {
        case .started(let trackId, let file, let hostTime):
            let start = hostTime - origin
            guard let t = manifest.tracks.firstIndex(where: { $0.id == trackId }) else { return }
            // Pinned windows are recorded the same whatever the mode.
            let mode =
                manifest.tracks[t].kind == .screen && manifest.tracks[t].window == nil
                ? screenMode : nil
            manifest.tracks[t].segments.append(
                ManifestSegment(file: file, start: start, screenMode: mode))
            persist()
            await emit(.segmentStarted(trackId: trackId, file: file, start: start))
        case .ended(let trackId, let file, let hostTime, let reason):
            let end = hostTime - origin
            guard
                let t = manifest.tracks.firstIndex(where: { $0.id == trackId }),
                let s = manifest.tracks[t].segments.lastIndex(where: { $0.file == file })
            else { return }
            manifest.tracks[t].segments[s].end = end
            manifest.tracks[t].segments[s].endReason = reason
            persist()
            await emit(.segmentEnded(trackId: trackId, file: file, end: end, reason: reason))
        case .window(let hostTime, let window, let hidden):
            manifest.windows.append(
                WindowSample(time: hostTime - origin, window: window, hidden: hidden ? true : nil))
            persist()
        case .bounds(let trackId, let hostTime, let window, let frame):
            appendBounds(
                BoundsSample(time: hostTime - origin, window: window, frame: frame),
                trackId: trackId)
        case .failed(let trackId, let message, let fatal):
            Log.error("\(trackId): \(message)")
            await emit(.trackError(trackId: trackId, message: message))
            if fatal {
                // Not awaited: stop() drains this signal loop.
                Task { _ = await self.stop(reason: .diskFull) }
            }
        }
    }

    /// Tracks created mid-session, for areas or pinned windows: start now if recording, or on resume.
    private func add(_ added: [any RecordingTrack]) async {
        guard !added.isEmpty else { return }
        // In the manifest before they start, so their first segments are recorded.
        tracks += added
        manifest.tracks += added.map(Self.describe)
        persist()
        guard state == .recording else { return }
        for track in added {
            do {
                try await track.start()
            } catch {
                await emit(.trackError(trackId: track.id, message: "\(error)"))
            }
        }
    }

    private func interrupt(_ tracks: [any RecordingTrack], reason: SegmentEndReason) async {
        guard state == .recording else { return }
        await withTaskGroup(of: Void.self) { group in
            for track in tracks {
                group.addTask { await track.interrupt(reason: reason) }
            }
        }
    }

    /// Continues any interrupted track whose cause has cleared. Screens stay off while locked.
    private func restoreTracks() async {
        guard state == .recording, !asleep else { return }
        for track in tracks where !(locked && track.kind == .screen) && !removed.contains(track.id)
        {
            await track.restore()
        }
    }

    /// Appends to the track's bounds file, creating it (and naming it in the manifest) on first use. Appending keeps
    /// per-frame samples cheap and survives a crash.
    private func appendBounds(_ sample: BoundsSample, trackId: String) {
        do {
            if boundsFiles[trackId] == nil {
                guard let t = manifest.tracks.firstIndex(where: { $0.id == trackId }) else {
                    return
                }
                let name = "\(trackId)-bounds.jsonl"
                let url = directory.appending(path: name)
                FileManager.default.createFile(atPath: url.path, contents: nil)
                boundsFiles[trackId] = try FileHandle(forWritingTo: url)
                manifest.tracks[t].bounds = name
                persist()
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try boundsFiles[trackId]?.write(contentsOf: encoder.encode(sample) + Data("\n".utf8))
        } catch {
            Log.error("\(trackId): failed to write bounds: \(error)")
        }
    }

    /// Ends every track's segment at `hostTime`, if given, or at each one's last sample. Devices deliver samples a
    /// little after they're captured, so the tracks keep capturing for `stopDrain` past `hostTime`, then each trims to
    /// it, and they all end together.
    private func stopTracks(reason: SegmentEndReason, at hostTime: Double?) async {
        if let hostTime {
            let wait = stopDrain - .seconds(clock.now() - hostTime)
            if wait > .zero { try? await Task.sleep(for: wait) }
        }
        await Self.stopAll(tracks, reason: reason, at: hostTime)
    }

    private func elapsed() -> Double {
        clock.now() - origin
    }

    private func closePause() {
        guard let last = manifest.pauses.indices.last, manifest.pauses[last].end == nil else {
            return
        }
        manifest.pauses[last].end = elapsed()
    }

    private func persist() {
        do {
            try ManifestStore.write(manifest, to: directory)
        } catch {
            Log.error("failed to write manifest: \(error)")
        }
    }

    private static func describe(_ track: any RecordingTrack) -> ManifestTrack {
        ManifestTrack(
            id: track.id, kind: track.kind, source: track.source, display: track.display,
            window: track.window)
    }

    private static func stopAll(
        _ tracks: [any RecordingTrack], reason: SegmentEndReason, at hostTime: Double? = nil
    ) async {
        await withTaskGroup(of: Void.self) { group in
            for track in tracks {
                group.addTask { await track.stop(reason: reason, at: hostTime) }
            }
        }
    }

    private static func unique<T: Hashable>(_ values: [T]) -> [T] {
        var seen: Set<T> = []
        return values.filter { seen.insert($0).inserted }
    }

    private static func makeId(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let suffix = UUID().uuidString.prefix(4).lowercased()
        return "\(formatter.string(from: date))-\(suffix)"
    }
}
