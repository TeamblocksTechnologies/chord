import Foundation

/// A domain failure, reported to the client as a JSON-RPC error with `data.reason`.
public struct HelperError: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Reason: String, Codable, Sendable {
        case sessionActive = "session_active"
        case noSession = "no_session"
        case invalidState = "invalid_state"
        case invalidConfig = "invalid_config"
        case startFailed = "start_failed"
        case deviceUnavailable = "device_unavailable"
        case displayUnavailable = "display_unavailable"
        case windowUnavailable = "window_unavailable"

        /// JSON-RPC reserves -32000 to -32099 for implementation-defined server errors.
        public var code: Int {
            switch self {
            case .sessionActive: -32001
            case .noSession: -32002
            case .invalidState: -32003
            case .invalidConfig: -32004
            case .startFailed: -32005
            case .deviceUnavailable: -32006
            case .displayUnavailable: -32007
            case .windowUnavailable: -32008
            }
        }
    }

    public var reason: Reason
    public var message: String

    public init(_ reason: Reason, _ message: String) {
        self.reason = reason
        self.message = message
    }

    public var description: String { "\(reason.rawValue): \(message)" }

    public var rpcError: RPCError {
        RPCError(code: reason.code, message: message, reason: reason.rawValue)
    }
}

// MARK: - Session configuration

public struct SessionConfig: Codable, Sendable, Equatable {
    /// Directory the session folder is created in.
    public var outputDirectory: String
    public var screen: ScreenConfig?
    public var microphones: [MicrophoneConfig]
    public var cameras: [CameraConfig]
    /// Records the sound the Mac is playing, as its own audio track. Needs screen recording permission.
    public var systemAudio: Bool

    public init(
        outputDirectory: String,
        screen: ScreenConfig? = nil,
        microphones: [MicrophoneConfig] = [],
        cameras: [CameraConfig] = [],
        systemAudio: Bool = false
    ) {
        self.outputDirectory = outputDirectory
        self.screen = screen
        self.microphones = microphones
        self.cameras = cameras
        self.systemAudio = systemAudio
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        outputDirectory = try c.decode(String.self, forKey: .outputDirectory)
        screen = try c.decodeIfPresent(ScreenConfig.self, forKey: .screen)
        microphones = try c.decodeIfPresent([MicrophoneConfig].self, forKey: .microphones) ?? []
        cameras = try c.decodeIfPresent([CameraConfig].self, forKey: .cameras) ?? []
        systemAudio = try c.decodeIfPresent(Bool.self, forKey: .systemAudio) ?? false
    }
}

/// What `updateSession` makes a session record: a `SessionConfig` without its output directory.
public struct SessionUpdate: Codable, Sendable, Equatable {
    public var screen: ScreenConfig?
    public var microphones: [MicrophoneConfig]
    public var cameras: [CameraConfig]
    public var systemAudio: Bool

    public init(
        screen: ScreenConfig? = nil,
        microphones: [MicrophoneConfig] = [],
        cameras: [CameraConfig] = [],
        systemAudio: Bool = false
    ) {
        self.screen = screen
        self.microphones = microphones
        self.cameras = cameras
        self.systemAudio = systemAudio
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        screen = try c.decodeIfPresent(ScreenConfig.self, forKey: .screen)
        microphones = try c.decodeIfPresent([MicrophoneConfig].self, forKey: .microphones) ?? []
        cameras = try c.decodeIfPresent([CameraConfig].self, forKey: .cameras) ?? []
        systemAudio = try c.decodeIfPresent(Bool.self, forKey: .systemAudio) ?? false
    }

    var recordsAnything: Bool {
        screen != nil || !microphones.isEmpty || !cameras.isEmpty || systemAudio
    }
}

public enum ScreenMode: Codable, Sendable, Equatable {
    /// Whole displays, each on its own track. Empty means the main display.
    case display(ids: [UInt32], background: ScreenBackground, showsSystemUI: Bool? = nil)
    /// Areas of displays, each on its own track.
    case area(areas: [ScreenArea], background: ScreenBackground, showsSystemUI: Bool? = nil)
    /// A display showing only these apps' windows.
    case applications(bundleIds: [String], displayId: UInt32?)
    /// Every display, showing only the followed window: the focused one among allowed windows. `nil` allows every
    /// app.
    case focusedWindow(bundleIds: [String]?)

    private enum CodingKeys: String, CodingKey {
        case type, displayId, displayIds, areas, background, showsSystemUI, bundleIds
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "display":
            self = .display(
                ids: try c.decodeIfPresent([UInt32].self, forKey: .displayIds) ?? [],
                background: try c.decodeIfPresent(ScreenBackground.self, forKey: .background)
                    ?? .desktop,
                showsSystemUI: try c.decodeIfPresent(Bool.self, forKey: .showsSystemUI)
            )
        case "area":
            self = .area(
                areas: try c.decode([ScreenArea].self, forKey: .areas),
                background: try c.decodeIfPresent(ScreenBackground.self, forKey: .background)
                    ?? .desktop,
                showsSystemUI: try c.decodeIfPresent(Bool.self, forKey: .showsSystemUI)
            )
        case "applications":
            self = .applications(
                bundleIds: try c.decode([String].self, forKey: .bundleIds),
                displayId: try c.decodeIfPresent(UInt32.self, forKey: .displayId)
            )
        case "focusedWindow":
            self = .focusedWindow(
                bundleIds: try c.decodeIfPresent([String].self, forKey: .bundleIds))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "unknown screen mode \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .display(let ids, let background, let showsSystemUI):
            try c.encode("display", forKey: .type)
            if !ids.isEmpty { try c.encode(ids, forKey: .displayIds) }
            if background != .desktop { try c.encode(background, forKey: .background) }
            try c.encodeIfPresent(showsSystemUI, forKey: .showsSystemUI)
        case .area(let areas, let background, let showsSystemUI):
            try c.encode("area", forKey: .type)
            try c.encode(areas, forKey: .areas)
            if background != .desktop { try c.encode(background, forKey: .background) }
            try c.encodeIfPresent(showsSystemUI, forKey: .showsSystemUI)
        case .applications(let bundleIds, let displayId):
            try c.encode("applications", forKey: .type)
            try c.encode(bundleIds, forKey: .bundleIds)
            try c.encodeIfPresent(displayId, forKey: .displayId)
        case .focusedWindow(let bundleIds):
            try c.encode("focusedWindow", forKey: .type)
            try c.encodeIfPresent(bundleIds, forKey: .bundleIds)
        }
    }

    /// The main display alone.
    public static let mainDisplay = ScreenMode.display(ids: [], background: .desktop)

    /// The apps this mode is limited to, if any.
    var allowedBundleIds: [String]? {
        switch self {
        case .display, .area: nil
        case .applications(let bundleIds, _): bundleIds
        case .focusedWindow(let bundleIds): bundleIds
        }
    }

    /// Why the mode can't record whatever the displays and windows, if it can't. `field` names it in the message.
    func configError(field: String) -> String? {
        if let allowed = allowedBundleIds, allowed.isEmpty {
            return "\(field).bundleIds must not be empty"
        }
        guard case .area(let areas, _, _) = self else { return nil }
        if areas.isEmpty { return "\(field).areas must not be empty" }
        if let index = areas.firstIndex(where: { !($0.width > 0 && $0.height > 0) }) {
            return "\(field).areas[\(index)] needs a positive width and height"
        }
        return nil
    }
}

/// What `display` and `area` modes show besides app windows.
public enum ScreenBackground: String, Codable, Sendable {
    /// Wallpaper and desktop icons are visible.
    case desktop
    /// The wallpaper and desktop icons are transparent; `showsSystemUI` separately controls the Dock and menu bar.
    case transparent
}

/// Part of a display, in points from its top left.
public struct ScreenArea: Codable, Sendable, Equatable {
    public var displayId: UInt32
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(displayId: UInt32, x: Double, y: Double, width: Double, height: Double) {
        self.displayId = displayId
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    var rect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

public struct ScreenConfig: Codable, Sendable, Equatable {
    public var mode: ScreenMode
    public var showsCursor: Bool
    /// Chord's own windows are hidden from the recording unless this is set.
    public var captureChord: Bool
    /// Applications hidden from the recording in every mode.
    public var excludedBundleIds: [String]
    /// Windows recorded on their own tracks in every mode, besides what the mode records. `focusedWindow` doesn't
    /// follow them.
    public var pinnedWindowIds: [UInt32]
    public var quality: VideoQuality

    public init(
        mode: ScreenMode = .mainDisplay,
        showsCursor: Bool = true,
        captureChord: Bool = false,
        excludedBundleIds: [String] = [],
        pinnedWindowIds: [UInt32] = [],
        quality: VideoQuality = VideoQuality()
    ) {
        self.mode = mode
        self.showsCursor = showsCursor
        self.captureChord = captureChord
        self.excludedBundleIds = excludedBundleIds
        self.pinnedWindowIds = pinnedWindowIds
        self.quality = quality
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decodeIfPresent(ScreenMode.self, forKey: .mode) ?? .mainDisplay
        showsCursor = try c.decodeIfPresent(Bool.self, forKey: .showsCursor) ?? true
        captureChord = try c.decodeIfPresent(Bool.self, forKey: .captureChord) ?? false
        excludedBundleIds = try c.decodeIfPresent([String].self, forKey: .excludedBundleIds) ?? []
        pinnedWindowIds = try c.decodeIfPresent([UInt32].self, forKey: .pinnedWindowIds) ?? []
        quality = try c.decodeIfPresent(VideoQuality.self, forKey: .quality) ?? VideoQuality()
    }
}

public enum VideoCodec: String, Codable, Sendable {
    case h264
    case hevc
}

public struct VideoQuality: Codable, Sendable, Equatable {
    public var fps: Int
    public var codec: VideoCodec
    /// Average bits per second. `nil` lets the encoder choose.
    public var bitrate: Int?
    /// Multiplier on native pixel resolution, e.g. 0.5 for half size.
    public var scale: Double
    /// 10-bit HEVC with the display's extended dynamic range. Only `display` and `area` modes with a `desktop`
    /// background on macOS 15+ honour it.
    public var hdr: Bool

    public init(
        fps: Int = 30, codec: VideoCodec = .hevc, bitrate: Int? = nil, scale: Double = 1,
        hdr: Bool = false
    ) {
        self.fps = fps
        self.codec = codec
        self.bitrate = bitrate
        self.scale = scale
        self.hdr = hdr
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fps = try c.decodeIfPresent(Int.self, forKey: .fps) ?? 30
        codec = try c.decodeIfPresent(VideoCodec.self, forKey: .codec) ?? .hevc
        bitrate = try c.decodeIfPresent(Int.self, forKey: .bitrate)
        scale = try c.decodeIfPresent(Double.self, forKey: .scale) ?? 1
        hdr = try c.decodeIfPresent(Bool.self, forKey: .hdr) ?? false
    }
}

public struct MicrophoneConfig: Codable, Sendable, Equatable {
    public var deviceId: String

    public init(deviceId: String) {
        self.deviceId = deviceId
    }
}

public struct CameraConfig: Codable, Sendable, Equatable {
    public var deviceId: String
    /// One of the camera's `formats`. `nil` keeps the camera's own choice.
    public var format: Size?
    /// Capped at the format's highest rate.
    public var fps: Int
    /// Average bits per second. `nil` scales with the size.
    public var bitrate: Int?

    public struct Size: Codable, Sendable, Equatable {
        public var width: Int
        public var height: Int

        public init(width: Int, height: Int) {
            self.width = width
            self.height = height
        }
    }

    public init(deviceId: String, format: Size? = nil, fps: Int = 30, bitrate: Int? = nil) {
        self.deviceId = deviceId
        self.format = format
        self.fps = fps
        self.bitrate = bitrate
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        format = try c.decodeIfPresent(Size.self, forKey: .format)
        fps = try c.decodeIfPresent(Int.self, forKey: .fps) ?? 30
        bitrate = try c.decodeIfPresent(Int.self, forKey: .bitrate)
    }
}

// MARK: - Session state

public enum SessionState: String, Codable, Sendable {
    case idle
    case recording
    case paused
    case stopped
}

public enum StopReason: String, Codable, Sendable {
    /// `stopSession` was called.
    case requested
    /// The helper is exiting (stdin closed, `shutdown`, or a signal).
    case shutdown
    /// A file could not be written because the disk is full.
    case diskFull
}

public struct SessionInfo: Codable, Sendable, Equatable {
    public var id: String
    public var directory: String
    public var state: SessionState
    public var stopReason: StopReason?
}

public struct Mark: Codable, Sendable, Equatable {
    public var id: String
    /// Seconds since session start.
    public var time: Double
    public var kind: String
    public var note: String?
}

// MARK: - Permissions

public enum PermissionKind: String, Codable, Sendable {
    case screen
    case microphone
    case camera
    case accessibility
}

public enum PermissionStatus: String, Codable, Sendable {
    case granted
    case denied
    case notDetermined
    case restricted
}

public struct Permissions: Codable, Sendable, Equatable {
    /// macOS can't tell "not asked yet" from "denied" for screen recording, so anything but granted is `denied`.
    public var screen: PermissionStatus
    public var microphone: PermissionStatus
    public var camera: PermissionStatus
    /// Like screen recording, anything but granted is `denied`.
    public var accessibility: PermissionStatus
}

// MARK: - Sources

public struct SourceList: Codable, Sendable, Equatable {
    public var displays: [DisplaySource]
    public var applications: [ApplicationSource]
    /// Windows on screen that can be pinned, front to back.
    public var windows: [WindowSource]
    public var microphones: [DeviceSource]
    public var cameras: [CameraSource]
}

public struct DisplaySource: Codable, Sendable, Equatable {
    public var id: UInt32
    /// What macOS calls it, e.g. "Built-in Retina Display".
    public var name: String
    public var width: Int
    public var height: Int
    /// Pixels per point. Areas are in points.
    public var scale: Double
    public var isMain: Bool
}

public struct ApplicationSource: Codable, Sendable, Equatable {
    public var bundleId: String
    public var name: String
    public var pid: Int32
}

public struct WindowSource: Codable, Sendable, Equatable {
    /// The CGWindowID, as `ScreenConfig.pinnedWindowIds` takes it.
    public var id: UInt32
    public var bundleId: String
    public var appName: String
    public var title: String?
}

public struct DeviceSource: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var isDefault: Bool
}

public struct CameraSource: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var isDefault: Bool
    /// One per distinct size, largest first.
    public var formats: [CameraFormat]
}

public struct CameraFormat: Codable, Sendable, Equatable {
    public var width: Int
    public var height: Int
    /// Highest frame rate the camera supports at this size.
    public var maxFps: Int
}

// MARK: - Window preview

/// The window `focusedWindow` mode would follow if a session started now.
public struct PreviewWindow: Codable, Sendable, Equatable {
    /// The CGWindowID, which screen capture APIs share.
    public var id: UInt32
    public var bundleId: String
    public var appName: String
    public var title: String?

    public init(id: UInt32, bundleId: String, appName: String, title: String? = nil) {
        self.id = id
        self.bundleId = bundleId
        self.appName = appName
        self.title = title
    }
}

public struct WindowPreviewConfig: Codable, Sendable, Equatable {
    public var enabled: Bool
    /// Apps that may be followed; `nil` allows every app.
    public var bundleIds: [String]?
    public var excludedBundleIds: [String]
    /// Skipped, as a session pinning them doesn't follow them.
    public var pinnedWindowIds: [UInt32]

    public init(
        enabled: Bool, bundleIds: [String]? = nil, excludedBundleIds: [String] = [],
        pinnedWindowIds: [UInt32] = []
    ) {
        self.enabled = enabled
        self.bundleIds = bundleIds
        self.excludedBundleIds = excludedBundleIds
        self.pinnedWindowIds = pinnedWindowIds
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        bundleIds = try c.decodeIfPresent([String].self, forKey: .bundleIds)
        excludedBundleIds = try c.decodeIfPresent([String].self, forKey: .excludedBundleIds) ?? []
        pinnedWindowIds = try c.decodeIfPresent([UInt32].self, forKey: .pinnedWindowIds) ?? []
    }
}
