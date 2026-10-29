import Foundation

public actor Helper {
    public static let version = "0.1.0"

    private let send: @Sendable (Outgoing) async -> Void
    private let clock: HostClock
    private let makeTracks: TrackFactory
    private let levels = LevelBoard()
    private let meteringInterval: Duration
    private let preview: AudioPreview
    private let previewInterval: Duration
    private var session: RecordingSession?
    private var metering: Task<Void, Never>?
    private var previewing: Task<Void, Never>?
    private let screenPreviews: ScreenPreviews
    private let findWindow: @Sendable (WindowPreviewConfig) -> PreviewWindow?
    private let windowPreviewInterval: Duration
    private var windowPreviewing: Task<Void, Never>?
    private let readMouseDown: @Sendable () -> Bool
    private let mouseWatchInterval: Duration
    private var mouseWatching: Task<Void, Never>?
    private let readKeys: @Sendable () -> KeyState
    private let keyWatchInterval: Duration
    private var keyWatching: Task<Void, Never>?
    private let readInput: (@Sendable () -> InputState)?
    private let warmer: DeviceWarmer

    public init(
        send: @escaping @Sendable (Outgoing) async -> Void,
        clock: HostClock = .host,
        makeTracks: @escaping TrackFactory = liveTracks,
        meteringInterval: Duration = .milliseconds(100),
        makeAudioMeter: @escaping AudioMeterFactory = liveAudioMeters,
        previewInterval: Duration = .milliseconds(50),
        findWindow: @escaping @Sendable (WindowPreviewConfig) -> PreviewWindow? =
            liveWindowToFollow,
        windowPreviewInterval: Duration = .milliseconds(250),
        readMouseDown: @escaping @Sendable () -> Bool = liveMouseDown,
        mouseWatchInterval: Duration = .milliseconds(10),
        readKeys: @escaping @Sendable () -> KeyState = liveKeyState,
        keyWatchInterval: Duration = .milliseconds(10),
        readInput: (@Sendable () -> InputState)? = liveInputState,
        frames: (any FrameSink)? = nil,
        makeScreenPreview: @escaping ScreenPreviewFactory = liveScreenPreviews,
        makeWarmDevice: @escaping WarmDeviceFactory = liveWarmDevices
    ) {
        warmer = DeviceWarmer(makeDevice: makeWarmDevice)
        self.readKeys = readKeys
        self.readInput = readInput
        self.keyWatchInterval = keyWatchInterval
        self.readMouseDown = readMouseDown
        self.mouseWatchInterval = mouseWatchInterval
        self.findWindow = findWindow
        self.windowPreviewInterval = windowPreviewInterval
        self.send = send
        self.clock = clock
        self.makeTracks = makeTracks
        self.meteringInterval = meteringInterval
        preview = AudioPreview(makeMeter: makeAudioMeter)
        self.previewInterval = previewInterval
        screenPreviews = ScreenPreviews(start: makeScreenPreview, frames: frames)
    }

    /// Reads requests until `lines` ends (stdin closed) or a shutdown command arrives.
    public nonisolated func run<Lines: AsyncSequence>(lines: Lines) async
    where Lines.Element == String {
        let monitor = SystemMonitor()
        let systemEvents = Task {
            for await event in monitor.events { await self.forward(event) }
        }
        defer { systemEvents.cancel() }

        await send(.event(.ready(version: Self.version)))
        do {
            for try await line in lines {
                guard !line.isEmpty else { continue }
                // Stamp on arrival so marks reflect when the user pressed the shortcut.
                let receivedAt = clock.now()
                if await handle(line: line, receivedAt: receivedAt) == .stop { break }
            }
        } catch {
            Log.error("input failed: \(error)")
        }
        await shutdown()
    }

    /// Finalizes any in-progress recording. Also called from the signal handler path.
    public func shutdown() async {
        Log.info("shutting down")
        setMetering(enabled: false)
        _ = await setAudioPreview([])
        await warmer.set(SessionUpdate())
        _ = await screenPreviews.set([])
        _ = setWindowPreview(WindowPreviewConfig(enabled: false))
        setMouseWatch(enabled: false)
        setKeyWatch(enabled: false)
        if let session {
            _ = await session.stop(reason: .shutdown)
            self.session = nil
        }
    }

    private func forward(_ event: SystemEvent) async {
        Log.info("system event: \(event)")
        if event == .devicesChanged {
            await send(.event(.devicesChanged))
        } else {
            await session?.handle(event)
        }
    }

    private enum Flow { case `continue`, stop }

    private func handle(line: String, receivedAt: Double) async -> Flow {
        let request: Request
        switch Request.parse(line) {
        case .success(let parsed):
            request = parsed
        case .failure(let failure):
            if failure.isNotification {
                Log.error("notification failed: \(failure.error.message)")
            } else {
                await send(.error(id: failure.id, failure.error))
            }
            return .continue
        }

        do {
            let result = try await perform(request.command, receivedAt: receivedAt)
            if let id = request.id { await send(.response(id: id, result: result)) }
        } catch {
            let rpcError = (error as? HelperError)?.rpcError ?? .internalError("\(error)")
            if let id = request.id {
                await send(.error(id: id, rpcError))
            } else {
                Log.error("notification failed: \(rpcError.message)")
            }
        }
        return request.command == .shutdown ? .stop : .continue
    }

    private func perform(_ command: Command, receivedAt: Double) async throws -> ResponseResult {
        switch command {
        case .ping, .shutdown:
            return .none
        case .getPermissions:
            return .permissions(PermissionCenter.current())
        case .requestPermission(let kind):
            return .permissions(await PermissionCenter.request(kind))
        case .listSources:
            return .sources(await SourceCatalog.list())
        case .warmUp(let update):
            await warmer.set(update)
            return .none
        case .startSession(let config):
            // The session's tracks take over the warm devices they record; the rest are released, whether or not it starts.
            defer { Task { await warmer.set(SessionUpdate()) } }
            if let session, await session.state != .stopped {
                throw HelperError(.sessionActive, "a session is already in progress")
            }
            // Before the session's clock starts, so a camera records from the start rather than a second or so in.
            await warmer.set(
                SessionUpdate(microphones: config.microphones, cameras: config.cameras))
            let send = self.send
            let session = try RecordingSession(
                config: config, clock: clock, levels: levels, makeTracks: makeTracks,
                readInput: readInput,
                adopt: { [warmer] in await warmer.take($0) }, emit: { await send(.event($0)) }
            )
            self.session = session
            do {
                return .session(try await session.start())
            } catch {
                self.session = nil
                throw error
            }
        case .stopSession:
            let info = try await activeSession().stop(at: receivedAt)
            session = nil
            return .session(info)
        case .pauseSession:
            return .session(try await activeSession().pause(at: receivedAt))
        case .resumeSession:
            return .session(try await activeSession().resume())
        case .setScreenMode(let mode):
            try await activeSession().setScreenMode(mode)
            return .none
        case .setPinnedWindows(let windowIds):
            try await activeSession().setPinnedWindows(windowIds)
            return .none
        case .updateSession(let update):
            try await activeSession().update(update)
            return .none
        case .addMark(let kind, let note):
            return .mark(
                try await activeSession().addMark(kind: kind, note: note, hostTime: receivedAt))
        case .setMetering(let enabled):
            setMetering(enabled: enabled)
            return .none
        case .setAudioPreview(let sources):
            return .audioPreview(failures: await setAudioPreview(sources))
        case .setScreenPreview(let previews):
            return .screenPreview(failures: await screenPreviews.set(previews))
        case .setWindowPreview(let config):
            return .previewWindow(setWindowPreview(config))
        case .setMouseWatch(let enabled):
            setMouseWatch(enabled: enabled)
            return .none
        case .setKeyWatch(let enabled):
            setKeyWatch(enabled: enabled)
            return .none
        }
    }

    /// Polls whether a mouse button is held and sends `mouseButton` when that changes, starting with the current state.
    private func setMouseWatch(enabled: Bool) {
        mouseWatching?.cancel()
        mouseWatching = nil
        guard enabled else { return }
        mouseWatching = Task { [readMouseDown, send, mouseWatchInterval] in
            var last: Bool?
            while !Task.isCancelled {
                let down = readMouseDown()
                if down != last {
                    last = down
                    await send(.event(.mouseButton(down: down)))
                }
                try? await Task.sleep(for: mouseWatchInterval)
            }
        }
    }

    /// Polls the keyboard and sends `keyPress` for each key that goes down. Keys already held when it starts are
    /// ignored, and holding one doesn't repeat it.
    private func setKeyWatch(enabled: Bool) {
        keyWatching?.cancel()
        keyWatching = nil
        guard enabled else { return }
        keyWatching = Task { [readKeys, send, keyWatchInterval] in
            var held = readKeys().keys
            while !Task.isCancelled {
                let state = readKeys()
                for key in state.keys.subtracting(held).sorted() {
                    await send(.event(.keyPress(keyCode: key, modifiers: state.modifiers.sorted())))
                }
                held = state.keys
                try? await Task.sleep(for: keyWatchInterval)
            }
        }
    }

    /// Polls which window `focusedWindow` would follow and sends `previewWindow` when it changes.
    private func setWindowPreview(_ config: WindowPreviewConfig) -> PreviewWindow? {
        windowPreviewing?.cancel()
        windowPreviewing = nil
        guard config.enabled else { return nil }
        let current = findWindow(config)
        windowPreviewing = Task { [findWindow, send, windowPreviewInterval] in
            var last = current
            while !Task.isCancelled {
                try? await Task.sleep(for: windowPreviewInterval)
                guard !Task.isCancelled else { break }
                let next = findWindow(config)
                if next != last {
                    last = next
                    await send(.event(.previewWindow(next)))
                }
            }
        }
        return current
    }

    /// Meters `sources` and sends `previewLevels` while any are running, sampled like `setMetering`.
    private func setAudioPreview(_ sources: [AudioSource]) async -> [AudioSourceFailure] {
        let failures = await preview.set(sources)
        previewing?.cancel()
        previewing = nil
        guard await preview.isActive else { return failures }
        previewing = Task { [preview, send, previewInterval] in
            while !Task.isCancelled {
                try? await Task.sleep(for: previewInterval)
                let snapshot = preview.snapshot()
                guard !snapshot.isEmpty, !Task.isCancelled else { continue }
                await send(.event(.previewLevels(snapshot)))
            }
        }
        return failures
    }

    /// Sends one `levels` notification per tick with every track's latest level. Each tick waits for the
    /// previous write, so a reader that stops consuming stdout causes skipped ticks rather than a backlog.
    private func setMetering(enabled: Bool) {
        metering?.cancel()
        metering = nil
        guard enabled else { return }
        metering = Task { [levels, send, meteringInterval] in
            while !Task.isCancelled {
                try? await Task.sleep(for: meteringInterval)
                let snapshot = levels.snapshot()
                guard !snapshot.isEmpty, !Task.isCancelled else { continue }
                await send(.event(.levels(snapshot)))
            }
        }
    }

    private func activeSession() throws -> RecordingSession {
        guard let session else { throw HelperError(.noSession, "no session is in progress") }
        return session
    }
}
