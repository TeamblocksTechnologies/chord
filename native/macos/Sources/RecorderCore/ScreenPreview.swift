import CoreImage
import ScreenCaptureKit
import os

// MARK: - Models

/// A display shown live outside any session, as a `display` mode recording of it would capture it.
public struct ScreenPreviewRequest: Codable, Sendable, Equatable {
    /// Names the preview's frames.
    public var id: String
    public var displayId: CGDirectDisplayID
    public var background: ScreenBackground
    public var showsSystemUI: Bool
    public var excludedBundleIds: [String]
    public var showsCursor: Bool

    public init(
        id: String,
        displayId: CGDirectDisplayID,
        background: ScreenBackground = .desktop,
        showsSystemUI: Bool? = nil,
        excludedBundleIds: [String] = [],
        showsCursor: Bool = true
    ) {
        self.id = id
        self.displayId = displayId
        self.background = background
        self.showsSystemUI = showsSystemUI ?? (background == .desktop)
        self.excludedBundleIds = excludedBundleIds
        self.showsCursor = showsCursor
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        displayId = try c.decode(CGDirectDisplayID.self, forKey: .displayId)
        background = try c.decodeIfPresent(ScreenBackground.self, forKey: .background) ?? .desktop
        showsSystemUI =
            try c.decodeIfPresent(Bool.self, forKey: .showsSystemUI) ?? (background == .desktop)
        excludedBundleIds = try c.decodeIfPresent([String].self, forKey: .excludedBundleIds) ?? []
        showsCursor = try c.decodeIfPresent(Bool.self, forKey: .showsCursor) ?? true
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

/// A running display preview.
public protocol ScreenPreviewStream: Sendable {
    func stop() async
}

/// Starts previewing `request`, sending its frames to `frames`.
public typealias ScreenPreviewFactory =
    @Sendable (
        _ request: ScreenPreviewRequest, _ frames: any FrameSink
    ) async throws -> any ScreenPreviewStream

/// Runs the display previews `setScreenPreview` asks for. Independent of any session.
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

/// Captures real displays with the filter a recording uses.
public let liveScreenPreviews: ScreenPreviewFactory = { request, frames in
    try await DisplayPreview.start(request, frames: frames)
}

/// A display captured as a recording of it would be, scaled down to a thumbnail at a low frame rate. Opaque
/// frames are JPEG; transparent ones PNG, keeping their alpha.
final class DisplayPreview: NSObject, ScreenPreviewStream, SCStreamOutput, SCStreamDelegate,
    @unchecked Sendable
{
    private static let maxWidth = 960.0
    private static let fps: Int32 = 10
    /// How often a transparent preview checks for apps launching or quitting, as tracks do.
    private static let applicationsInterval = Duration.seconds(1)
    private static let context = CIContext()
    private static let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private let request: ScreenPreviewRequest
    private let frames: any FrameSink
    private let queue: DispatchQueue
    // Set once while starting.
    private var stream: SCStream?
    private var following: Task<Void, Never>?

    private init(request: ScreenPreviewRequest, frames: any FrameSink) {
        self.request = request
        self.frames = frames
        queue = DispatchQueue(label: "chord.preview.display-\(request.displayId)")
    }

    static func start(_ request: ScreenPreviewRequest, frames: any FrameSink) async throws
        -> DisplayPreview
    {
        let preview = DisplayPreview(request: request, frames: frames)
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == request.displayId })
        else {
            throw HelperError(.displayUnavailable, "display \(request.displayId) is not connected")
        }
        let (filter, apps) = preview.filter(display: display, content: content)

        let config = SCStreamConfiguration()
        let size = filter.contentRect.size
        let width = min(maxWidth, size.width * Double(filter.pointPixelScale))
        config.width = Int(width)
        config.height = Int(width * size.height / size.width)
        config.minimumFrameInterval = CMTime(value: 1, timescale: fps)
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = request.showsCursor
        if request.background == .transparent { config.backgroundColor = ScreenTrack.clearColor }
        config.queueDepth = 3

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
                    let content = try await SCShareableContent.excludingDesktopWindows(
                        false, onScreenWindowsOnly: true)
                    guard
                        let display = content.displays.first(where: {
                            $0.displayID == self.request.displayId
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
                        "preview of display \(self.request.displayId): failed to update applications: \(error)"
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
            let pixels = sampleBuffer.imageBuffer
        else { return }
        let image = CIImage(cvPixelBuffer: pixels)
        let data =
            if request.background == .transparent {
                Self.context.pngRepresentation(
                    of: image, format: .RGBA8, colorSpace: Self.colorSpace)
            } else {
                Self.context.jpegRepresentation(
                    of: image, colorSpace: Self.colorSpace,
                    options: [
                        CIImageRepresentationOption(
                            rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.7
                    ]
                )
            }
        if let data { frames.send(id: request.id, image: data) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.error("preview of display \(request.displayId) stopped: \(error.localizedDescription)")
    }
}
