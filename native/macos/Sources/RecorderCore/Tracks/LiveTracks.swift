import CoreGraphics

/// The real capture tracks for a session config.
public let liveTracks: TrackFactory = { config, context in
    var tracks: [any RecordingTrack] = []
    if let screen = config.screen {
        if let error = screen.mode.configError(field: "screen.mode") {
            throw HelperError(.invalidConfig, error)
        }
        // One track per display connected at start, main display first, so the mode can move between them; one per
        // area; and one per display for each pinned window.
        tracks += try ScreenGroup(config: screen, context: context).makeTracks()
    }
    if config.systemAudio {
        tracks.append(
            SystemAudioTrack(
                id: "system-audio", files: context.files(for: "system-audio", ext: "m4a"),
                levels: context.levels,
                signal: context.signal
            ))
    }
    for microphone in config.microphones {
        let id = context.ids.next("mic")
        tracks.append(
            MicrophoneTrack(
                id: id,
                deviceId: microphone.deviceId,
                files: context.files(for: id, ext: "m4a"),
                levels: context.levels,
                adopt: { await context.warmCapture(for: $0) },
                signal: context.signal
            ))
    }
    for (index, camera) in config.cameras.enumerated() {
        guard camera.fps > 0, camera.format.map({ $0.width > 0 && $0.height > 0 }) ?? true else {
            throw HelperError(.invalidConfig, "cameras[\(index)] needs a positive format and fps")
        }
        let id = context.ids.next("camera")
        tracks.append(
            CameraTrack(
                id: id, config: camera, files: context.files(for: id, ext: "mp4"),
                adopt: { await context.warmCapture(for: $0) }, signal: context.signal
            ))
    }
    return tracks
}

/// The real button state for `setMouseWatch`: any of the left, right or other buttons. Needs no permission.
public let liveMouseDown: @Sendable () -> Bool = {
    [CGMouseButton.left, .right, .center].contains {
        CGEventSource.buttonState(.combinedSessionState, button: $0)
    }
}

/// The non-modifier keys held and the modifiers held, for `setKeyWatch`.
public struct KeyState: Sendable, Equatable {
    public var keys: Set<Int>
    /// Any of `command`, `control`, `option` and `shift`.
    public var modifiers: Set<String>
    public init(keys: Set<Int> = [], modifiers: Set<String> = []) {
        self.keys = keys
        self.modifiers = modifiers
    }
}

/// The real keyboard state for `setKeyWatch`. Polled rather than tapped, so it needs no Input Monitoring permission.
public let liveKeyState: @Sendable () -> KeyState = {
    let source = CGEventSourceStateID.combinedSessionState
    // Codes 54 to 63 are the modifier keys themselves, which are reported through the flags.
    let keys = (0..<128).filter {
        !(54...63).contains($0) && CGEventSource.keyState(source, key: CGKeyCode($0))
    }
    let flags = CGEventSource.flagsState(source)
    let named: [(CGEventFlags, String)] = [
        (.maskCommand, "command"), (.maskControl, "control"), (.maskAlternate, "option"),
        (.maskShift, "shift"),
    ]
    return KeyState(keys: Set(keys), modifiers: Set(named.filter { flags.contains($0.0) }.map(\.1)))
}

/// The real window lookup for `setWindowPreview`.
public let liveWindowToFollow: @Sendable (WindowPreviewConfig) -> PreviewWindow? = {
    ScreenGroup.windowToFollow($0)
}
