import AVFoundation
import ScreenCaptureKit
import VideoToolbox
import os

/// Records one display. A session has one per display for its mode, sharing a `ScreenGroup`; the mode decides which
/// capture: `display` records the displays it names, `applications` only its display, `focusedWindow` every display
/// showing only the followed window, so it can be resized or dragged between displays without a cut. `area` mode
/// records each area on a track of its own. Each pinned window has its own track per display too, captured as the
/// followed window is, whichever the mode.
///
/// Stays armed across interruptions (sleep, lock, display unplugged, stream errors) so `restore()` can continue in
/// a new segment. While capturing, the filter follows the group in place: apps launching and quitting, and the
/// followed or pinned window.
final class ScreenTrack: NSObject, ScreenRecordingTrack, SCStreamOutput, SCStreamDelegate,
    @unchecked Sendable
{
    let id: String
    let kind = TrackKind.screen
    let source: String
    let display: TrackDisplay?
    let window: RecordedWindow?
    let displayId: CGDirectDisplayID
    let subject: ScreenSubject

    private let group: ScreenGroup
    private let files: SegmentFiles
    private let signal: @Sendable (TrackSignal) -> Void
    private let queue: DispatchQueue

    private struct Capture: @unchecked Sendable {
        let stream: SCStream
        let writer: SegmentWriter
        let target: ScreenTarget
        /// `focusedWindow`: the windows the filter was asked to show (`FollowedWindow.shown`), and the main one.
        var shownWindows: [CGWindowID] = []
        var mainWindow: CGWindowID?
        /// `applications`: the apps the filter shows.
        var shownApps: Set<pid_t> = []
        /// `focusedWindow`: the windows the filter accounts for: shown, or excluded.
        var accountedWindows: Set<CGWindowID> = []
        /// Output width in pixels.
        let width: Int
        /// Frames are BGRA with transparency, written as HEVC with alpha.
        var alpha = false
        /// `focusedWindow`: the bounds last recorded, so only changes are.
        var lastBounds: (window: CGWindowID?, frame: Rect?)?
    }

    // Confined to `queue`.
    private var armed = false
    /// Interrupted (sleep, lock): only `restore()` continues.
    private var suspended = false
    private var starting = false
    private var capture: Capture?
    private var failures: FailureReporter
    /// A filter update or window switch is in flight.
    private var following = false
    private var lastApplicationsCheck: ContinuousClock.Instant?
    private var startWaits: [ObjectIdentifier: StartWait] = [:]

    init(
        id: String,
        displayId: CGDirectDisplayID,
        subject: ScreenSubject,
        window: RecordedWindow?,
        group: ScreenGroup,
        files: SegmentFiles,
        signal: @escaping @Sendable (TrackSignal) -> Void
    ) {
        self.id = id
        self.displayId = displayId
        self.subject = subject
        self.window = window
        self.group = group
        self.files = files
        self.signal = signal
        queue = DispatchQueue(label: "chord.track.\(id)")
        failures = FailureReporter(trackId: id, signal: signal)
        source = window.map { "display:\(displayId)/window:\($0.id)" } ?? "display:\(displayId)"
        display = Self.describe(displayId)
    }

    func start() async throws {
        try await group.arm()
        await queue.run {
            self.armed = true
            self.suspended = false
        }
        do {
            try await beginCapture()
        } catch {
            await stop(reason: .error)
            throw error
        }
    }

    func stop(reason: SegmentEndReason, at hostTime: Double?) async {
        let (capture, wasArmed) = await queue.run { () -> (Capture?, Bool) in
            let wasArmed = self.armed
            self.armed = false
            return (self.takeCapture(), wasArmed)
        }
        if wasArmed { await group.disarm() }
        if let capture { await end(capture, reason: reason, at: hostTime) }
    }

    func interrupt(reason: SegmentEndReason) async {
        let capture = await queue.run { () -> Capture? in
            self.suspended = true
            return self.takeCapture()
        }
        if let capture { await end(capture, reason: reason) }
    }

    func restore() async {
        await queue.run { self.suspended = false }
        await startReportingFailures()
    }

    func setMode(_ mode: ScreenMode) async throws -> [any RecordingTrack] {
        let created = try await group.setMode(mode)
        Log.info("screen: mode \(mode)")
        return created
    }

    func setPinnedWindows(_ windowIds: [UInt32]) async throws -> [any RecordingTrack] {
        try await group.setPinned(windowIds)
    }

    func checkPinnedWindows(_ windowIds: [UInt32]) async throws {
        try await group.checkPinned(windowIds)
    }

    func setSettings(_ config: ScreenConfig) async {
        await group.setSettings(config)
    }

    /// What this track records changed (the mode, or whether its window is pinned): ends the segment with `reason`,
    /// and continues in a new one if this track still records.
    func restartCapture(reason: SegmentEndReason) async {
        let (previous, suspended) = await queue.run { (self.takeCapture(), self.suspended) }
        if let previous { await end(previous, reason: reason) }
        guard !suspended else { return }
        await startReportingFailures()
    }

    /// Called by the group's poll: brings the capture in step with running apps or the followed window.
    func reconcile() {
        queue.async { self.reconcileOnQueue() }
    }

    // MARK: SCStreamOutput / SCStreamDelegate

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen, let capture, Self.isComplete(sampleBuffer) else { return }
        // Read first, before the menu bar blackout and the encoder, to stay as close to capture time as possible.
        let bounds = currentBounds()
        if case .window = capture.target { blackOutMenuBar(sampleBuffer, clear: capture.alpha) }
        switch capture.writer.append(sampleBuffer) {
        case .began:
            failures.reset()
            signal(
                .started(
                    trackId: id,
                    file: capture.writer.url.lastPathComponent,
                    hostTime: sampleBuffer.presentationTimeStamp.seconds
                ))
            recordBounds(bounds, at: sampleBuffer)
        case .appended:
            recordBounds(bounds, at: sampleBuffer)
        case .dropped:
            break
        case .failed(let failure):
            guard let capture = takeCapture() else { return }
            failures.report(failure.message, fatal: failure.isDiskFull)
            Task { await end(capture, reason: failure.isDiskFull ? .diskFull : .error) }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let streamId = ObjectIdentifier(stream)
        let message = error.localizedDescription
        queue.async {
            if let wait = self.startWaits.removeValue(forKey: streamId) {
                // Failed while starting: `beginCapture` cleans up.
                wait.finish(error)
                return
            }
            guard let capture = self.capture, ObjectIdentifier(capture.stream) == streamId else {
                return
            }
            self.capture = nil
            let displayGone = !Self.activeDisplays().contains(self.displayId)
            if !displayGone { self.failures.report(message) }
            Task { await self.end(capture, reason: displayGone ? .deviceDisconnected : .error) }
        }
    }

    // MARK: Capture lifecycle

    private func startReportingFailures() async {
        do {
            try await beginCapture()
        } catch {
            let message = "\(error)"
            queue.async { self.failures.report(message) }
        }
    }

    private func beginCapture() async throws {
        let claimed = await queue.run { () -> Bool in
            guard
                self.armed, self.capture == nil, !self.starting,
                self.group.target(self.displayId, for: self.subject) != nil
            else { return false }
            self.starting = true
            return true
        }
        guard claimed else { return }

        let capture: Capture
        do {
            capture = try await makeCapture()
        } catch {
            await queue.run { self.starting = false }
            throw error
        }

        // Disarmed (stopped) while starting: discard.
        let installed = await queue.run { () -> Bool in
            self.starting = false
            guard self.armed else { return false }
            self.capture = capture
            return true
        }
        guard installed else {
            _ = await capture.writer.finish()
            return
        }

        do {
            try await startStream(capture)
        } catch {
            let stillInstalled = await queue.run { () -> Bool in
                guard let current = self.capture, current.stream === capture.stream else {
                    return false
                }
                self.capture = nil
                return true
            }
            if stillInstalled { _ = await capture.writer.finish() }
            throw error
        }
    }

    /// `startCapture` never completes if the stream fails while starting, so a stream error also ends the wait.
    private func startStream(_ capture: Capture) async throws {
        let streamId = ObjectIdentifier(capture.stream)
        let wait = StartWait()
        await queue.run { self.startWaits[streamId] = wait }
        defer { queue.async { self.startWaits[streamId] = nil } }
        try await wait.wait(
            timeout: SCStream.callbackTimeout,
            HelperError(.startFailed, "screen capture didn't start")
        ) {
            capture.stream.startCapture { error in wait.finish(error) }
        }
    }

    /// On `queue`.
    private func takeCapture() -> Capture? {
        defer { capture = nil }
        return capture
    }

    /// Sample times are host times, so `hostTime` cuts the segment as is.
    private func end(_ capture: Capture, reason: SegmentEndReason, at hostTime: Double? = nil) async
    {
        await capture.stream.stopCapture(within: SCStream.callbackTimeout)
        await capture.writer.finish(trackId: id, reason: reason, at: hostTime, signal: signal)
    }

    private func makeCapture() async throws -> Capture {
        guard let target = group.target(displayId, for: subject) else {
            throw HelperError(.invalidState, "\(id) has nothing to record")
        }
        let followed = group.window(for: subject)
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
            throw HelperError(.displayUnavailable, "display \(displayId) is not connected")
        }

        var shownWindows: [CGWindowID] = []
        var shownApps: Set<pid_t> = []
        var accountedWindows: Set<CGWindowID> = []
        let filter: SCContentFilter
        switch target {
        case .display(_, .desktop, let showsSystemUI):
            filter = Self.desktopFilter(
                display: display, content: content, showsSystemUI: showsSystemUI
            ) {
                !group.shows($0.bundleIdentifier, pid: $0.processID, in: target)
            }
        case .display(_, .transparent, _), .applications:
            (filter, shownApps) = applicationsFilter(
                display: display, content: content, target: target)
        case .window:
            (filter, shownWindows, accountedWindows) = windowFilter(
                display: display, content: content, followed: followed)
        }

        let quality = group.config.quality
        let scale = Double(filter.pointPixelScale) * quality.scale
        // Targets that keep only some windows: BGRA frames with a clear background make everything else (wallpaper,
        // other apps) transparent, so a background can be composited behind them later.
        let alpha = target.isTransparent
        let streamConfig: SCStreamConfiguration
        var hdr = false
        if quality.hdr, !alpha, #available(macOS 15.0, *) {
            // 10-bit frames in the display's own extended range; the preset picks the pixel format and color space.
            streamConfig = SCStreamConfiguration(preset: .captureHDRStreamLocalDisplay)
            hdr = true
        } else {
            streamConfig = SCStreamConfiguration()
            streamConfig.pixelFormat =
                alpha ? kCVPixelFormatType_32BGRA : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        }
        // An area crops the display; the rest is never captured.
        var size = filter.contentRect.size
        if case .display(let area?, _, _) = target {
            streamConfig.sourceRect = area
            size = area.size
        }
        streamConfig.width = Self.even(size.width * scale)
        streamConfig.height = Self.even(size.height * scale)
        streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(quality.fps))
        streamConfig.showsCursor = group.config.showsCursor
        if alpha { streamConfig.backgroundColor = Self.clearColor }
        streamConfig.queueDepth = 6

        let writer = try SegmentWriter(url: files.next(), fileType: .mov) { format in
            Self.videoInput(format: format, quality: quality, alpha: alpha, hdr: hdr)
        }
        let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        return Capture(
            stream: stream,
            writer: writer,
            target: target,
            shownWindows: shownWindows,
            mainWindow: followed?.window.id,
            shownApps: shownApps,
            accountedWindows: accountedWindows,
            width: streamConfig.width,
            alpha: alpha
        )
    }

    // MARK: Following

    /// On `queue`.
    private func reconcileOnQueue() {
        guard armed, !starting, !following, let capture else { return }
        if case .pinned(let windowId) = subject, group.isClosed(windowId) {
            self.capture = nil
            Task { await self.end(capture, reason: .windowClosed) }
            return
        }
        switch capture.target {
        case .display(_, .desktop, _):
            return
        case .display(_, .transparent, _), .applications:
            let now = ContinuousClock.now
            if let last = lastApplicationsCheck, now - last < .seconds(1) { return }
            lastApplicationsCheck = now
            following = true
            Task { await self.updateApplications(capture) }
        case .window:
            // A different window, the window or its UI hidden or shown, or a window the filter doesn't exclude yet.
            let followed = group.window(for: subject)
            guard
                (followed?.shown ?? []) != capture.shownWindows
                    || followed?.window.id != capture.mainWindow
                    || !group.windowIds.isSubset(of: capture.accountedWindows)
            else { return }
            following = true
            Task { await self.updateWindow(capture, followed: followed) }
        }
    }

    private func updateApplications(_ capture: Capture) async {
        var updated: Set<pid_t>?
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true)
            if let display = content.displays.first(where: { $0.displayID == displayId }) {
                let (filter, pids) = applicationsFilter(
                    display: display, content: content, target: capture.target)
                if pids != capture.shownApps {
                    try await capture.stream.updateContentFilter(filter)
                    Log.info("\(id): recording \(pids.count) apps")
                    updated = pids
                }
            }
        } catch {
            Log.error("\(id): failed to update applications: \(error)")
        }
        let stream = ObjectIdentifier(capture.stream)
        await queue.run { [updated] in
            self.following = false
            guard let updated, let current = self.capture,
                ObjectIdentifier(current.stream) == stream
            else { return }
            self.capture?.shownApps = updated
        }
    }

    private func updateWindow(_ capture: Capture, followed: FollowedWindow?) async {
        var shown: (windows: [CGWindowID], accounted: Set<CGWindowID>)?
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true)
            if let display = content.displays.first(where: { $0.displayID == displayId }) {
                let (filter, windows, accounted) = windowFilter(
                    display: display, content: content, followed: followed)
                try await capture.stream.updateContentFilter(filter)
                shown = (windows, accounted)
            }
        } catch {
            Log.error("\(id): failed to follow window: \(error)")
        }
        let stream = ObjectIdentifier(capture.stream)
        await queue.run { [shown] in
            self.following = false
            guard let shown, let current = self.capture, ObjectIdentifier(current.stream) == stream
            else { return }
            self.capture?.shownWindows = shown.windows
            self.capture?.accountedWindows = shown.accounted
            self.capture?.mainWindow = followed?.window.id
        }
    }

    /// On `queue`. For a followed or pinned window, the bounds of what's shown (the window and any of its UI), read
    /// from the window server now; `frame` is nil when none of it is on this display. Nil for other targets.
    private func currentBounds() -> (window: CGWindowID?, frame: Rect?)? {
        guard let capture, case .window = capture.target, let display else { return nil }
        let displayFrame = CGRect(
            x: display.frame.x, y: display.frame.y, width: display.frame.width,
            height: display.frame.height)
        let frame = ScreenGroup.frame(of: capture.shownWindows)
            .flatMap { $0.intersects(displayFrame) ? Rect($0) : nil }
        return (frame == nil ? nil : capture.mainWindow, frame)
    }

    /// On `queue`, for a frame in the file. Records `bounds` when they differ from the last recorded frame's. They
    /// were read as the frame arrived, so they can still differ from the image by a fraction of a frame.
    private func recordBounds(
        _ bounds: (window: CGWindowID?, frame: Rect?)?, at sample: CMSampleBuffer
    ) {
        guard let bounds else { return }
        if let last = capture?.lastBounds, last.window == bounds.window, last.frame == bounds.frame
        {
            return
        }
        capture?.lastBounds = bounds
        signal(
            .bounds(
                trackId: id, hostTime: sample.presentationTimeStamp.seconds, window: bounds.window,
                frame: bounds.frame
            ))
    }

    /// On `queue`. The menu bar is drawn by the window server, which excluding apps can't hide, so its strip is
    /// painted black in the frame before it's written.
    private func blackOutMenuBar(_ sample: CMSampleBuffer, clear: Bool) {
        guard let display, let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
        let top = display.frame.y
        let bottom = group.menuBars
            .filter {
                $0.minY <= top + 1 && $0.maxX > display.frame.x
                    && $0.minX < display.frame.x + display.frame.width
            }
            .map(\.maxY)
            .max()
        guard let bottom, bottom > top else { return }
        let height = CVPixelBufferGetHeight(pixels)
        let rows = min(
            height, Int(((bottom - top) / display.frame.height * Double(height)).rounded(.up)))
        guard rows > 0, CVPixelBufferLockBaseAddress(pixels, []) == kCVReturnSuccess else { return }
        defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
        if clear {
            // BGRA: zeroed pixels are transparent.
            guard let base = CVPixelBufferGetBaseAddress(pixels) else { return }
            memset(base, 0, CVPixelBufferGetBytesPerRow(pixels) * rows)
            return
        }
        // 420v: luma black is 16, neutral chroma is 128; chroma has half the rows.
        for (plane, value, planeRows) in [(0, UInt8(16), rows), (1, UInt8(128), (rows + 1) / 2)] {
            guard let base = CVPixelBufferGetBaseAddressOfPlane(pixels, plane) else { continue }
            memset(
                base, Int32(value), CVPixelBufferGetBytesPerRowOfPlane(pixels, plane) * planeRows)
        }
    }

    // MARK: Sources

    /// A shared sRGB color: `SCStream.init` crashes copying a gray one made on the spot.
    static let clearColor = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0)

    private func applicationsFilter(
        display: SCDisplay, content: SCShareableContent, target: ScreenTarget
    ) -> (SCContentFilter, Set<pid_t>) {
        let showsSystemUI: Bool
        if case .display(_, _, let showsUI) = target {
            showsSystemUI = showsUI
        } else {
            showsSystemUI = false
        }
        return Self.applicationsFilter(
            display: display, content: content, showsSystemUI: showsSystemUI
        ) {
            group.shows($0.bundleIdentifier, pid: $0.processID, in: target)
        }
    }

    /// The whole display but the apps `excludes`.
    static func desktopFilter(
        display: SCDisplay, content: SCShareableContent, showsSystemUI: Bool = true,
        excludes: (SCRunningApplication) -> Bool
    ) -> SCContentFilter {
        let excluded = content.applications.filter(excludes)
        let excludedPids = Set(excluded.map(\.processID))
        // The Dock also owns wallpaper windows. Hiding its UI must keep those background windows.
        let desktop = content.windows.filter {
            $0.windowLayer < 0
                && $0.owningApplication.map { excludedPids.contains($0.processID) } == true
        }
        let filter = SCContentFilter(
            display: display, excludingApplications: excluded, exceptingWindows: desktop)
        if #available(macOS 14.2, *) { filter.includeMenuBar = showsSystemUI }
        return filter
    }

    /// The display with only the apps `shows`, and none of the desktop: wallpaper and desktop icons sit below every
    /// normal window. Returns the apps' pids, so apps launching or quitting trigger an update.
    static func applicationsFilter(
        display: SCDisplay, content: SCShareableContent, showsSystemUI: Bool = false,
        shows: (SCRunningApplication) -> Bool
    ) -> (SCContentFilter, Set<pid_t>) {
        let included = content.applications.filter(shows)
        let includedPids = Set(included.map(\.processID))
        // Exceptions invert the app selection. Only exclude desktop windows of INCLUDED apps; exceptions from
        // excluded apps would put their wallpaper back into a transparent capture.
        let desktop = content.windows.filter {
            $0.windowLayer < 0
                && $0.owningApplication.map { includedPids.contains($0.processID) } == true
        }
        let filter = SCContentFilter(
            display: display, including: included, exceptingWindows: desktop)
        if #available(macOS 14.2, *) { filter.includeMenuBar = showsSystemUI }
        return (filter, includedPids)
    }

    /// The display with every window excluded except the followed window and its UI. That leaves the rest of the
    /// frame transparent when the stream has a clear background, and leaves the window unmarked: including the
    /// windows instead gives the same transparency, but macOS then swaps the window's traffic lights for a sharing
    /// indicator, drawn into the frame. Excluding apps instead leaves the background opaque black. Returns the
    /// windows asked for, and the windows accounted for (those, the ones excluded, and any on screen at the last
    /// poll), so a window that opens triggers one update rather than one per poll.
    private func windowFilter(
        display: SCDisplay, content: SCShareableContent, followed: FollowedWindow?
    ) -> (SCContentFilter, [CGWindowID], Set<CGWindowID>) {
        let shown = followed?.shown ?? []
        let hidden = content.windows.filter { !shown.contains($0.windowID) }
        let accounted = Set(shown).union(hidden.map(\.windowID)).union(group.windowIds)
        return (SCContentFilter(display: display, excludingWindows: hidden), shown, accounted)
    }

    private static func describe(_ displayId: CGDirectDisplayID) -> TrackDisplay {
        let mode = CGDisplayCopyDisplayMode(displayId)
        let scale = mode.map { Double($0.pixelWidth) / Double(max($0.width, 1)) } ?? 1
        return TrackDisplay(id: displayId, frame: Rect(CGDisplayBounds(displayId)), scale: scale)
    }

    private static func videoInput(
        format: CMFormatDescription, quality: VideoQuality, alpha: Bool, hdr: Bool
    ) -> AVAssetWriterInput {
        let dimensions = CMVideoFormatDescriptionGetDimensions(format)
        var compression: [String: Any] = [AVVideoExpectedSourceFrameRateKey: quality.fps]
        if let bitrate = quality.bitrate {
            compression[AVVideoAverageBitRateKey] = bitrate
        }
        // HDR needs 10 bits, which only HEVC Main10 carries. The frames' own color attachments describe the range.
        if hdr {
            compression[AVVideoProfileLevelKey] = kVTProfileLevel_HEVC_Main10_AutoLevel as String
        }
        let codec: AVVideoCodecType =
            if alpha { .hevcWithAlpha } else if hdr || quality.codec == .hevc { .hevc } else {
                .h264
            }
        return AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: codec,
                AVVideoWidthKey: dimensions.width,
                AVVideoHeightKey: dimensions.height,
                AVVideoCompressionPropertiesKey: compression,
            ])
    }

    static func isComplete(_ sample: CMSampleBuffer) -> Bool {
        guard
            let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sample, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
            let raw = attachments.first?[.status] as? Int
        else { return false }
        return SCFrameStatus(rawValue: raw) == .complete
    }

    static func activeDisplays() -> [CGDirectDisplayID] {
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        CGGetActiveDisplayList(count, &ids, &count)
        return ids
    }

    private static func even(_ value: Double) -> Int {
        max(2, Int(value) & ~1)
    }
}
