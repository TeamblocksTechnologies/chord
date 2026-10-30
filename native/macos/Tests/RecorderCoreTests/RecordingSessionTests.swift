import Foundation
import Testing
import os

@testable import RecorderCore

@Test func recordsSegmentsPausesAndMarks() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let events = Collector<Event>()
    let session = try RecordingSession(
        config: SessionConfig(
            outputDirectory: output.path, microphones: [MicrophoneConfig(deviceId: "a")]),
        clock: time.clock,
        makeTracks: { _, context in [FakeTrack(id: "mic-1", context: context)] },
        emit: { await events.add($0) }
    )

    _ = try await session.start()
    time.advance(5)
    let mark = try await session.addMark(kind: "retake", note: nil, hostTime: time.now())
    _ = try await session.pause()
    time.advance(10)
    _ = try await session.resume()
    time.advance(5)
    let info = await session.stop()

    #expect(info.state == .stopped)
    #expect(mark.time == 5)
    let manifest = try ManifestStore.read(from: session.directory)
    #expect(
        manifest.tracks[0].segments == [
            ManifestSegment(file: "mic-1-001.m4a", start: 0, end: 5, endReason: .paused),
            ManifestSegment(file: "mic-1-002.m4a", start: 15, end: 20, endReason: .stopped),
        ])
    #expect(manifest.pauses == [Pause(start: 5, end: 15)])
    #expect(manifest.marks == [mark])
    #expect(manifest.stoppedAt == 20)
    #expect(manifest.stopReason == .requested)
    #expect(await events.items.last == .sessionState(info))
}

@Test func tracksStoppedTogetherEndWhenAsked() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let session = try RecordingSession(
        config: SessionConfig(
            outputDirectory: output.path, screen: ScreenConfig(mode: .mainDisplay),
            microphones: [MicrophoneConfig(deviceId: "a")]
        ),
        clock: time.clock,
        stopDrain: .milliseconds(10),
        makeTracks: { _, context in
            [
                FakeTrack(id: "screen", kind: .screen, context: context),
                FakeTrack(id: "mic-1", context: context),
            ]
        },
        emit: { _ in }
    )

    _ = try await session.start()
    time.advance(3)
    let pausedAt = time.now()
    // Handled a moment after it was asked for.
    time.advance(0.25)
    _ = try await session.pause(at: pausedAt)
    _ = try await session.resume()
    time.advance(2)
    let stoppedAt = time.now()
    time.advance(0.5)
    _ = await session.stop(at: stoppedAt)

    let manifest = try ManifestStore.read(from: session.directory)
    for track in manifest.tracks {
        #expect(track.segments.map(\.end) == [3, 5.25])
    }
    #expect(manifest.pauses == [Pause(start: 3, end: 3.25)])
    #expect(manifest.stoppedAt == 5.25)
}

@Test func switchesScreenModeInNewSegments() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let display = ScreenMode.mainDisplay
    let window = ScreenMode.focusedWindow(bundleIds: ["com.apple.Notes"])
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path, screen: ScreenConfig(mode: display)),
        clock: time.clock,
        makeTracks: { _, context in [FakeTrack(id: "screen", kind: .screen, context: context)] },
        emit: { _ in }
    )

    _ = try await session.start()
    time.advance(2)
    try await session.setScreenMode(window)
    time.advance(2)
    _ = try await session.pause()
    try await session.setScreenMode(display)
    _ = try await session.resume()
    await #expect(throws: HelperError(.invalidConfig, "mode.bundleIds must not be empty")) {
        try await session.setScreenMode(.applications(bundleIds: [], displayId: nil))
    }
    time.advance(2)
    _ = await session.stop()

    // Signals are applied asynchronously.
    #expect(
        await eventually {
            (try? ManifestStore.read(from: session.directory))?.tracks[0].segments.count == 3
        })
    #expect(
        try ManifestStore.read(from: session.directory).tracks[0].segments == [
            ManifestSegment(
                file: "screen-001.mp4", start: 0, end: 2, endReason: .modeChanged,
                screenMode: display),
            ManifestSegment(
                file: "screen-002.mp4", start: 2, end: 4, endReason: .paused, screenMode: window),
            ManifestSegment(
                file: "screen-003.mp4", start: 4, end: 6, endReason: .stopped, screenMode: display),
        ])
}

@Test func areasGetTracksOfTheirOwn() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path, screen: ScreenConfig()),
        clock: time.clock,
        makeTracks: { _, context in [FakeTrack(id: "screen", kind: .screen, context: context)] },
        emit: { _ in }
    )
    let area = ScreenArea(displayId: 1, x: 0, y: 0, width: 640, height: 360)
    let two = ScreenMode.area(areas: [area, area], background: .transparent)

    _ = try await session.start()
    await #expect(throws: HelperError(.invalidConfig, "mode.areas must not be empty")) {
        try await session.setScreenMode(.area(areas: [], background: .desktop))
    }
    await #expect(
        throws: HelperError(.invalidConfig, "mode.areas[0] needs a positive width and height")
    ) {
        try await session.setScreenMode(
            .area(
                areas: [ScreenArea(displayId: 1, x: 0, y: 0, width: 0, height: 9)],
                background: .desktop))
    }
    time.advance(2)
    try await session.setScreenMode(two)
    time.advance(2)
    _ = try await session.pause()
    // Fewer areas reuse the tracks there are; paused, they start on resume.
    try await session.setScreenMode(.area(areas: [area], background: .desktop))
    try await session.setScreenMode(.area(areas: [area, area, area], background: .desktop))
    _ = try await session.resume()
    time.advance(2)
    _ = await session.stop()

    #expect(
        await eventually {
            (try? ManifestStore.read(from: session.directory))?.tracks.last?.segments.last?.end
                != nil
        })
    let manifest = try ManifestStore.read(from: session.directory)
    #expect(manifest.tracks.map(\.id) == ["screen", "area-1", "area-2", "area-3"])
    #expect(manifest.tracks[1].segments.map(\.start) == [2, 4])
    #expect(manifest.tracks[1].segments.first?.screenMode == two)
    #expect(manifest.tracks[3].segments.map(\.start) == [4])
}

@Test func recordsWindowsAndBounds() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let signal = OSAllocatedUnfairLock<(@Sendable (TrackSignal) -> Void)?>(initialState: nil)
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path, screen: ScreenConfig()),
        clock: time.clock,
        makeTracks: { _, context in
            signal.withLock { $0 = context.signal }
            return [FakeTrack(id: "screen-1", kind: .screen, context: context)]
        },
        emit: { _ in }
    )
    let send = { (s: TrackSignal) in signal.withLock { $0 }?(s) }
    let window = RecordedWindow(id: 7, bundleId: "com.apple.Notes", title: "Notes")
    let frame = Rect(CGRect(x: 10, y: 20, width: 300, height: 200))

    _ = try await session.start()
    time.advance(1)
    send(.window(hostTime: time.now(), window: window, hidden: false))
    send(.bounds(trackId: "screen-1", hostTime: time.now(), window: 7, frame: frame))
    time.advance(1)
    send(.bounds(trackId: "screen-1", hostTime: time.now(), window: nil, frame: nil))
    send(.window(hostTime: time.now(), window: window, hidden: true))
    #expect(
        await eventually { (try? ManifestStore.read(from: session.directory))?.windows.count == 2 })
    _ = await session.stop()

    let manifest = try ManifestStore.read(from: session.directory)
    #expect(
        manifest.windows == [
            WindowSample(time: 1, window: window, hidden: nil),
            WindowSample(time: 2, window: window, hidden: true),
        ])
    #expect(manifest.tracks[0].bounds == "screen-1-bounds.jsonl")
    let lines = try String(
        contentsOf: session.directory.appending(path: "screen-1-bounds.jsonl"), encoding: .utf8
    )
    .split(separator: "\n")
    .map { try JSONDecoder().decode(BoundsSample.self, from: Data($0.utf8)) }
    #expect(
        lines == [
            BoundsSample(time: 1, window: 7, frame: frame),
            BoundsSample(time: 2, window: nil, frame: nil),
        ])
}

@Test func pinnedWindowsGetTracksOutsideTheMode() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let mode = ScreenMode.focusedWindow(bundleIds: nil)
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path, screen: ScreenConfig(mode: mode)),
        clock: time.clock,
        makeTracks: { _, context in [FakeTrack(id: "screen-1", kind: .screen, context: context)] },
        emit: { _ in }
    )
    let window = RecordedWindow(id: 7, bundleId: "com.apple.Notes")

    _ = try await session.start()
    time.advance(1)
    try await session.setPinnedWindows([7])
    // Already pinned: no new track. A window that isn't open fails without changing anything.
    try await session.setPinnedWindows([7])
    await #expect(throws: HelperError(.windowUnavailable, "window 101 is not open")) {
        try await session.setPinnedWindows([7, 101])
    }
    time.advance(1)
    _ = try await session.pause()
    // Pinned while paused: starts on resume.
    try await session.setPinnedWindows([7, 8])
    time.advance(1)
    _ = try await session.resume()
    time.advance(1)
    _ = await session.stop()

    #expect(
        await eventually {
            (try? ManifestStore.read(from: session.directory))?.tracks.map(\.segments.count) == [
                2, 2, 1,
            ]
        })
    let manifest = try ManifestStore.read(from: session.directory)
    #expect(manifest.tracks.map(\.id) == ["screen-1", "window-1", "window-2"])
    #expect(manifest.tracks[1].window == window)
    #expect(manifest.tracks[0].segments.allSatisfy { $0.screenMode == mode })
    #expect(
        manifest.tracks[1].segments == [
            ManifestSegment(file: "window-1-001.mp4", start: 1, end: 2, endReason: .paused),
            ManifestSegment(file: "window-1-002.mp4", start: 3, end: 4, endReason: .stopped),
        ])
    #expect(
        manifest.tracks[2].segments == [
            ManifestSegment(file: "window-2-001.mp4", start: 3, end: 4, endReason: .stopped)
        ])
}

@Test func setPinnedWindowsNeedsAnActiveScreenSession() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path),
        clock: FakeClock().clock,
        makeTracks: { _, context in [FakeTrack(id: "mic-1", context: context)] },
        emit: { _ in }
    )
    await #expect(throws: HelperError(.invalidState, "session is not active")) {
        try await session.setPinnedWindows([7])
    }
    _ = try await session.start()
    await #expect(throws: HelperError(.invalidConfig, "session has no screen track")) {
        try await session.setPinnedWindows([7])
    }
    _ = await session.stop()
}

@Test func setScreenModeNeedsAScreenTrack() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path),
        clock: FakeClock().clock,
        makeTracks: { _, context in [FakeTrack(id: "mic-1", context: context)] },
        emit: { _ in }
    )
    _ = try await session.start()
    await #expect(throws: HelperError(.invalidConfig, "session has no screen track")) {
        try await session.setScreenMode(.mainDisplay)
    }
    _ = await session.stop()
}

@Test func failedStartCleansUp() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path),
        clock: FakeClock().clock,
        makeTracks: { _, context in
            [
                FakeTrack(id: "mic-1", context: context),
                FakeTrack(id: "mic-2", context: context, failsToStart: true),
            ]
        },
        emit: { _ in }
    )

    await #expect(throws: HelperError.self) { try await session.start() }
    #expect(!FileManager.default.fileExists(atPath: session.directory.path))
}

private struct Harness {
    let output = temporaryDirectory()
    let time = FakeClock()
    let session: RecordingSession
    let screen: FakeTrack
    let mic: FakeTrack

    init() throws {
        let tracks = OSAllocatedUnfairLock<[FakeTrack]>(initialState: [])
        session = try RecordingSession(
            config: SessionConfig(outputDirectory: output.path),
            clock: time.clock,
            restoreInterval: .seconds(3600),
            makeTracks: { _, context in
                let made = [
                    FakeTrack(id: "screen", kind: .screen, context: context),
                    FakeTrack(id: "mic-1", context: context),
                ]
                tracks.withLock { $0 = made }
                return made
            },
            emit: { _ in }
        )
        let made = tracks.withLock { $0 }
        screen = made[0]
        mic = made[1]
    }

    func segments(_ trackId: String) throws -> [ManifestSegment] {
        try ManifestStore.read(from: session.directory).tracks.first { $0.id == trackId }!.segments
    }
}

@Test func sleepEndsEverySegmentAndWakeContinues() async throws {
    let h = try Harness()
    defer { try? FileManager.default.removeItem(at: h.output) }
    _ = try await h.session.start()
    h.time.advance(5)
    await h.session.handle(.willSleep)
    h.time.advance(60)
    await h.session.handle(.displaysChanged)  // ignored while asleep
    await h.session.handle(.didWake)
    h.time.advance(5)
    _ = await h.session.stop()

    for id in ["screen", "mic-1"] {
        #expect(
            try h.segments(id) == [
                ManifestSegment(
                    file: "\(id)-001.\(id == "screen" ? "mp4" : "m4a")", start: 0, end: 5,
                    endReason: .systemSleep),
                ManifestSegment(
                    file: "\(id)-002.\(id == "screen" ? "mp4" : "m4a")", start: 65, end: 70,
                    endReason: .stopped),
            ])
    }
}

@Test func lockOnlyStopsTheScreen() async throws {
    let h = try Harness()
    defer { try? FileManager.default.removeItem(at: h.output) }
    _ = try await h.session.start()
    h.time.advance(5)
    await h.session.handle(.screenLocked)
    h.time.advance(10)
    await h.session.handle(.didWake)  // still locked: screen stays off
    await h.session.handle(.screenUnlocked)
    h.time.advance(5)
    _ = await h.session.stop()

    #expect(try h.segments("screen").map(\.endReason) == [.screenLocked, .stopped])
    #expect(try h.segments("screen").map(\.start) == [0, 15])
    #expect(try h.segments("mic-1").count == 1)
}

@Test func failedTrackResumesOnRestore() async throws {
    let h = try Harness()
    defer { try? FileManager.default.removeItem(at: h.output) }
    _ = try await h.session.start()
    h.time.advance(5)
    h.mic.fail(diskFull: false)
    await h.session.handle(.displaysChanged)
    _ = await h.session.stop()

    #expect(try h.segments("mic-1").map(\.endReason) == [.error, .stopped])
    #expect(await h.session.info.stopReason == .requested)
}

@Test func diskFullStopsTheSession() async throws {
    let h = try Harness()
    defer { try? FileManager.default.removeItem(at: h.output) }
    _ = try await h.session.start()
    h.time.advance(5)
    h.mic.fail(diskFull: true)

    // The session stops on its own, so wait for the stop reason to be saved.
    #expect(
        await eventually {
            (try? ManifestStore.read(from: h.session.directory))?.stopReason == .diskFull
        })
    #expect(try h.segments("mic-1").map(\.endReason) == [.diskFull])
    #expect(try h.segments("screen").map(\.endReason) == [.stopped])
}

@Test func updateSwitchesSourcesOnAndOff() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let session = try RecordingSession(
        config: SessionConfig(
            outputDirectory: output.path, microphones: [MicrophoneConfig(deviceId: "a")]),
        clock: time.clock,
        makeTracks: fakeTracks,
        emit: { _ in }
    )
    let camera = CameraConfig(deviceId: "cam", format: CameraConfig.Size(width: 1280, height: 720))

    _ = try await session.start()
    time.advance(1)
    // A second microphone, a camera, the screen, and system audio join; the first microphone carries on.
    try await session.update(
        SessionUpdate(
            screen: ScreenConfig(),
            microphones: [MicrophoneConfig(deviceId: "a"), MicrophoneConfig(deviceId: "b")],
            cameras: [camera], systemAudio: true
        ))
    time.advance(1)
    // The first microphone goes, the camera changes size, and the screen's settings change.
    var smaller = camera
    smaller.format = CameraConfig.Size(width: 640, height: 360)
    try await session.update(
        SessionUpdate(
            screen: ScreenConfig(showsCursor: false),
            microphones: [MicrophoneConfig(deviceId: "b")], cameras: [smaller],
            systemAudio: true
        ))
    time.advance(1)
    _ = try await session.pause()
    // Switched back on while paused: it continues on its old track on resume.
    try await session.update(
        SessionUpdate(microphones: [
            MicrophoneConfig(deviceId: "b"), MicrophoneConfig(deviceId: "a"),
        ]))
    _ = try await session.resume()
    time.advance(1)
    await #expect(throws: HelperError(.invalidConfig, "session has nothing to record")) {
        try await session.update(SessionUpdate())
    }
    _ = await session.stop()

    #expect(
        await eventually {
            (try? ManifestStore.read(from: session.directory))?.tracks.allSatisfy {
                $0.segments.last?.end != nil
            } == true
        })
    let manifest = try ManifestStore.read(from: session.directory)
    let segments = Dictionary(
        uniqueKeysWithValues: manifest.tracks.map { track in
            (track.id, track.segments.map { [$0.start, $0.end ?? -1] })
        })
    #expect(
        manifest.tracks.map(\.id) == ["mic-1", "screen-1", "system-audio", "mic-2", "camera-1"])
    #expect(
        manifest.tracks.first { $0.id == "mic-1" }?.segments.map(\.endReason) == [
            .removed, .stopped,
        ])
    #expect(segments["mic-1"] == [[0, 2], [3, 4]])
    #expect(segments["mic-2"] == [[1, 3], [3, 4]])
    #expect(
        manifest.tracks.first { $0.id == "camera-1" }?.segments.map(\.endReason) == [
            .configChanged, .paused,
        ])
    #expect(segments["camera-1"] == [[1, 2], [2, 3]])
    #expect(
        manifest.tracks.first { $0.id == "screen-1" }?.segments.map(\.endReason) == [
            .configChanged, .paused,
        ])
    #expect(segments["system-audio"] == [[1, 3]])
}

@Test func updateFailsWithoutChangingAnything() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let session = try RecordingSession(
        config: SessionConfig(outputDirectory: output.path, screen: ScreenConfig()),
        clock: time.clock,
        makeTracks: fakeTracks,
        emit: { _ in }
    )
    await #expect(throws: HelperError(.invalidState, "session is not active")) {
        try await session.update(SessionUpdate(screen: ScreenConfig()))
    }
    _ = try await session.start()
    time.advance(1)
    // A pinned window that isn't open fails before the microphone is added.
    await #expect(throws: HelperError(.windowUnavailable, "window 200 is not open")) {
        try await session.update(
            SessionUpdate(
                screen: ScreenConfig(pinnedWindowIds: [200]),
                microphones: [MicrophoneConfig(deviceId: "a")]
            ))
    }
    await #expect(throws: HelperError(.invalidConfig, "cameras[0] needs a positive format and fps"))
    {
        try await session.update(SessionUpdate(cameras: [CameraConfig(deviceId: "cam", fps: 0)]))
    }
    time.advance(1)
    _ = await session.stop()

    #expect(
        await eventually {
            (try? ManifestStore.read(from: session.directory))?.tracks.first?.segments.last?.end
                != nil
        })
    let manifest = try ManifestStore.read(from: session.directory)
    #expect(manifest.tracks.map(\.id) == ["screen-1"])
    #expect(manifest.tracks[0].segments.map(\.endReason) == [.stopped])
}
