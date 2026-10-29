import CoreGraphics
import Foundation
import os

public enum MouseButton: String, Codable, Sendable, CaseIterable {
    case left
    case right
    case other
}

/// The mouse and keyboard, as a session's input recorder polls them.
public struct InputState: Sendable, Equatable {
    /// In global display coordinates. Nil when it can't be read.
    public var cursor: CGPoint?
    public var buttons: Set<MouseButton>
    /// Every key held, by virtual key code, modifier keys included. Caps lock is `capsLock` instead.
    public var keys: Set<Int>
    /// Any of `command`, `control`, `option` and `shift`.
    public var modifiers: Set<String>
    /// Whether caps lock is on.
    public var capsLock: Bool
    /// The cursor's shape. Nil when it can't be read.
    public var shape: CursorShape?

    public init(
        cursor: CGPoint? = nil, buttons: Set<MouseButton> = [], keys: Set<Int> = [],
        modifiers: Set<String> = [],
        capsLock: Bool = false, shape: CursorShape? = nil
    ) {
        self.cursor = cursor
        self.buttons = buttons
        self.keys = keys
        self.modifiers = modifiers
        self.capsLock = capsLock
        self.shape = shape
    }
}

/// The real mouse and keyboard, and the cursor's shape. Polled rather than tapped, so it needs no Input Monitoring
/// permission.
public let liveInputState: @Sendable () -> InputState = {
    let source = CGEventSourceStateID.combinedSessionState
    let buttons: [(CGMouseButton, MouseButton)] = [
        (.left, .left), (.right, .right), (.center, .other),
    ]
    let flags = CGEventSource.flagsState(source)
    let named: [(CGEventFlags, String)] = [
        (.maskCommand, "command"), (.maskControl, "control"), (.maskAlternate, "option"),
        (.maskShift, "shift"),
    ]
    return InputState(
        cursor: CGEvent(source: nil)?.location,
        buttons: Set(buttons.filter { CGEventSource.buttonState(source, button: $0.0) }.map(\.1)),
        keys: Set(
            (0..<128).filter {
                $0 != InputTracker.capsLock && CGEventSource.keyState(source, key: CGKeyCode($0))
            }),
        modifiers: Set(named.filter { flags.contains($0.0) }.map(\.1)),
        capsLock: flags.contains(.maskAlphaShift),
        shape: liveShapes.read()
    )
}

/// The cursor's shape, read less often than the mouse: it changes less, and reading it costs more.
private let liveShapes = ShapeSampler(interval: 0.04, read: liveCursorShape)

final class ShapeSampler: Sendable {
    private let interval: Double
    private let reader: @Sendable () -> CursorShape?
    private let last = OSAllocatedUnfairLock<(time: Double, shape: CursorShape?)?>(
        initialState: nil)

    init(interval: Double, read: @escaping @Sendable () -> CursorShape?) {
        self.interval = interval
        reader = read
    }

    func read() -> CursorShape? {
        let now = ProcessInfo.processInfo.systemUptime
        if let last = last.withLock({ $0 }), now - last.time < interval { return last.shape }
        let shape = reader()
        last.withLock { $0 = (now, shape) }
        return shape
    }
}

/// A line of a session's input file. See `InputEvent` in the protocol.
public enum InputEvent: Codable, Sendable, Equatable {
    case move(time: Double, x: Double, y: Double)
    case button(time: Double, down: Bool, button: MouseButton, x: Double, y: Double)
    case key(time: Double, key: Int, modifiers: [String], duration: Double)
    case cursor(
        time: Double, image: String?, width: Double, height: Double, hotspotX: Double,
        hotspotY: Double, kind: String?)

    private enum CodingKeys: String, CodingKey {
        case type, time, x, y, button, key, modifiers, duration, image, width, height, hotspotX,
            hotspotY, kind
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let time = try c.decode(Double.self, forKey: .time)
        switch try c.decode(String.self, forKey: .type) {
        case "move":
            self = .move(
                time: time, x: try c.decode(Double.self, forKey: .x),
                y: try c.decode(Double.self, forKey: .y))
        case let type where type == "down" || type == "up":
            self = .button(
                time: time, down: type == "down",
                button: try c.decode(MouseButton.self, forKey: .button),
                x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y)
            )
        case "key":
            self = .key(
                time: time, key: try c.decode(Int.self, forKey: .key),
                modifiers: try c.decode([String].self, forKey: .modifiers),
                duration: try c.decode(Double.self, forKey: .duration)
            )
        case "cursor":
            self = .cursor(
                time: time, image: try c.decodeIfPresent(String.self, forKey: .image),
                width: try c.decode(Double.self, forKey: .width),
                height: try c.decode(Double.self, forKey: .height),
                hotspotX: try c.decode(Double.self, forKey: .hotspotX),
                hotspotY: try c.decode(Double.self, forKey: .hotspotY),
                kind: try c.decodeIfPresent(String.self, forKey: .kind)
            )
        case let type:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "unknown input event \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .move(let time, let x, let y):
            try c.encode("move", forKey: .type)
            try c.encode(time, forKey: .time)
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
        case .button(let time, let down, let button, let x, let y):
            try c.encode(down ? "down" : "up", forKey: .type)
            try c.encode(time, forKey: .time)
            try c.encode(button, forKey: .button)
            try c.encode(x, forKey: .x)
            try c.encode(y, forKey: .y)
        case .key(let time, let key, let modifiers, let duration):
            try c.encode("key", forKey: .type)
            try c.encode(time, forKey: .time)
            try c.encode(key, forKey: .key)
            try c.encode(modifiers, forKey: .modifiers)
            try c.encode(duration, forKey: .duration)
        case .cursor(
            let time, let image, let width, let height, let hotspotX, let hotspotY, let kind):
            try c.encode("cursor", forKey: .type)
            try c.encode(time, forKey: .time)
            try c.encodeIfPresent(image, forKey: .image)
            try c.encode(width, forKey: .width)
            try c.encode(height, forKey: .height)
            try c.encode(hotspotX, forKey: .hotspotX)
            try c.encode(hotspotY, forKey: .hotspotY)
            try c.encodeIfPresent(kind, forKey: .kind)
        }
    }
}

/// Turns polled input states into the events worth keeping. Plain typing is never kept: only keys pressed with
/// command, control or option, keys that type nothing, modifiers pressed and released alone, and caps lock.
struct InputTracker {
    static let capsLock = 57
    /// The modifier keys, and the modifier each sets. Fn sets none worth showing.
    static let modifierKeys: [Int: String?] = [
        54: "command", 55: "command", 56: "shift", 60: "shift", 58: "option", 61: "option",
        59: "control", 62: "control",
        63: nil,
    ]
    /// Keys that type nothing: return, tab, delete, escape, clear, enter, help, home, end, page up and down, forward
    /// delete, the arrows, and F1 to F20.
    static let specialKeys: Set<Int> = [
        36, 48, 51, 53, 71, 76, 114, 115, 116, 117, 119, 121, 123, 124, 125, 126,
        122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
    ]
    private static let shortcutModifiers: Set<String> = ["command", "control", "option"]

    private struct Press {
        var time: Double
        var modifiers: [String]
        /// Whether it's written when released.
        var kept: Bool
        /// Modifier keys: whether nothing else has been pressed with it, so far.
        var alone = false
    }

    private var last: InputState?
    /// Where the last `move` put the cursor.
    private var cursor: CGPoint?
    /// The shape the last `cursor` event gave it.
    private var shape: CursorShape?
    private var held: [Int: Press] = [:]

    /// What changed since the last update. The first after a `release` notes where the cursor is, its shape and any
    /// buttons held, but not keys already held, so the shortcut that started recording isn't kept.
    mutating func update(_ state: InputState, at time: Double) -> [InputEvent] {
        let time = Self.round(time, to: 1000)
        var events: [InputEvent] = []
        if let point = state.cursor.map({
            CGPoint(x: Self.round($0.x, to: 10), y: Self.round($0.y, to: 10))
        }), point != cursor {
            cursor = point
            events.append(.move(time: time, x: point.x, y: point.y))
        }
        if let next = state.shape, next != shape {
            shape = next
            events.append(
                .cursor(
                    time: time, image: Self.imageFile(next.id), width: next.size.width,
                    height: next.size.height,
                    hotspotX: next.hotspot.x, hotspotY: next.hotspot.y, kind: next.kind
                ))
        }
        let position = cursor ?? .zero
        let wasDown = last?.buttons ?? []
        for button in MouseButton.allCases
        where state.buttons.contains(button) != wasDown.contains(button) {
            events.append(
                .button(
                    time: time, down: state.buttons.contains(button), button: button, x: position.x,
                    y: position.y))
        }

        guard let last else {
            for key in state.keys { held[key] = Press(time: time, modifiers: [], kept: false) }
            self.last = state
            return events
        }
        for key in state.keys.subtracting(last.keys).sorted() {
            // Anything pressed while a modifier is held means that modifier wasn't pressed alone.
            for other in held.keys { held[other]?.alone = false }
            if let modifier = Self.modifierKeys[key] {
                let others = state.modifiers.subtracting([modifier].compactMap { $0 })
                held[key] = Press(
                    time: time, modifiers: others.sorted(), kept: true,
                    alone: !holdsOtherKeys(than: key))
            } else {
                let kept =
                    Self.specialKeys.contains(key)
                    || !state.modifiers.isDisjoint(with: Self.shortcutModifiers)
                held[key] = Press(time: time, modifiers: state.modifiers.sorted(), kept: kept)
            }
        }
        for key in last.keys.subtracting(state.keys).sorted() {
            guard let press = held.removeValue(forKey: key) else { continue }
            if press.kept, !Self.isModifier(key) || press.alone {
                events.append(
                    .key(
                        time: press.time, key: key, modifiers: press.modifiers,
                        duration: Self.round(time - press.time, to: 1000)))
            }
        }
        if state.capsLock != last.capsLock {
            events.append(
                .key(
                    time: time, key: Self.capsLock, modifiers: state.modifiers.sorted(), duration: 0
                ))
        }
        self.last = state
        return events
    }

    /// Ends everything held, as recording stops or pauses: buttons go up, and kept keys are written as held until
    /// now. Modifiers held then weren't pressed alone.
    mutating func release(at time: Double) -> [InputEvent] {
        let time = Self.round(time, to: 1000)
        let position = cursor ?? .zero
        var events: [InputEvent] = MouseButton.allCases.filter {
            last?.buttons.contains($0) ?? false
        }.map {
            .button(time: time, down: false, button: $0, x: position.x, y: position.y)
        }
        for (key, press) in held.sorted(by: { $0.value.time < $1.value.time })
        where press.kept && !Self.isModifier(key) {
            events.append(
                .key(
                    time: press.time, key: key, modifiers: press.modifiers,
                    duration: Self.round(time - press.time, to: 1000)))
        }
        last = nil
        cursor = nil
        shape = nil
        held = [:]
        return events
    }

    /// Where a shape's image is kept in the session folder.
    static func imageFile(_ id: String) -> String {
        "cursors/\(id).png"
    }

    /// Whether a key other than modifier keys and `key` is held.
    private func holdsOtherKeys(than key: Int) -> Bool {
        held.keys.contains { $0 != key && !Self.isModifier($0) }
    }

    private static func isModifier(_ key: Int) -> Bool {
        modifierKeys.keys.contains(key)
    }

    private static func round(_ value: Double, to scale: Double) -> Double {
        (value * scale).rounded() / scale
    }
}

/// Writes a session's input file while recording, polling the mouse and keyboard about every frame.
actor InputRecorder {
    static let fileName = "input.jsonl"

    private let url: URL
    private let read: @Sendable () -> InputState
    private let interval: Duration
    /// Seconds since the session started.
    private let now: @Sendable () -> Double
    private var tracker = InputTracker()
    private var file: FileHandle?
    private var polling: Task<Void, Never>?
    /// Shapes whose images are in the session folder, and those that couldn't be written.
    private var saved: Set<String> = []
    private var unsaved: Set<String> = []

    init(
        directory: URL, read: @escaping @Sendable () -> InputState, interval: Duration,
        now: @escaping @Sendable () -> Double
    ) {
        url = directory.appending(path: Self.fileName)
        self.read = read
        self.interval = interval
        self.now = now
    }

    /// Starts or resumes polling.
    func start() {
        guard polling == nil else { return }
        if file == nil {
            FileManager.default.createFile(atPath: url.path, contents: nil)
            do {
                file = try FileHandle(forWritingTo: url)
            } catch {
                Log.error("input: failed to open \(url.lastPathComponent): \(error)")
                return
            }
        }
        polling = Task { [interval] in
            while !Task.isCancelled {
                self.poll()
                try? await Task.sleep(for: interval)
            }
        }
    }

    /// Stops polling, letting go of whatever is held.
    func stop() async {
        guard let polling else { return }
        polling.cancel()
        await polling.value
        self.polling = nil
        write(tracker.release(at: now()))
    }

    /// Stops for good.
    func close() async {
        await stop()
        try? file?.close()
        file = nil
    }

    private func poll() {
        let state = read()
        write(
            tracker.update(state, at: now()).map { event in
                guard
                    case .cursor(
                        let time, let image?, let width, let height, let hotspotX, let hotspotY,
                        let kind) = event, let shape = state.shape
                else { return event }
                return .cursor(
                    time: time, image: save(shape) ? image : nil, width: width, height: height,
                    hotspotX: hotspotX,
                    hotspotY: hotspotY, kind: kind
                )
            })
    }

    /// Writes a shape's image the first time it's seen. Whether it's there.
    private func save(_ shape: CursorShape) -> Bool {
        if saved.contains(shape.id) { return true }
        if unsaved.contains(shape.id) { return false }
        let target = url.deletingLastPathComponent().appending(
            path: InputTracker.imageFile(shape.id))
        do {
            guard let png = shape.png() else { throw CocoaError(.fileWriteUnknown) }
            try FileManager.default.createDirectory(
                at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try png.write(to: target, options: .atomic)
            saved.insert(shape.id)
            return true
        } catch {
            Log.error("input: failed to save cursor \(shape.id): \(error)")
            unsaved.insert(shape.id)
            return false
        }
    }

    private func write(_ events: [InputEvent]) {
        guard !events.isEmpty, let file else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            let lines = try events.map { try encoder.encode($0) + Data("\n".utf8) }
            try file.write(contentsOf: lines.reduce(Data(), +))
        } catch {
            Log.error("input: failed to write: \(error)")
        }
    }
}
