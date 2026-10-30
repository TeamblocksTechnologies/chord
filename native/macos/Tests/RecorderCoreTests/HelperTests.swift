import Foundation
import Testing
import os

@testable import RecorderCore

private struct FakeMeter: AudioMeter {
    func stop() async {}
}

/// Meters any microphone but "missing" at a fixed level; system audio fails like it does without permission.
private let fakeMeters: AudioMeterFactory = { source, update in
    switch source {
    case .microphone("missing"):
        throw HelperError(.deviceUnavailable, "microphone missing is not connected")
    case .microphone: update(-30, -12)
    case .systemAudio:
        throw HelperError(.displayUnavailable, "no display is available to capture system audio")
    }
    return FakeMeter()
}

/// Feeds `lines` to a helper, waits until its output satisfies `until`, then waits `linger` before
/// closing stdin. Waiting on output first keeps slow machines from closing stdin too early.
private func run(
    _ lines: [String], until: @escaping @Sendable ([Outgoing]) -> Bool = { _ in true },
    linger: Duration = .zero
) async -> [Outgoing] {
    let collector = Collector<Outgoing>()
    let helper = Helper(
        send: { await collector.add($0) },
        clock: FakeClock().clock,
        makeTracks: { _, context in [FakeTrack(id: "mic-1", context: context)] },
        meteringInterval: .milliseconds(10),
        makeAudioMeter: fakeMeters,
        previewInterval: .milliseconds(10)
    )
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    for line in lines {
        continuation.yield(line)
    }
    Task {
        await waitUntil { until(await collector.items) }
        try? await Task.sleep(for: linger)
        continuation.finish()
    }
    await helper.run(lines: input)
    return await collector.items
}

private func responded(to id: RequestID) -> @Sendable ([Outgoing]) -> Bool {
    { output in output.contains { if case .response(id, _) = $0 { true } else { false } } }
}

private func levels(in output: [Outgoing]) -> [[TrackLevel]] {
    output.compactMap { if case .event(.levels(let levels)) = $0 { levels } else { nil } }
}

private let ready = Outgoing.event(.ready(version: Helper.version))

/// Polls `condition` so timing-sensitive tests don't depend on how busy the machine is.
private func waitUntil(_ condition: () async -> Bool) async {
    _ = await eventually(condition)
}

@Test func announcesReadyThenAnswersPing() async {
    let out = await run([#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#])
    #expect(out == [ready, .response(id: 1)])
}

@Test func stopsAfterShutdown() async {
    let out = await run([
        #"{"jsonrpc":"2.0","id":1,"method":"shutdown"}"#,
        #"{"jsonrpc":"2.0","id":2,"method":"ping"}"#,
    ])
    #expect(out == [ready, .response(id: 1)])
}

@Test func reportsInvalidRequestsWithTheirId() async {
    let out = await run(["not json", #"{"jsonrpc":"2.0","id":2,"method":"nope"}"#])
    #expect(
        out == [
            ready, .error(id: nil, .parseError("invalid JSON")),
            .error(id: 2, .methodNotFound("nope")),
        ])
}

@Test func notificationsGetNoReply() async {
    let out = await run([
        #"{"jsonrpc":"2.0","method":"ping"}"#,
        #"{"jsonrpc":"2.0","method":"nope"}"#,
        #"{"jsonrpc":"2.0","method":"addMark"}"#,
    ])
    #expect(out == [ready])
}

@Test func marksRequireASession() async {
    let out = await run([#"{"jsonrpc":"2.0","id":1,"method":"addMark"}"#])
    #expect(
        out.last == .error(id: 1, HelperError(.noSession, "no session is in progress").rpcError))
}

@Test func stdinClosingFinalizesTheSession() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let start =
        #"{"jsonrpc":"2.0","id":1,"method":"startSession","params":{"outputDirectory":"\#(output.path)"}}"#
    let out = await run([start])

    let response = out.first { if case .response(1, _) = $0 { true } else { false } }
    guard case .response(_, .session(let info)) = response else {
        Issue.record("unexpected output: \(out)")
        return
    }
    let manifest = try ManifestStore.read(from: URL(filePath: info.directory))
    #expect(manifest.stoppedAt != nil)
    #expect(manifest.tracks[0].segments.first?.endReason == .stopped)
    #expect(manifest.stopReason == .shutdown)
}

@Test func meteringIsOffByDefault() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let start =
        #"{"jsonrpc":"2.0","id":1,"method":"startSession","params":{"outputDirectory":"\#(output.path)"}}"#
    let out = await run([start], until: responded(to: 1), linger: .milliseconds(100))
    #expect(levels(in: out).isEmpty)
}

@Test func meteringSendsBatchedLevelsWhileEnabled() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let out = await run(
        [
            #"{"jsonrpc":"2.0","id":1,"method":"startSession","params":{"outputDirectory":"\#(output.path)"}}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"setMetering","params":{"enabled":true}}"#,
        ],
        until: { !levels(in: $0).isEmpty }
    )
    let batches = levels(in: out)
    #expect(!batches.isEmpty)
    #expect(
        batches.allSatisfy { $0 == [TrackLevel(trackId: "mic-1", averageDb: -30, peakDb: -12)] })
}

private func previewLevels(in output: [Outgoing]) -> [[AudioSourceLevel]] {
    output.compactMap { if case .event(.previewLevels(let levels)) = $0 { levels } else { nil } }
}

@Test func audioPreviewMetersWithoutASession() async {
    let out = await run(
        [
            #"{"jsonrpc":"2.0","id":1,"method":"setAudioPreview","params":{"sources":[{"kind":"microphone","deviceId":"a"}]}}"#
        ],
        until: { !previewLevels(in: $0).isEmpty }
    )
    #expect(out.contains(.response(id: 1, result: .audioPreview(failures: []))))
    let batches = previewLevels(in: out)
    #expect(!batches.isEmpty)
    #expect(
        batches.allSatisfy {
            $0 == [
                AudioSourceLevel(source: .microphone(deviceId: "a"), averageDb: -30, peakDb: -12)
            ]
        })
}

@Test func audioPreviewReportsSourcesThatCannotStart() async {
    let out = await run(
        [
            #"{"jsonrpc":"2.0","id":1,"method":"setAudioPreview","params":{"sources":[{"kind":"microphone","deviceId":"missing"},{"kind":"systemAudio"}]}}"#
        ],
        until: responded(to: 1),
        linger: .milliseconds(50)
    )
    #expect(
        out.contains(
            .response(
                id: 1,
                result: .audioPreview(failures: [
                    AudioSourceFailure(
                        source: .microphone(deviceId: "missing"),
                        message: "microphone missing is not connected"),
                    AudioSourceFailure(
                        source: .systemAudio,
                        message: "no display is available to capture system audio"),
                ]))))
    #expect(previewLevels(in: out).isEmpty)
}

@Test func emptyAudioPreviewStopsLevels() async {
    let collector = Collector<Outgoing>()
    let helper = Helper(
        send: { await collector.add($0) }, clock: FakeClock().clock, makeAudioMeter: fakeMeters,
        previewInterval: .milliseconds(10)
    )
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    let running = Task { await helper.run(lines: input) }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":1,"method":"setAudioPreview","params":{"sources":[{"kind":"microphone","deviceId":"a"}]}}"#
    )
    await waitUntil { !previewLevels(in: await collector.items).isEmpty }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":2,"method":"setAudioPreview","params":{"sources":[]}}"#)
    await waitUntil {
        await collector.items.contains(.response(id: 2, result: .audioPreview(failures: [])))
    }
    let countAtStop = previewLevels(in: await collector.items).count
    try? await Task.sleep(for: .milliseconds(60))
    continuation.finish()
    await running.value

    #expect(countAtStop > 0)
    #expect(previewLevels(in: await collector.items).count == countAtStop)
}

private struct FakeScreenPreview: ScreenPreviewStream {
    let id: String
    let stopped: Collector<String>
    func stop() async { await stopped.add(id) }
}

private struct FakeFrames: FrameSink {
    func isReady(_ id: String) -> Bool { true }
    func send(id: String, image: Data) {}
}

@Test func screenPreviewStartsStopsAndRestartsChangedPreviews() async {
    let started = Collector<ScreenPreviewRequest>()
    let stopped = Collector<String>()
    let collector = Collector<Outgoing>()
    let helper = Helper(
        send: { await collector.add($0) }, clock: FakeClock().clock, frames: FakeFrames(),
        makeScreenPreview: { request, _ in
            if request.displayId == 9 {
                throw HelperError(.displayUnavailable, "display 9 is not connected")
            }
            await started.add(request)
            return FakeScreenPreview(id: request.id, stopped: stopped)
        }
    )
    let out = await run(
        helper,
        [
            #"{"jsonrpc":"2.0","id":1,"method":"setScreenPreview","params":{"previews":[{"id":"a","displayId":1},{"id":"b","displayId":2},{"id":"c","displayId":9}]}}"#,
            // `a` unchanged, `b` changed, and `c` dropped.
            #"{"jsonrpc":"2.0","id":2,"method":"setScreenPreview","params":{"previews":[{"id":"a","displayId":1},{"id":"b","displayId":2,"background":"transparent"}]}}"#,
            #"{"jsonrpc":"2.0","id":3,"method":"setScreenPreview","params":{"previews":[]}}"#,
        ], collector: collector)

    #expect(
        out.contains(
            .response(
                id: 1,
                result: .screenPreview(failures: [
                    ScreenPreviewFailure(id: "c", message: "display 9 is not connected")
                ]))))
    #expect(out.contains(.response(id: 2, result: .screenPreview(failures: []))))
    #expect(await started.items.map(\.id) == ["a", "b", "b"])
    #expect(await started.items.last?.background == .transparent)
    #expect(await stopped.items.sorted() == ["a", "b", "b"])
}

@Test func screenPreviewFailsWithoutAFramePipe() async {
    let collector = Collector<Outgoing>()
    let helper = Helper(send: { await collector.add($0) }, clock: FakeClock().clock)
    let out = await run(
        helper,
        [
            #"{"jsonrpc":"2.0","id":1,"method":"setScreenPreview","params":{"previews":[{"id":"a","displayId":1}]}}"#
        ], collector: collector)
    #expect(
        out.contains(
            .response(
                id: 1,
                result: .screenPreview(failures: [
                    ScreenPreviewFailure(id: "a", message: "no frame pipe is open")
                ]))))
}

/// Feeds `lines` to `helper` until stdin closes.
private func run(_ helper: Helper, _ lines: [String], collector: Collector<Outgoing>) async
    -> [Outgoing]
{
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    for line in lines {
        continuation.yield(line)
    }
    continuation.finish()
    await helper.run(lines: input)
    return await collector.items
}

@Test func windowPreviewReportsTheWindowAndItsChanges() async {
    let safari = PreviewWindow(
        id: 7, bundleId: "com.apple.Safari", appName: "Safari", title: "Docs")
    let calls = Collector<WindowPreviewConfig>()
    let collector = Collector<Outgoing>()
    // Safari for the first two lookups, then nothing.
    let lookups = OSAllocatedUnfairLock(initialState: 0)
    let helper = Helper(
        send: { await collector.add($0) }, clock: FakeClock().clock,
        findWindow: { config in
            Task { await calls.add(config) }
            return lookups.withLock { count in
                count += 1
                return count <= 2 ? safari : nil
            }
        },
        windowPreviewInterval: .milliseconds(10)
    )
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    let running = Task { await helper.run(lines: input) }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":1,"method":"setWindowPreview","params":{"enabled":true,"bundleIds":["com.apple.Safari"]}}"#
    )
    await waitUntil { await collector.items.contains(.event(.previewWindow(nil))) }
    // A few more polls, to show an unchanged window isn't resent.
    try? await Task.sleep(for: .milliseconds(40))
    continuation.yield(
        #"{"jsonrpc":"2.0","id":2,"method":"setWindowPreview","params":{"enabled":false}}"#)
    continuation.finish()
    await running.value

    let out = await collector.items
    #expect(out.contains(.response(id: 1, result: .previewWindow(safari))))
    #expect(out.contains(.response(id: 2, result: .previewWindow(nil))))
    // Only the change is sent, once.
    let changes = out.filter { if case .event(.previewWindow) = $0 { true } else { false } }
    #expect(changes == [.event(.previewWindow(nil))])
    #expect(
        await calls.items.first
            == WindowPreviewConfig(enabled: true, bundleIds: ["com.apple.Safari"]))
}

@Test func mouseWatchSendsTheButtonStateAndItsChanges() async {
    let collector = Collector<Outgoing>()
    // Up for two reads, then held.
    let reads = OSAllocatedUnfairLock(initialState: 0)
    let helper = Helper(
        send: { await collector.add($0) }, clock: FakeClock().clock,
        readMouseDown: {
            reads.withLock { count in
                count += 1
                return count > 2
            }
        },
        mouseWatchInterval: .milliseconds(10)
    )
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    let running = Task { await helper.run(lines: input) }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":1,"method":"setMouseWatch","params":{"enabled":true}}"#)
    await waitUntil { await collector.items.contains(.event(.mouseButton(down: true))) }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":2,"method":"setMouseWatch","params":{"enabled":false}}"#)
    continuation.finish()
    await running.value

    let out = await collector.items
    #expect(out.contains(.response(id: 1)))
    #expect(out.contains(.response(id: 2)))
    // The starting state, then the change; repeats aren't sent.
    let changes = out.filter { if case .event(.mouseButton) = $0 { true } else { false } }
    #expect(changes == [.event(.mouseButton(down: false)), .event(.mouseButton(down: true))])
}

@Test func keyWatchSendsEachNewKeyWithItsModifiers() async {
    let collector = Collector<Outgoing>()
    // A key already held at the start, then another with command, held for two reads, then released.
    let reads = OSAllocatedUnfairLock(initialState: 0)
    let helper = Helper(
        send: { await collector.add($0) }, clock: FakeClock().clock,
        readKeys: {
            reads.withLock { count in
                count += 1
                switch count {
                case 1: return KeyState(keys: [0])
                case 2, 3, 4: return KeyState(keys: [0, 8], modifiers: ["command"])
                default: return KeyState()
                }
            }
        },
        keyWatchInterval: .milliseconds(10)
    )
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    let running = Task { await helper.run(lines: input) }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":1,"method":"setKeyWatch","params":{"enabled":true}}"#)
    await waitUntil {
        await collector.items.contains(.event(.keyPress(keyCode: 8, modifiers: ["command"])))
    }
    try? await Task.sleep(for: .milliseconds(100))
    continuation.yield(
        #"{"jsonrpc":"2.0","id":2,"method":"setKeyWatch","params":{"enabled":false}}"#)
    continuation.finish()
    await running.value

    let presses = await collector.items.filter {
        if case .event(.keyPress) = $0 { true } else { false }
    }
    #expect(presses == [.event(.keyPress(keyCode: 8, modifiers: ["command"]))])
}

@Test func warmUpHoldsDevicesUntilTheSessionTakesOver() async {
    let collector = Collector<Outgoing>()
    let running = OSAllocatedUnfairLock(initialState: Set<String>())
    let helper = Helper(
        send: { await collector.add($0) }, clock: FakeClock().clock,
        makeWarmDevice: { target in
            running.withLock { _ = $0.insert(target.key) }
            return FakeWarmDevice { running.withLock { _ = $0.remove(target.key) } }
        }
    )
    let (input, continuation) = AsyncStream.makeStream(of: String.self)
    let task = Task { await helper.run(lines: input) }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":1,"method":"warmUp","params":{"microphones":[{"deviceId":"a"}],"cameras":[{"deviceId":"b","fps":30}]}}"#
    )
    await waitUntil { running.withLock { $0 } == ["microphone:a", "camera:b"] }
    continuation.yield(
        #"{"jsonrpc":"2.0","id":2,"method":"warmUp","params":{"cameras":[{"deviceId":"b","fps":30}]}}"#
    )
    await waitUntil { running.withLock { $0 } == ["camera:b"] }
    continuation.yield(#"{"jsonrpc":"2.0","id":3,"method":"warmUp","params":{}}"#)
    await waitUntil { running.withLock { $0.isEmpty } }
    continuation.finish()
    await task.value
}

private struct FakeWarmDevice: WarmDevice {
    let onStop: @Sendable () -> Void
    init(_ onStop: @escaping @Sendable () -> Void) { self.onStop = onStop }
    func stop() async { onStop() }
}

@Test func warmDevicesAreHandedOverOnlyWithTheSameSettings() async {
    let made = OSAllocatedUnfairLock(initialState: [String]())
    let stopped = OSAllocatedUnfairLock(initialState: [String]())
    let warmer = DeviceWarmer { target in
        let name =
            switch target {
            case .microphone(let config): config.deviceId
            case .camera(let config): "\(config.deviceId)@\(config.fps)"
            }
        made.withLock { $0.append(name) }
        return FakeWarmDevice { stopped.withLock { $0.append(name) } }
    }
    let camera = { (fps: Int) in CameraConfig(deviceId: "b", fps: fps) }
    await warmer.set(
        SessionUpdate(microphones: [MicrophoneConfig(deviceId: "a")], cameras: [camera(30)]))
    // Changed settings restart the camera; the microphone carries on.
    await warmer.set(
        SessionUpdate(microphones: [MicrophoneConfig(deviceId: "a")], cameras: [camera(60)]))
    #expect(made.withLock { $0 } == ["a", "b@30", "b@60"])
    #expect(stopped.withLock { $0 } == ["b@30"])

    #expect(await warmer.take(.camera(camera(30))) == nil)
    #expect(await warmer.take(.camera(camera(60))) != nil)
    #expect(await warmer.take(.camera(camera(60))) == nil)
    #expect(await warmer.take(.microphone(MicrophoneConfig(deviceId: "a"))) != nil)
    // What was handed over is the taker's to stop.
    await warmer.set(SessionUpdate())
    #expect(stopped.withLock { $0 } == ["b@30"])
}
