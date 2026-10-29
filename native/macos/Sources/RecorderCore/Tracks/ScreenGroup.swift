import AppKit
import os

/// What a screen track records: what the session's mode records on its display, the nth area on its display in
/// `area` mode (from 1), or a pinned window.
enum ScreenSubject: Sendable, Equatable {
    case mode
    case area(Int)
    case pinned(CGWindowID)
}

/// What a screen track captures, as the mode or pins decide.
enum ScreenTarget: Sendable, Equatable {
    /// The display, or `area` of it in points from its top left.
    case display(area: CGRect?, background: ScreenBackground, showsSystemUI: Bool = true)
    /// The display showing only these apps' windows.
    case applications(bundleIds: [String])
    /// The followed window, or the pinned one, and its UI. `bundleIds` limits what's followed.
    case window(bundleIds: [String]?)

    /// Frames keep only some windows, transparent elsewhere.
    var isTransparent: Bool {
        if case .display(_, let background, _) = self { background == .transparent } else { true }
    }
}

/// A window shown on its own, the one `focusedWindow` mode follows or a pinned one, and the UI shown with it.
struct FollowedWindow: Sendable, Equatable {
    var window: RecordedWindow
    var pid: pid_t
    var onScreen: Bool
    /// The app's windows shown alongside: popups opened from the window, menus, and tooltips. Front to back.
    var related: [CGWindowID] = []

    /// Every window the recording shows.
    var shown: [CGWindowID] { (onScreen ? [window.id] : []) + related }
}

/// Shared by a session's screen tracks: the mode, the window `focusedWindow` follows, the pinned windows, and a poll
/// that keeps every track in step with them. The mode and each pinned window have a track per display connected at
/// start, and each area its own.
final class ScreenGroup: @unchecked Sendable {
    private let context: TrackContext
    /// Main display first.
    private let displays: [CGDirectDisplayID]
    private let queue = DispatchQueue(label: "chord.screen-group")
    private let state: OSAllocatedUnfairLock<State>

    /// Fast enough that a popup appears in the recording within a few frames of opening.
    private static let pollInterval = DispatchTimeInterval.milliseconds(40)
    /// A window opened from a shown window counts as its popup if it's smaller than this share of its area.
    private static let popupAreaRatio = 0.6

    private struct State: Sendable {
        /// The cursor, exclusions, and quality, which `setSettings` changes. `mode` and `pins` supersede its own.
        var config: ScreenConfig
        var mode: ScreenMode
        var followed: FollowedWindow?
        /// Pinned windows that are open.
        var pins: [CGWindowID: FollowedWindow] = [:]
        /// Pinned windows that closed.
        var closedPins: Set<CGWindowID> = []
        /// `focusedWindow` or pins: every window on screen, so tracks can exclude ones that open.
        var windowIds: Set<CGWindowID> = []
        /// `focusedWindow` or pins: menu bars on screen, in global points, which tracks black out.
        var menuBars: [CGRect] = []
    }

    private struct WeakTrack {
        weak var track: ScreenTrack?
    }

    // Confined to `queue`.
    private var tracks: [WeakTrack] = []
    private var armedTracks = 0
    private var poll: DispatchSourceTimer?
    private var bundleIds: [pid_t: String] = [:]
    /// Accessibility roles per app, refreshed when the app's normal windows change.
    private var roles: [pid_t: (windows: Set<CGWindowID>, roles: [CGWindowID: WindowRole]?)] = [:]
    /// Normal windows on screen at the last poll, to spot windows that just opened. `nil` when the last poll didn't
    /// look, so nothing counts as just opened.
    private var knownWindows: Set<CGWindowID>?
    /// Windows opened from a shown window that count as its popups while they're open, and the window each opened
    /// from.
    private var popups: [CGWindowID: CGWindowID] = [:]
    /// Every window pinned this session, numbered in the order first pinned, which names its tracks.
    private var pinNumbers: [CGWindowID: Int] = [:]
    /// The most areas any mode this session had on each display: each has a track.
    private var areaCounts: [CGDirectDisplayID: Int] = [:]

    /// Apps that draw the Mac's own UI rather than windows: the Dock, Control Center and menu bar extras, Notification
    /// Center, and Stage Manager. Controlled independently of desktop transparency.
    private static let systemUIBundleIds: Set<String> = [
        "com.apple.dock", "com.apple.controlcenter", "com.apple.notificationcenterui",
        "com.apple.systemuiserver",
        "com.apple.WindowManager", "com.apple.TextInputMenuAgent",
    ]

    init(config: ScreenConfig, context: TrackContext) {
        self.context = context
        displays = ScreenTrack.activeDisplays().sorted { a, _ in a == CGMainDisplayID() }
        state = OSAllocatedUnfairLock(initialState: State(config: config, mode: config.mode))
    }

    var config: ScreenConfig { state.withLock { $0.config } }
    var mode: ScreenMode { state.withLock { $0.mode } }
    var followed: FollowedWindow? { state.withLock { $0.followed } }
    var windowIds: Set<CGWindowID> { state.withLock { $0.windowIds } }
    var menuBars: [CGRect] { state.withLock { $0.menuBars } }

    /// What `subject`'s tracks show: the followed window, or the pinned one while it's pinned and open.
    func window(for subject: ScreenSubject) -> FollowedWindow? {
        state.withLock { state in
            switch subject {
            case .mode: state.followed
            case .area: nil
            case .pinned(let id): state.pins[id]
            }
        }
    }

    /// What the track recording `displayId` for `subject` captures; nil when it doesn't.
    func target(_ displayId: CGDirectDisplayID, for subject: ScreenSubject) -> ScreenTarget? {
        switch subject {
        case .mode, .area: Self.target(displayId, for: subject, in: mode)
        case .pinned(let id): state.withLock { $0.pins[id] != nil } ? .window(bundleIds: nil) : nil
        }
    }

    func isClosed(_ windowId: CGWindowID) -> Bool {
        state.withLock { $0.closedPins.contains(windowId) }
    }

    /// The session's screen tracks: one per display for the mode, then one per display for each pinned window.
    /// Throws if a pinned window isn't open.
    func makeTracks() throws -> [ScreenTrack] {
        try queue.sync {
            let pinned = try resolve(Self.unique(config.pinnedWindowIds))
            var created = makeTracks(for: .mode, window: nil) + makeAreaTracks(for: config.mode)
            for pin in pinned {
                created += makeTracks(for: .pinned(pin.window.id), window: pin.window)
            }
            state.withLock {
                $0.pins = Dictionary(uniqueKeysWithValues: pinned.map { ($0.window.id, $0) })
            }
            return created
        }
    }

    /// What the track recording `displayId` for `subject` captures in `mode`; nil when it doesn't. Pinned windows'
    /// tracks don't follow the mode.
    static func target(
        _ displayId: CGDirectDisplayID, for subject: ScreenSubject, in mode: ScreenMode
    ) -> ScreenTarget? {
        switch (mode, subject) {
        case (.display(let ids, let background, let showsSystemUI), .mode):
            (ids.isEmpty ? [CGMainDisplayID()] : ids).contains(displayId)
                ? .display(
                    area: nil, background: background,
                    showsSystemUI: showsSystemUI ?? (background == .desktop)) : nil
        case (.applications(let bundleIds, let requested), .mode):
            (requested ?? CGMainDisplayID()) == displayId
                ? .applications(bundleIds: bundleIds) : nil
        case (.focusedWindow(let bundleIds), .mode):
            .window(bundleIds: bundleIds)
        case (.area(let areas, let background, let showsSystemUI), .area(let number)):
            clippedAreas(on: displayId, in: areas).dropFirst(number - 1).first
                .map {
                    .display(
                        area: $0, background: background,
                        showsSystemUI: showsSystemUI ?? (background == .desktop))
                }
        default:
            nil
        }
    }

    /// The areas on `displayId`, in order, clipped to it.
    private static func clippedAreas(on displayId: CGDirectDisplayID, in areas: [ScreenArea])
        -> [CGRect]
    {
        let bounds = CGRect(origin: .zero, size: CGDisplayBounds(displayId).size)
        return areas.filter { $0.displayId == displayId }.map { $0.rect.intersection(bounds) }
    }

    /// Called as each track starts. The first validates the mode, picks the window to follow, and starts polling.
    func arm() async throws {
        try await queue.perform {
            if self.armedTracks == 0 {
                try self.validate(self.mode)
                try self.refresh(required: true)
                self.startPolling()
            }
            self.armedTracks += 1
        }
    }

    func disarm() async {
        await queue.run {
            self.armedTracks -= 1
            guard self.armedTracks == 0 else { return }
            self.poll?.cancel()
            self.poll = nil
            self.knownWindows = nil
        }
    }

    /// See `ScreenRecordingTrack.setMode`. Returns tracks for areas on a display beyond the most it had.
    func setMode(_ mode: ScreenMode) async throws -> [ScreenTrack] {
        let (created, changed) = try await queue.perform { () -> ([ScreenTrack], [ScreenTrack]) in
            try self.validate(mode)
            let previous = self.mode
            self.state.withLock { $0.mode = mode }
            if self.armedTracks > 0 {
                do {
                    try self.refresh(required: true)
                } catch {
                    self.state.withLock { $0.mode = previous }
                    throw error
                }
            }
            // Tracks capturing the same as before carry on, such as a display that stays selected.
            let changed = self.tracks.compactMap(\.track).filter { track in
                if case .pinned = track.subject { return false }
                return Self.target(track.displayId, for: track.subject, in: previous)
                    != Self.target(track.displayId, for: track.subject, in: mode)
            }
            return (self.makeAreaTracks(for: mode), changed)
        }
        for track in changed { await track.restartCapture(reason: .modeChanged) }
        return created
    }

    /// See `ScreenRecordingTrack.checkPinnedWindows`.
    func checkPinned(_ windowIds: [CGWindowID]) async throws {
        try await queue.perform {
            let pinned = self.state.withLock { Set($0.pins.keys).union($0.closedPins) }
            _ = try self.resolve(Self.unique(windowIds).filter { !pinned.contains($0) })
        }
    }

    /// See `ScreenRecordingTrack.setSettings`.
    func setSettings(_ next: ScreenConfig) async {
        let changed = await queue.run { () -> [ScreenTrack] in
            let changed = self.state.withLock { state -> Bool in
                var config = state.config
                config.showsCursor = next.showsCursor
                config.captureChord = next.captureChord
                config.excludedBundleIds = next.excludedBundleIds
                config.quality = next.quality
                defer { state.config = config }
                return config != state.config
            }
            if changed { Log.info("screen: settings \(next)") }
            return changed ? self.tracks.compactMap(\.track) : []
        }
        for track in changed { await track.restartCapture(reason: .configChanged) }
    }

    /// Pins exactly `windowIds`: see `ScreenRecordingTrack.setPinnedWindows`. A pinned window that closed stays
    /// pinned, without tracks capturing, until it's left out.
    func setPinned(_ windowIds: [CGWindowID]) async throws -> [ScreenTrack] {
        let (created, changed) = try await queue.perform { () -> ([ScreenTrack], [ScreenTrack]) in
            let requested = Self.unique(windowIds)
            let pinned = self.state.withLock { Set($0.pins.keys).union($0.closedPins) }
            let added = try self.resolve(requested.filter { !pinned.contains($0) })
            var created: [ScreenTrack] = []
            for pin in added where self.pinNumbers[pin.window.id] == nil {
                created += self.makeTracks(for: .pinned(pin.window.id), window: pin.window)
            }
            let kept = Set(requested)
            self.state.withLock { state in
                state.pins = state.pins.filter { kept.contains($0.key) }
                for pin in added { state.pins[pin.window.id] = pin }
                state.closedPins.formIntersection(kept)
            }
            let changedIds = pinned.symmetricDifference(kept)
            if !changedIds.isEmpty { Log.info("screen: pinned \(requested)") }
            // Tracks of windows pinned again, or no longer pinned. New tracks start with the session.
            let changed = self.tracks.compactMap(\.track).filter { track in
                guard case .pinned(let id) = track.subject else { return false }
                return changedIds.contains(id) && !created.contains { $0 === track }
            }
            if !added.isEmpty, self.armedTracks > 0 { try? self.refresh(required: false) }
            return (created, changed)
        }
        for track in changed { await track.restartCapture(reason: .unpinned) }
        return created
    }

    /// Whether the mode's allow list and the exclusions let an app be recorded.
    func isAllowed(_ bundleId: String, pid: pid_t, by mode: ScreenMode) -> Bool {
        Self.isAllowed(
            bundleId, pid: pid, allowed: mode.allowedBundleIds, excluded: config.excludedBundleIds,
            captureChord: config.captureChord
        )
    }

    func isExcluded(_ bundleId: String, pid: pid_t) -> Bool {
        Self.isExcluded(
            bundleId, pid: pid, excluded: config.excludedBundleIds,
            captureChord: config.captureChord)
    }

    /// Whether `target` shows an app's windows. Only `applications` and a `transparent` background leave apps out
    /// this way; windows are filtered separately.
    func shows(_ bundleId: String, pid: pid_t, in target: ScreenTarget) -> Bool {
        switch target {
        case .applications(let bundleIds):
            Self.isAllowed(
                bundleId, pid: pid, allowed: bundleIds, excluded: config.excludedBundleIds,
                captureChord: config.captureChord
            )
        case .display(_, let background, let showsSystemUI):
            Self.shows(
                bundleId, pid: pid, on: background, showsSystemUI: showsSystemUI,
                excluded: config.excludedBundleIds, captureChord: config.captureChord
            )
        case .window:
            !isExcluded(bundleId, pid: pid)
        }
    }

    /// Whether a display with `background` shows an app's windows. Shared with display previews, so they show
    /// exactly what a session records.
    static func shows(
        _ bundleId: String, pid: pid_t, on background: ScreenBackground, showsSystemUI: Bool? = nil,
        excluded: [String], captureChord: Bool
    ) -> Bool {
        if isExcluded(bundleId, pid: pid, excluded: excluded, captureChord: captureChord) {
            return false
        }
        if !(showsSystemUI ?? (background == .desktop)), systemUIBundleIds.contains(bundleId) {
            return false
        }
        return !(background == .transparent && bundleId == "com.apple.wallpaper.agent")
    }

    /// Shared with the window preview, so it predicts exactly what a session allows.
    static func isAllowed(
        _ bundleId: String, pid: pid_t, allowed: [String]?, excluded: [String], captureChord: Bool
    ) -> Bool {
        if let allowed, !allowed.contains(bundleId) { return false }
        return !isExcluded(bundleId, pid: pid, excluded: excluded, captureChord: captureChord)
    }

    static func isExcluded(_ bundleId: String, pid: pid_t, excluded: [String], captureChord: Bool)
        -> Bool
    {
        if excluded.contains(bundleId) { return true }
        // The helper and the app that spawned it (Electron) are Chord.
        return !captureChord && (pid == getpid() || pid == getppid())
    }

    /// The window a `focusedWindow` session would follow if it started now: the frontmost allowed window that isn't
    /// pinned, as `refresh` picks with nothing followed yet.
    static func windowToFollow(_ config: WindowPreviewConfig) -> PreviewWindow? {
        for window in onScreenWindows()
        where window.isNormal && !config.pinnedWindowIds.contains(window.id) {
            let app = NSRunningApplication(processIdentifier: window.pid)
            let bundleId = app?.bundleIdentifier ?? ""
            guard
                isAllowed(
                    bundleId, pid: window.pid, allowed: config.bundleIds,
                    excluded: config.excludedBundleIds,
                    captureChord: false
                )
            else { continue }
            return PreviewWindow(
                id: window.id, bundleId: bundleId, appName: app?.localizedName ?? bundleId,
                title: window.title
            )
        }
        return nil
    }

    /// Windows that can be pinned: normal windows on screen, front to back, but Chord's.
    static func pinnableWindows() -> [WindowSource] {
        onScreenWindows().filter(\.isNormal).compactMap { window in
            guard
                !isExcluded("", pid: window.pid, excluded: [], captureChord: false),
                let app = NSRunningApplication(processIdentifier: window.pid),
                let bundleId = app.bundleIdentifier
            else { return nil }
            return WindowSource(
                id: window.id, bundleId: bundleId, appName: app.localizedName ?? bundleId,
                title: window.title
            )
        }
    }

    /// The union of `windows`' current frames in global points, from the window server.
    static func frame(of windows: [CGWindowID]) -> CGRect? {
        describe(windows)
            .filter { $0[kCGWindowIsOnscreen as String] as? Bool ?? false }
            .compactMap {
                ($0[kCGWindowBounds as String]).flatMap {
                    CGRect(dictionaryRepresentation: $0 as! CFDictionary)
                }
            }
            .reduce(nil) { union, frame in union?.union(frame) ?? frame }
    }

    // MARK: Private

    /// On `queue`. Every display the mode names was connected at start, and every area is on its display.
    private func validate(_ mode: ScreenMode) throws {
        let requested: [CGDirectDisplayID] =
            switch mode {
            case .display(let ids, _, _): ids.isEmpty ? [CGMainDisplayID()] : ids
            case .applications(_, let id): [id ?? CGMainDisplayID()]
            case .area(let areas, _, _): areas.map(\.displayId)
            case .focusedWindow: []
            }
        if let missing = requested.first(where: { !displays.contains($0) }) {
            throw HelperError(.displayUnavailable, "display \(missing) is not connected")
        }
        guard case .area(let areas, _, _) = mode else { return }
        for (index, area) in areas.enumerated() {
            let clipped = area.rect.intersection(
                CGRect(origin: .zero, size: CGDisplayBounds(area.displayId).size))
            guard clipped.width >= 1, clipped.height >= 1 else {
                throw HelperError(
                    .invalidConfig, "areas[\(index)] is outside display \(area.displayId)")
            }
        }
    }

    /// On `queue`. A track for each of `mode`'s areas on a display beyond the most it had, named for the display and
    /// the area's place among its areas: `area-1-screen-1`.
    private func makeAreaTracks(for mode: ScreenMode) -> [ScreenTrack] {
        guard case .area(let areas, _, _) = mode else { return [] }
        var created: [ScreenTrack] = []
        for (index, displayId) in displays.enumerated() {
            let count = areas.count { $0.displayId == displayId }
            let existing = areaCounts[displayId] ?? 0
            guard count > existing else { continue }
            areaCounts[displayId] = count
            for number in existing + 1...count {
                let id = "area-\(number)-screen-\(index + 1)"
                created.append(
                    ScreenTrack(
                        id: id, displayId: displayId, subject: .area(number), window: nil,
                        group: self,
                        files: context.files(for: id, ext: "mov"), signal: context.signal
                    ))
            }
        }
        tracks += created.map(WeakTrack.init)
        return created
    }

    /// On `queue`. A track per display for `subject`, named for the display, and for pinned windows the order they
    /// were first pinned: `screen-1`, `window-1-screen-1`.
    private func makeTracks(for subject: ScreenSubject, window: RecordedWindow?) -> [ScreenTrack] {
        var prefix = ""
        if case .pinned(let windowId) = subject {
            let number = pinNumbers.count + 1
            pinNumbers[windowId] = number
            prefix = "window-\(number)-"
        }
        let created = displays.enumerated().map { index, displayId in
            let id = "\(prefix)screen-\(index + 1)"
            return ScreenTrack(
                id: id, displayId: displayId, subject: subject, window: window, group: self,
                files: context.files(for: id, ext: "mov"), signal: context.signal
            )
        }
        tracks += created.map(WeakTrack.init)
        return created
    }

    /// On `queue`. The windows as pinning them shows them until the next poll. Throws if one isn't open.
    private func resolve(_ windowIds: [CGWindowID]) throws -> [FollowedWindow] {
        try windowIds.map { id in
            guard
                let info = Self.describe([id]).first,
                let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
            else { throw HelperError(.windowUnavailable, "window \(id) is not open") }
            let title = (info[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return FollowedWindow(
                window: RecordedWindow(id: id, bundleId: bundleId(pid), title: title),
                pid: pid,
                onScreen: info[kCGWindowIsOnscreen as String] as? Bool ?? false
            )
        }
    }

    /// On `queue`.
    private func startPolling() {
        guard poll == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + Self.pollInterval, repeating: Self.pollInterval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            try? self.refresh(required: false)
            for track in self.tracks.compactMap(\.track) { track.reconcile() }
        }
        timer.resume()
        poll = timer
    }

    /// On `queue`. Brings the followed window, the pinned windows, and the UI shown with each in step with the screen.
    /// `required` throws if `focusedWindow` mode has no window to follow and nothing is pinned.
    ///
    /// The followed window: a window that opens from it while it's on screen, from the same app, is its popup while
    /// it stays open if it's noticeably smaller, or if Accessibility says it's a dialog, sheet, or panel; pinned
    /// windows get popups the same way. Focusing a popup keeps the followed window; focusing any other allowed
    /// window follows it, unless it's pinned. If what's focused isn't allowed, the current window stays; if that's
    /// gone, the topmost allowed window is followed. Records changes of window, title, or visibility; tracks record
    /// the bounds of each frame.
    private func refresh(required: Bool) throws {
        let mode = self.mode
        let follows = if case .focusedWindow = mode { true } else { false }
        let pins = state.withLock { $0.pins }
        guard follows || !pins.isEmpty else {
            knownWindows = nil
            if followed != nil { update(nil) }
            return
        }
        let windows = Self.onScreenWindows()
        state.withLock {
            $0.windowIds = Set(windows.map(\.id))
            $0.menuBars = windows.filter(\.isMenuBar).map(\.frame)
        }
        let normal = windows.filter(\.isNormal)
        // Pinned windows and their popups are never followed.
        let isPinned = { (id: CGWindowID) in
            pins[id] != nil || self.popups[id].map { pins[$0] != nil } == true
        }
        let allowed = { (window: OnScreenWindow) in
            !isPinned(window.id)
                && self.isAllowed(self.bundleId(window.pid), pid: window.pid, by: mode)
        }
        let current = follows ? followed : nil
        let currentShown = current.flatMap { current in
            normal.first { $0.id == current.window.id && allowed($0) }
        }
        let owners = Set(pins.keys).union(currentShown.map { [$0.id] } ?? [])
        spotPopups(in: normal, openedFrom: owners)

        var main: OnScreenWindow?
        if follows {
            if let front = normal.first, allowed(front) {
                main = popups[front.id] != nil ? currentShown : front
            } else {
                main = currentShown ?? normal.first(where: allowed)
            }
            if main == nil, required, pins.isEmpty {
                throw HelperError(.windowUnavailable, "no allowed window is on screen")
            }
        }

        let shown = Set(pins.keys).union(main.map { [$0.id] } ?? [])
        let frontmost = frontmostShown(in: normal, shown: shown)
        if !follows {
            if followed != nil { update(nil) }
        } else if let main {
            // A popup belongs to the window it opened from.
            if main.id != current?.window.id { popups = popups.filter { pins[$0.value] != nil } }
            let next = FollowedWindow(
                window: RecordedWindow(
                    id: main.id, bundleId: bundleId(main.pid), title: main.title),
                pid: main.pid,
                onScreen: true,
                related: related(to: main, in: windows, frontmost: frontmost)
            )
            if next != current { update(next) }
        } else if var hidden = current, hidden.onScreen {
            // Nothing allowed is on screen: keep following the current window while it's hidden.
            hidden.onScreen = false
            hidden.related = []
            update(hidden)
        }
        refreshPins(pins, windows: windows, frontmost: frontmost)
    }

    /// On `queue`. Notes windows that just opened from a window in `owners` as its popups, and forgets ones that
    /// closed. A window opens from its app's frontmost window in `owners`.
    private func spotPopups(in normal: [OnScreenWindow], openedFrom owners: Set<CGWindowID>) {
        let ids = Set(normal.map(\.id))
        popups = popups.filter { ids.contains($0.key) }
        defer { knownWindows = ids }
        guard let knownWindows else { return }
        for window in normal where !knownWindows.contains(window.id) {
            guard
                let owner = normal.first(where: { owners.contains($0.id) && $0.pid == window.pid }),
                owner.id != window.id
            else { continue }
            let small = window.frame.area < owner.frame.area * Self.popupAreaRatio
            if small || role(of: window, among: normal) == .auxiliary {
                popups[window.id] = owner.id
            }
        }
    }

    /// On `queue`. For each app whose frontmost normal window is a window in `shown` or one of its popups, that
    /// window: the one the app's menus, popovers, and tooltips belong to.
    private func frontmostShown(in normal: [OnScreenWindow], shown: Set<CGWindowID>) -> [pid_t:
        CGWindowID]
    {
        var frontmost: [pid_t: CGWindowID] = [:]
        var seen: Set<pid_t> = []
        for window in normal where seen.insert(window.pid).inserted {
            let owner = shown.contains(window.id) ? window.id : popups[window.id]
            if let owner, shown.contains(owner) { frontmost[window.pid] = owner }
        }
        return frontmost
    }

    /// On `queue`. A shown window's popups, and its app's menus, popovers, and tooltips if it's the app's frontmost.
    private func related(
        to main: OnScreenWindow, in windows: [OnScreenWindow], frontmost: [pid_t: CGWindowID]
    ) -> [CGWindowID] {
        windows.compactMap { window in
            guard window.pid == main.pid, window.id != main.id else { return nil }
            if popups[window.id] == main.id { return window.id }
            return window.isTransient && frontmost[main.pid] == main.id ? window.id : nil
        }
    }

    /// On `queue`. Pinned windows that left the screen keep their tracks, showing nothing; ones that closed end them.
    private func refreshPins(
        _ pins: [CGWindowID: FollowedWindow], windows: [OnScreenWindow],
        frontmost: [pid_t: CGWindowID]
    ) {
        var next = pins
        var closed: [CGWindowID] = []
        for (id, pin) in pins {
            if let window = windows.first(where: { $0.id == id }) {
                next[id] = FollowedWindow(
                    window: RecordedWindow(
                        id: id, bundleId: pin.window.bundleId, title: window.title),
                    pid: window.pid,
                    onScreen: true,
                    related: related(to: window, in: windows, frontmost: frontmost)
                )
            } else if !Self.describe([id]).isEmpty {
                next[id]?.onScreen = false
                next[id]?.related = []
            } else {
                next[id] = nil
                closed.append(id)
                Log.info("screen: pinned window \(id) closed")
            }
        }
        guard next != pins else { return }
        state.withLock { [next, closed] state in
            state.pins = next
            state.closedPins.formUnion(closed)
        }
    }

    /// On `queue`. `nil` for a normal window Accessibility doesn't list, or without Accessibility.
    private func role(of window: OnScreenWindow, among normal: [OnScreenWindow]) -> WindowRole? {
        let appWindows = normal.filter { $0.pid == window.pid }
        let ids = Set(appWindows.map(\.id))
        if roles[window.pid]?.windows != ids {
            roles[window.pid] = (
                ids, WindowRoles.roles(pid: window.pid).map { Self.match($0, to: appWindows) }
            )
        }
        return roles[window.pid]?.roles?[window.id]
    }

    /// Matches Accessibility windows to window server windows by frame.
    private static func match(
        _ roles: [(frame: CGRect, role: WindowRole)], to windows: [OnScreenWindow]
    ) -> [CGWindowID: WindowRole] {
        var matched: [CGWindowID: WindowRole] = [:]
        for (frame, role) in roles {
            let window = windows.first { candidate in
                matched[candidate.id] == nil
                    && abs(candidate.frame.minX - frame.minX) < 2
                    && abs(candidate.frame.minY - frame.minY) < 2
                    && abs(candidate.frame.width - frame.width) < 2
                    && abs(candidate.frame.height - frame.height) < 2
            }
            if let window { matched[window.id] = role }
        }
        return matched
    }

    /// On `queue`.
    private func update(_ next: FollowedWindow?) {
        let previous = state.withLock { state in
            defer { state.followed = next }
            return state.followed
        }
        if previous?.window.id != next?.window.id {
            Log.info(
                "screen: following \(next.map { "window \($0.window.id) of \($0.window.bundleId)" } ?? "nothing")"
            )
        }
        if previous?.related != next?.related, let next, !next.related.isEmpty {
            Log.info("screen: showing \(next.related) with window \(next.window.id)")
        }
        if previous?.window != next?.window || previous?.onScreen != next?.onScreen {
            context.signal(
                .window(
                    hostTime: context.clock.now(), window: next?.window,
                    hidden: next?.onScreen == false))
        }
    }

    /// On `queue`.
    private func bundleId(_ pid: pid_t) -> String {
        if let known = bundleIds[pid] { return known }
        let bundleId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
        bundleIds[pid] = bundleId
        return bundleId
    }

    private struct OnScreenWindow {
        let id: CGWindowID
        let pid: pid_t
        let title: String?
        let layer: Int
        let alpha: Double
        /// Global points.
        let frame: CGRect

        /// A window that can be focused and followed.
        var isNormal: Bool { layer == 0 && alpha > 0 && frame.width >= 40 && frame.height >= 40 }

        /// A display's menu bar. Others share its layer, such as the screenshot overlay, which covers the display.
        var isMenuBar: Bool { layer == 24 && frame.height <= 60 }

        /// Menus, popovers, tooltips, and floating panels. Skips the Dock (20), menu bar (24), and menu bar extras
        /// (25).
        var isTransient: Bool {
            layer > 0 && layer < 1000 && ![20, 24, 25].contains(layer) && alpha > 0
        }
    }

    /// Every on-screen window front to back. The first normal window is the focused one. Doesn't need Accessibility
    /// permission.
    private static func onScreenWindows() -> [OnScreenWindow] {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
        else { return [] }
        return list.compactMap { info in
            guard
                let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
                let boundsInfo = info[kCGWindowBounds as String],
                let frame = CGRect(dictionaryRepresentation: boundsInfo as! CFDictionary)
            else { return nil }
            return OnScreenWindow(
                id: id,
                pid: pid,
                title: (info[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 },
                layer: info[kCGWindowLayer as String] as? Int ?? 0,
                alpha: info[kCGWindowAlpha as String] as? Double ?? 1,
                frame: frame
            )
        }
    }

    /// The window server's descriptions of those of `windows` that exist, on screen or not.
    private static func describe(_ windows: [CGWindowID]) -> [[String: Any]] {
        guard !windows.isEmpty else { return [] }
        // The API takes a CFArray of raw window ids, not objects.
        var pointers = windows.map { UnsafeRawPointer(bitPattern: UInt($0)) }
        guard
            let ids = CFArrayCreate(nil, &pointers, pointers.count, nil),
            let list = CGWindowListCreateDescriptionFromArray(ids) as? [[String: Any]]
        else { return [] }
        return list
    }

    /// `ids` in order, without repeats.
    private static func unique(_ ids: [CGWindowID]) -> [CGWindowID] {
        var seen: Set<CGWindowID> = []
        return ids.filter { seen.insert($0).inserted }
    }
}

extension CGRect {
    fileprivate var area: Double { width * height }
}
