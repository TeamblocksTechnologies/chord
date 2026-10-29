import AppKit
import Foundation
import Testing
import os

@testable import RecorderCore

@Test func recordsTheCursorAndButtonsAsTheyChange() {
    var tracker = InputTracker()
    let at = { (x: Double, y: Double) in CGPoint(x: x, y: y) }
    #expect(
        tracker.update(InputState(cursor: at(10.04, 20)), at: 0) == [.move(time: 0, x: 10, y: 20)])
    #expect(tracker.update(InputState(cursor: at(10, 20)), at: 0.01) == [])
    #expect(
        tracker.update(InputState(cursor: at(12, 20), buttons: [.left]), at: 0.02) == [
            .move(time: 0.02, x: 12, y: 20),
            .button(time: 0.02, down: true, button: .left, x: 12, y: 20),
        ])
    #expect(
        tracker.update(InputState(cursor: at(12, 20)), at: 0.3) == [
            .button(time: 0.3, down: false, button: .left, x: 12, y: 20)
        ])
}

@Test func keepsShortcutsAndKeysThatTypeNothing() {
    var tracker = InputTracker()
    _ = tracker.update(InputState(), at: 0)
    // Plain typing, and shift for capitals, aren't kept.
    _ = tracker.update(InputState(keys: [0]), at: 1)
    _ = tracker.update(InputState(keys: [56], modifiers: ["shift"]), at: 1.1)
    _ = tracker.update(InputState(keys: [56, 0], modifiers: ["shift"]), at: 1.2)
    #expect(tracker.update(InputState(), at: 1.3) == [])
    // ⌘⇧C, held for half a second.
    _ = tracker.update(InputState(keys: [55], modifiers: ["command"]), at: 2)
    _ = tracker.update(InputState(keys: [55, 56], modifiers: ["command", "shift"]), at: 2.1)
    _ = tracker.update(InputState(keys: [55, 56, 8], modifiers: ["command", "shift"]), at: 2.2)
    #expect(
        tracker.update(InputState(keys: [55, 56], modifiers: ["command", "shift"]), at: 2.7) == [
            .key(time: 2.2, key: 8, modifiers: ["command", "shift"], duration: 0.5)
        ])
    // Neither modifier was pressed alone.
    #expect(tracker.update(InputState(), at: 2.8) == [])
    // Return and F5 need no modifier.
    _ = tracker.update(InputState(keys: [36]), at: 3)
    _ = tracker.update(InputState(keys: [96]), at: 3.1)
    #expect(
        tracker.update(InputState(), at: 3.2) == [
            .key(time: 3.1, key: 96, modifiers: [], duration: 0.1)
        ])
}

@Test func keepsModifiersPressedAloneAndCapsLock() {
    var tracker = InputTracker()
    _ = tracker.update(InputState(), at: 0)
    _ = tracker.update(InputState(keys: [56], modifiers: ["shift"]), at: 1)
    #expect(
        tracker.update(InputState(), at: 1.2) == [
            .key(time: 1, key: 56, modifiers: [], duration: 0.2)
        ])
    // Shift tapped while command is held shows with it; command, having had shift pressed with it, doesn't.
    _ = tracker.update(InputState(keys: [55], modifiers: ["command"]), at: 2)
    _ = tracker.update(InputState(keys: [55, 56], modifiers: ["command", "shift"]), at: 2.1)
    #expect(
        tracker.update(InputState(keys: [55], modifiers: ["command"]), at: 2.2) == [
            .key(time: 2.1, key: 56, modifiers: ["command"], duration: 0.1)
        ])
    #expect(tracker.update(InputState(), at: 2.3) == [])
    #expect(
        tracker.update(InputState(capsLock: true), at: 3) == [
            .key(time: 3, key: 57, modifiers: [], duration: 0)
        ])
}

@Test func ignoresKeysHeldAtStartAndLetsGoOfEverythingOnRelease() {
    var tracker = InputTracker()
    // The shortcut that started the recording.
    _ = tracker.update(
        InputState(cursor: .zero, keys: [55, 56, 15], modifiers: ["command", "shift"]), at: 0)
    #expect(tracker.update(InputState(cursor: .zero), at: 0.1) == [])
    _ = tracker.update(InputState(cursor: .zero, buttons: [.right], keys: [123]), at: 1)
    #expect(
        tracker.release(at: 1.5) == [
            .button(time: 1.5, down: false, button: .right, x: 0, y: 0),
            .key(time: 1, key: 123, modifiers: [], duration: 0.5),
        ])
    // Afterwards it starts over, noting where the cursor is again.
    #expect(tracker.update(InputState(cursor: .zero), at: 2) == [.move(time: 2, x: 0, y: 0)])
}

@Test func sessionsRecordInputWhileRecording() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let time = FakeClock()
    let state = OSAllocatedUnfairLock(initialState: InputState(cursor: CGPoint(x: 5, y: 5)))
    let session = try RecordingSession(
        config: SessionConfig(
            outputDirectory: output.path, microphones: [MicrophoneConfig(deviceId: "a")]),
        clock: time.clock,
        makeTracks: { _, context in [FakeTrack(id: "mic-1", context: context)] },
        readInput: { state.withLock { $0 } },
        inputInterval: .milliseconds(1),
        emit: { _ in }
    )
    let file = session.directory.appending(path: "input.jsonl")
    let events = {
        ((try? String(contentsOf: file, encoding: .utf8)) ?? "").split(separator: "\n").map {
            try! JSONDecoder().decode(InputEvent.self, from: Data($0.utf8))
        }
    }

    _ = try await session.start()
    #expect(try ManifestStore.read(from: session.directory).input == "input.jsonl")
    #expect(await eventually { events().count == 1 })
    time.advance(1)
    state.withLock { $0.buttons = [.left] }
    #expect(await eventually { events().count == 2 })
    time.advance(1)
    _ = try await session.pause()
    // Paused, nothing is recorded.
    state.withLock { $0 = InputState(cursor: CGPoint(x: 9, y: 9)) }
    try await Task.sleep(for: .milliseconds(20))
    #expect(events().count == 3)
    time.advance(1)
    _ = try await session.resume()
    #expect(await eventually { events().count == 4 })
    _ = await session.stop()

    #expect(
        events() == [
            .move(time: 0, x: 5, y: 5),
            .button(time: 1, down: true, button: .left, x: 5, y: 5),
            .button(time: 2, down: false, button: .left, x: 5, y: 5),
            .move(time: 3, x: 9, y: 9),
        ])
}

@Test func notesTheCursorShapeAsItChangesAndAgainAfterRelease() {
    var tracker = InputTracker()
    let arrow = CursorShape(
        id: "a1", kind: "arrow", hotspot: CGPoint(x: 5, y: 5), size: CGSize(width: 28, height: 40))
    let beam = CursorShape(
        id: "b2", hotspot: CGPoint(x: 12, y: 11), size: CGSize(width: 23, height: 22))
    let noted = { (time: Double, shape: CursorShape) in
        InputEvent.cursor(
            time: time, image: "cursors/\(shape.id).png", width: shape.size.width,
            height: shape.size.height,
            hotspotX: shape.hotspot.x, hotspotY: shape.hotspot.y, kind: shape.kind
        )
    }
    #expect(
        tracker.update(InputState(cursor: .zero, shape: arrow), at: 0) == [
            .move(time: 0, x: 0, y: 0), noted(0, arrow),
        ])
    #expect(tracker.update(InputState(cursor: .zero, shape: arrow), at: 0.1) == [])
    // A shape that can't be read for a moment leaves the last one in place.
    #expect(tracker.update(InputState(cursor: .zero), at: 0.2) == [])
    #expect(tracker.update(InputState(cursor: .zero, shape: beam), at: 0.3) == [noted(0.3, beam)])
    _ = tracker.release(at: 1)
    #expect(
        tracker.update(InputState(cursor: .zero, shape: beam), at: 2) == [
            .move(time: 2, x: 0, y: 0), noted(2, beam),
        ])
}

@Test func sessionsSaveEachCursorImageOnce() async throws {
    let output = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: output) }
    let reads = OSAllocatedUnfairLock(initialState: 0)
    let png = Data([0x89, 0x50, 0x4e, 0x47])
    let shapes = [
        CursorShape(
            id: "a1", kind: "arrow", hotspot: CGPoint(x: 5, y: 5),
            size: CGSize(width: 28, height: 40),
            png: {
                reads.withLock { $0 += 1 }
                return png
            }),
        CursorShape(
            id: "b2", hotspot: CGPoint(x: 1, y: 1), size: CGSize(width: 8, height: 8), png: { nil }),
    ]
    let state = OSAllocatedUnfairLock(
        initialState: InputState(cursor: CGPoint(x: 5, y: 5), shape: shapes[0]))
    let session = try RecordingSession(
        config: SessionConfig(
            outputDirectory: output.path, microphones: [MicrophoneConfig(deviceId: "a")]),
        clock: FakeClock().clock,
        makeTracks: { _, context in [FakeTrack(id: "mic-1", context: context)] },
        readInput: { state.withLock { $0 } },
        inputInterval: .milliseconds(1),
        emit: { _ in }
    )
    let file = session.directory.appending(path: "input.jsonl")
    let events = {
        ((try? String(contentsOf: file, encoding: .utf8)) ?? "").split(separator: "\n").map {
            try! JSONDecoder().decode(InputEvent.self, from: Data($0.utf8))
        }.filter { if case .cursor = $0 { true } else { false } }
    }
    _ = try await session.start()
    #expect(await eventually { events().count == 1 })
    state.withLock { $0.shape = shapes[1] }
    #expect(await eventually { events().count == 2 })
    state.withLock { $0.shape = shapes[0] }
    #expect(await eventually { events().count == 3 })
    _ = await session.stop()

    #expect(reads.withLock { $0 } == 1)
    #expect(try Data(contentsOf: session.directory.appending(path: "cursors/a1.png")) == png)
    // One that couldn't be saved is still noted, without its image.
    guard case .cursor(_, let image, _, _, _, _, let kind) = events()[1] else {
        Issue.record("not a cursor")
        return
    }
    #expect(image == nil && kind == nil)
    guard case .cursor(_, let again, _, _, _, _, _) = events()[2] else {
        Issue.record("not a cursor")
        return
    }
    #expect(again == "cursors/a1.png")
}

@Test @MainActor func recognisesStandardCursorsExactly() throws {
    StandardCursors.prepare()
    let beam = try #require(StandardCursors.shape(of: .iBeam))
    #expect(beam.kind == "iBeam")
    #expect(beam.hotspot == NSCursor.iBeam.hotSpot)
    #expect(StandardCursors.shape(of: .pointingHand)?.kind == "pointingHand")
    // A cursor made from the same image with another hotspot isn't the standard one.
    let moved = NSCursor(image: NSCursor.iBeam.image, hotSpot: CGPoint(x: 1, y: 1))
    #expect(StandardCursors.shape(of: moved)?.kind == nil)
    let png = try #require(beam.png())
    #expect(NSBitmapImageRep(data: png)?.pixelsWide ?? 0 >= Int(beam.size.width))
}
