import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import os

// MARK: - Models

/// A display or window shown live outside any session, as a recording of it would capture it.
public struct ScreenPreviewRequest: Codable, Sendable, Equatable {
    /// Names the preview's frames.
    public var id: String
    /// The display, as `display` mode records it. Exactly one of `displayId` and `windowId` is set.
    public var displayId: CGDirectDisplayID?
    /// The window on its own, as a followed or pinned window is recorded.
    public var windowId: CGWindowID?
    /// Display previews only.
    public var background: ScreenBackground
    /// Display previews only.
    public var showsSystemUI: Bool
    /// Display previews only.
    public var excludedBundleIds: [String]
    public var showsCursor: Bool
    /// The widest frame wanted, in pixels; nil for the default. Frames are never wider than what's captured.
    public var maxWidth: Int?
    /// Frames per second at most; nil for the default.
    public var fps: Int?

    public init(
        id: String,
        displayId: CGDirectDisplayID? = nil,
        windowId: CGWindowID? = nil,
        background: ScreenBackground = .desktop,
        showsSystemUI: Bool? = nil,
        excludedBundleIds: [String] = [],
        showsCursor: Bool = true,
        maxWidth: Int? = nil,
        fps: Int? = nil
    ) {
        self.id = id
        self.displayId = displayId
        self.windowId = windowId
        self.background = background
        self.showsSystemUI = showsSystemUI ?? (background == .desktop)
        self.excludedBundleIds = excludedBundleIds
        self.showsCursor = showsCursor
        self.maxWidth = maxWidth
        self.fps = fps
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        displayId = try c.decodeIfPresent(CGDirectDisplayID.self, forKey: .displayId)
        windowId = try c.decodeIfPresent(CGWindowID.self, forKey: .windowId)
        guard (displayId == nil) != (windowId == nil) else {
            throw DecodingError.dataCorruptedError(
                forKey: .displayId, in: c, debugDescription: "needs one of displayId and windowId")
        }
        background = try c.decodeIfPresent(ScreenBackground.self, forKey: .background) ?? .desktop
        showsSystemUI =
            try c.decodeIfPresent(Bool.self, forKey: .showsSystemUI) ?? (background == .desktop)
        excludedBundleIds = try c.decodeIfPresent([String].self, forKey: .excludedBundleIds) ?? []
        showsCursor = try c.decodeIfPresent(Bool.self, forKey: .showsCursor) ?? true
        maxWidth = try c.decodeIfPresent(Int.self, forKey: .maxWidth)
        fps = try c.decodeIfPresent(Int.self, forKey: .fps)
    }
}

public struct ScreenPreviewFailure: Codable, Sendable, Equatable {
    public var id: String
    public var message: String

    public init(id: String, message: String) {
        self.id = id
        self.message = message
    }
}

// MARK: - Frames

/// Where preview frames go. Frames are too heavy for stdout, so they get a pipe of their own.
public protocol FrameSink: Sendable {
    /// Whether a frame for preview `id` sent now would be written rather than dropped, so it's only encoded if so.
    func isReady(_ id: String) -> Bool
    func send(id: String, image: Data)
}

/// Frames written to the pipe the app opens as the helper's file descriptor 3. Each is the preview's id and the
/// image, each preceded by its length in bytes as a big-endian UInt32. A preview's frame is dropped while its
/// previous one is still being written, so a slow reader sees fewer frames rather than late ones.
public final class FramePipe: FrameSink, @unchecked Sendable {
    private let handle: FileHandle
    private let queue = DispatchQueue(label: "chord.frames")
    private let writing = OSAllocatedUnfairLock(initialState: Set<String>())

    /// Nil when `descriptor` isn't open: the app didn't pass a pipe.
    public init?(descriptor: Int32 = 3) {
        guard fcntl(descriptor, F_GETFD) != -1 else { return nil }
        // A pipe the app closed fails the write rather than killing the helper.
        signal(SIGPIPE, SIG_IGN)
        handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
    }

    public func isReady(_ id: String) -> Bool {
        !writing.withLock { $0.contains(id) }
    }

    public func send(id: String, image: Data) {
        guard writing.withLock({ $0.insert(id).inserted }) else { return }
        queue.async { [handle, writing] in
            defer { _ = writing.withLock { $0.remove(id) } }
            let name = Data(id.utf8)
            var frame = Data(capacity: 8 + name.count + image.count)
            for part in [name, image] {
                withUnsafeBytes(of: UInt32(part.count).bigEndian) { frame.append(contentsOf: $0) }
                frame.append(part)
            }
            do {
                try handle.write(contentsOf: frame)
            } catch {
                Log.error("failed to write preview frame: \(error)")
            }
        }
    }
}

// MARK: - Preview

/// A running display or window preview.
public protocol ScreenPreviewStream: Sendable {
    func stop() async
}

/// Starts previewing `request`, sending its frames to `frames`.
public typealias ScreenPreviewFactory =
    @Sendable (
        _ request: ScreenPreviewRequest, _ frames: any FrameSink
    ) async throws -> any ScreenPreviewStream

/// Runs the display and window previews `setScreenPreview` asks for. Independent of any session.
actor ScreenPreviews {
    private let start: ScreenPreviewFactory
    private let frames: (any FrameSink)?
    private var running:
        [String: (request: ScreenPreviewRequest, stream: any ScreenPreviewStream)] = [:]

    init(start: @escaping ScreenPreviewFactory, frames: (any FrameSink)?) {
        self.start = start
        self.frames = frames
    }

    /// Runs exactly `requests`: stops the rest and any whose settings changed, starts the new ones, and returns
    /// those that couldn't start.
    func set(_ requests: [ScreenPreviewRequest]) async -> [ScreenPreviewFailure] {
        var wanted: [String: ScreenPreviewRequest] = [:]
        for request in requests where wanted[request.id] == nil { wanted[request.id] = request }

        for (id, preview) in running where wanted[id] != preview.request {
            running[id] = nil
            await preview.stream.stop()
        }

        var failures: [ScreenPreviewFailure] = []
        for request in requests where wanted[request.id] == request && running[request.id] == nil {
            guard let frames else {
                failures.append(
                    ScreenPreviewFailure(id: request.id, message: "no frame pipe is open"))
                continue
            }
            do {
                running[request.id] = (request, try await start(request, frames))
            } catch {
                let message = (error as? HelperError)?.message ?? error.localizedDescription
                failures.append(ScreenPreviewFailure(id: request.id, message: message))
            }
        }
        return failures
    }
}

/// Captures real displays and windows with the filters a recording uses.
public let liveScreenPreviews: ScreenPreviewFactory = { request, frames in
    if request.windowId != nil {
        try await WindowPreview.start(request, frames: frames)
    } else {
        try await DisplayPreview.start(request, frames: frames)
    }
}

/// What's on screen, shared by the previews: each follows its display's apps or its window by polling, and querying
/// ScreenCaptureKit is slow, so polls within `maxAge` of the last query share its answer, and concurrent ones its
/// query.
private actor OnScreenContent {
    static let shared = OnScreenContent()
    private static let maxAge = Duration.milliseconds(200)

    /// A query's answer: a snapshot nothing changes, so it's safe to share.
    private struct Snapshot: @unchecked Sendable {
        let content: SCShareableContent
    }

    private var latest: (at: ContinuousClock.Instant, snapshot: Snapshot)?
    private var pending: Task<Snapshot, any Error>?

    private func snapshot() async throws -> Snapshot {
        if let latest, ContinuousClock.now - latest.at < Self.maxAge { return latest.snapshot }
        if let pending { return try await pending.value }
        let query = Task {
            Snapshot(
                content: try await SCShareableContent.excludingDesktopWindows(
                    false, onScreenWindowsOnly: true))
        }
        pending = query
        defer { pending = nil }
        let snapshot = try await query.value
        latest = (ContinuousClock.now, snapshot)
        return snapshot
    }

    nonisolated func current() async throws -> SCShareableContent {
        try await snapshot().content
    }
}

/// What display and window previews share: thumbnails at a low frame rate, sized as the request asks within limits.
/// Opaque frames are JPEG; transparent ones PNG, keeping their alpha.
private enum PreviewFrame {
    private static let defaultWidth = 960
    private static let widths = 16...1920
    private static let defaultFps = 10
    private static let rates = 1...30
    /// Streams deliver sRGB (see `configure`), so frames are tagged sRGB without converting.
    private static let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    /// Output size in pixels for `size` points at `scale`, at most as wide as `request` asks.
    static func size(of size: CGSize, scale: Float, for request: ScreenPreviewRequest) -> (
        width: Int, height: Int
    ) {
        let limit = Double(clamp(request.maxWidth ?? defaultWidth, to: widths))
        let width = min(limit, size.width * Double(scale))
        return (max(1, Int(width)), max(1, Int(width * size.height / size.width)))
    }

    static func interval(for request: ScreenPreviewRequest) -> CMTime {
        CMTime(value: 1, timescale: CMTimeScale(clamp(request.fps ?? defaultFps, to: rates)))
    }

    private static func clamp(_ value: Int, to range: ClosedRange<Int>) -> Int {
        min(max(value, range.lowerBound), range.upperBound)
    }

    /// Sets what every preview stream shares: its rate, and BGRA frames in sRGB that `encode` takes as they are.
    static func configure(_ config: SCStreamConfiguration, for request: ScreenPreviewRequest) {
        config.minimumFrameInterval = interval(for: request)
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.colorSpaceName = CGColorSpace.sRGB
        config.showsCursor = request.showsCursor
        config.queueDepth = 3
    }

    /// A frame's pixels, copied out of the stream's buffer without the padding its rows may have, so two frames
    /// showing the same thing compare equal.
    struct Pixels: Equatable {
        let data: Data
        let width: Int
        let height: Int
        var bytesPerRow: Int { width * 4 }

        init?(_ buffer: CVPixelBuffer) {
            CVPixelBufferLockBaseAddress(buffer, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
            guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
            let stride = CVPixelBufferGetBytesPerRow(buffer)
            let width = CVPixelBufferGetWidth(buffer)
            let height = CVPixelBufferGetHeight(buffer)
            let row = width * 4
            var data = Data(count: row * height)
            data.withUnsafeMutableBytes { out in
                for y in 0..<height {
                    (out.baseAddress! + y * row).copyMemory(from: base + y * stride, byteCount: row)
                }
            }
            (self.data, self.width, self.height) = (data, width, height)
        }
    }

    /// Encodes the pixels directly with ImageIO. Going through Core Image instead renders each frame on the GPU and
    /// reads it back, which for thumbnails costs more than encoding them.
    static func encode(_ pixels: Pixels, alpha: Bool) -> Data? {
        guard
            let provider = CGDataProvider(data: pixels.data as CFData),
            let image = CGImage(
                width: pixels.width, height: pixels.height, bitsPerComponent: 8,
                bitsPerPixel: 32, bytesPerRow: pixels.bytesPerRow, space: colorSpace,
                bitmapInfo: CGBitmapInfo(
                    rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue
                        | CGBitmapInfo.byteOrder32Little.rawValue),
                provider: provider, decode: nil, shouldInterpolate: false,
                intent: .defaultIntent)
        else { return nil }
        let data = NSMutableData()
        let type = alpha ? UTType.png : UTType.jpeg
        guard
            let destination = CGImageDestinationCreateWithData(
                data, type.identifier as CFString, 1, nil)
        else { return nil }
        let options: [CFString: Any] =
            alpha ? [:] : [kCGImageDestinationLossyCompressionQuality: 0.7]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}

/// A display captured as a recording of it would be, scaled down to a thumbnail.
final class DisplayPreview: NSObject, ScreenPreviewStream, SCStreamOutput, SCStreamDelegate,
    @unchecked Sendable
{
    /// How often a transparent preview checks for apps launching or quitting, as tracks do.
    private static let applicationsInterval = Duration.seconds(1)

    private let request: ScreenPreviewRequest
    private let displayId: CGDirectDisplayID
    private let frames: any FrameSink
    private let queue: DispatchQueue
    // Set once while starting.
    private var stream: SCStream?
    private var following: Task<Void, Never>?
    /// On `queue`. The last frame sent: ScreenCaptureKit delivers frames that change nothing, which aren't resent.
    private var lastFrame: PreviewFrame.Pixels?

    private init(request: ScreenPreviewRequest, displayId: CGDirectDisplayID, frames: any FrameSink)
    {
        self.request = request
        self.displayId = displayId
        self.frames = frames
        queue = DispatchQueue(label: "chord.preview.display-\(displayId)")
    }

    static func start(_ request: ScreenPreviewRequest, frames: any FrameSink) async throws
        -> DisplayPreview
    {
        guard let displayId = request.displayId else {
            throw HelperError(.invalidConfig, "preview \(request.id) names no display")
        }
        let preview = DisplayPreview(request: request, displayId: displayId, frames: frames)
        let content = try await OnScreenContent.shared.current()
        guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
            throw HelperError(.displayUnavailable, "display \(displayId) is not connected")
        }
        let (filter, apps) = preview.filter(display: display, content: content)

        let config = SCStreamConfiguration()
        (config.width, config.height) = PreviewFrame.size(
            of: filter.contentRect.size, scale: filter.pointPixelScale, for: request)
        PreviewFrame.configure(config, for: request)
        if request.background == .transparent { config.backgroundColor = ScreenTrack.clearColor }

        let stream = SCStream(filter: filter, configuration: config, delegate: preview)
        try stream.addStreamOutput(preview, type: .screen, sampleHandlerQueue: preview.queue)
        try await stream.startCapture(within: SCStream.callbackTimeout)
        preview.stream = stream
        if request.background == .transparent {
            preview.following = preview.followApplications(shown: apps)
        }
        return preview
    }

    func stop() async {
        following?.cancel()
        await stream?.stopCapture(within: SCStream.callbackTimeout)
    }

    /// As a recording's: the whole display but excluded apps, or only app windows when transparent. Returns the
    /// apps shown when transparent.
    private func filter(display: SCDisplay, content: SCShareableContent) -> (
        SCContentFilter, Set<pid_t>
    ) {
        let excluded = request.excludedBundleIds
        switch request.background {
        case .desktop:
            let filter = ScreenTrack.desktopFilter(
                display: display, content: content, showsSystemUI: request.showsSystemUI
            ) {
                !ScreenGroup.shows(
                    $0.bundleIdentifier, pid: $0.processID, on: .desktop,
                    showsSystemUI: request.showsSystemUI, excluded: excluded, captureChord: false)
            }
            return (filter, [])
        case .transparent:
            return ScreenTrack.applicationsFilter(
                display: display, content: content, showsSystemUI: request.showsSystemUI
            ) {
                ScreenGroup.shows(
                    $0.bundleIdentifier, pid: $0.processID, on: .transparent,
                    showsSystemUI: request.showsSystemUI, excluded: excluded, captureChord: false
                )
            }
        }
    }

    /// Shows apps that launch and hides apps that quit while the preview runs.
    private func followApplications(shown: Set<pid_t>) -> Task<Void, Never> {
        Task { [weak self] in
            var shown = shown
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.applicationsInterval)
                guard let self, !Task.isCancelled else { return }
                do {
                    let content = try await OnScreenContent.shared.current()
                    guard
                        let display = content.displays.first(where: {
                            $0.displayID == self.displayId
                        })
                    else {
                        continue
                    }
                    let (filter, apps) = self.filter(display: display, content: content)
                    guard apps != shown else { continue }
                    try await self.stream?.updateContentFilter(filter)
                    shown = apps
                } catch {
                    Log.error(
                        "preview of display \(self.displayId): failed to update applications: \(error)"
                    )
                }
            }
        }
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard
            type == .screen, ScreenTrack.isComplete(sampleBuffer), frames.isReady(request.id),
            let buffer = sampleBuffer.imageBuffer, let pixels = PreviewFrame.Pixels(buffer),
            pixels != lastFrame,
            let data = PreviewFrame.encode(pixels, alpha: request.background == .transparent)
        else { return }
        lastFrame = pixels
        frames.send(id: request.id, image: data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.error("preview of display \(displayId) stopped: \(error.localizedDescription)")
    }
}

/// A window on its own, captured as a followed or pinned window is recorded: from the display showing most of it,
/// with every other window left out, so nothing overlapping it shows. Frames are opaque JPEG on black: a preview
/// only confirms the pick, and PNG costs far more to encode. Follows the window as it moves, resizes, or changes
/// display, and leaves out windows that open. While it's off screen the last frame stays.
final class WindowPreview: NSObject, ScreenPreviewStream, SCStreamOutput, SCStreamDelegate,
    @unchecked Sendable
{
    /// How often the preview checks where the window is.
    private static let followInterval = Duration.milliseconds(250)

    private struct Placement: Equatable {
        let displayId: CGDirectDisplayID
        /// The part of the window on the display, in the display's points.
        let rect: CGRect
        /// Every other window on screen.
        let hidden: Set<CGWindowID>
    }

    private let request: ScreenPreviewRequest
    private let windowId: CGWindowID
    private let frames: any FrameSink
    private let queue: DispatchQueue
    // Set once while starting.
    private var stream: SCStream?
    private var following: Task<Void, Never>?
    /// On `queue`. The last frame sent: ScreenCaptureKit delivers frames that change nothing, which aren't resent.
    private var lastFrame: PreviewFrame.Pixels?

    private init(request: ScreenPreviewRequest, windowId: CGWindowID, frames: any FrameSink) {
        self.request = request
        self.windowId = windowId
        self.frames = frames
        queue = DispatchQueue(label: "chord.preview.window-\(windowId)")
    }

    static func start(_ request: ScreenPreviewRequest, frames: any FrameSink) async throws
        -> WindowPreview
    {
        guard let windowId = request.windowId else {
            throw HelperError(.invalidConfig, "preview \(request.id) names no window")
        }
        let preview = WindowPreview(request: request, windowId: windowId, frames: frames)
        let content = try await OnScreenContent.shared.current()
        guard let (placement, filter) = preview.place(in: content) else {
            throw HelperError(.windowUnavailable, "window \(windowId) is not on screen")
        }
        let stream = SCStream(
            filter: filter,
            configuration: preview.configuration(placement, scale: filter.pointPixelScale),
            delegate: preview)
        try stream.addStreamOutput(preview, type: .screen, sampleHandlerQueue: preview.queue)
        try await stream.startCapture(within: SCStream.callbackTimeout)
        preview.stream = stream
        preview.following = preview.follow(from: placement)
        return preview
    }

    func stop() async {
        following?.cancel()
        await stream?.stopCapture(within: SCStream.callbackTimeout)
    }

    /// Where the window is now, and the filter showing only it; nil when it's not on screen.
    private func place(in content: SCShareableContent) -> (Placement, SCContentFilter)? {
        guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
            return nil
        }
        let shown = { (display: SCDisplay) in
            let part = display.frame.intersection(window.frame)
            return part.isNull ? 0 : part.width * part.height
        }
        guard let display = content.displays.max(by: { shown($0) < shown($1) }), shown(display) > 0
        else { return nil }
        let hidden = content.windows.filter { $0.windowID != windowId }
        let placement = Placement(
            displayId: display.displayID,
            rect: display.frame.intersection(window.frame)
                .offsetBy(dx: -display.frame.minX, dy: -display.frame.minY),
            hidden: Set(hidden.map(\.windowID)))
        return (placement, SCContentFilter(display: display, excludingWindows: hidden))
    }

    private func configuration(_ placement: Placement, scale: Float) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.sourceRect = placement.rect
        (config.width, config.height) = PreviewFrame.size(
            of: placement.rect.size, scale: scale, for: request)
        PreviewFrame.configure(config, for: request)
        config.backgroundColor = .black
        return config
    }

    /// Keeps the capture on the window as it moves, resizes, or changes display, and other windows left out.
    private func follow(from placement: Placement) -> Task<Void, Never> {
        Task { [weak self] in
            var current = placement
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.followInterval)
                guard let self, let stream = self.stream, !Task.isCancelled else { return }
                do {
                    let content = try await OnScreenContent.shared.current()
                    guard let (next, filter) = self.place(in: content), next != current else {
                        continue
                    }
                    let moved = next.displayId != current.displayId
                    if moved || next.hidden != current.hidden {
                        try await stream.updateContentFilter(filter)
                    }
                    if moved || next.rect != current.rect {
                        try await stream.updateConfiguration(
                            self.configuration(next, scale: filter.pointPixelScale))
                    }
                    current = next
                } catch {
                    Log.error("preview of window \(self.windowId): failed to follow: \(error)")
                }
            }
        }
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard
            type == .screen, ScreenTrack.isComplete(sampleBuffer), frames.isReady(request.id),
            let buffer = sampleBuffer.imageBuffer, let pixels = PreviewFrame.Pixels(buffer),
            pixels != lastFrame,
            let data = PreviewFrame.encode(pixels, alpha: false)
        else { return }
        lastFrame = pixels
        frames.send(id: request.id, image: data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.error("preview of window \(windowId) stopped: \(error.localizedDescription)")
    }
}
