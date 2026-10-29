import AVFoundation

/// Capture state is confined to the track's queue; a detached segment is handed to `finalize` once.
struct DeviceCapture: @unchecked Sendable {
    let session: AVCaptureSession
    var writer: SegmentWriter
    let clock: CMClock
    let errorObserver: NSObjectProtocol
}

/// Shared lifecycle for camera and microphone capture. Subclasses supply session setup and recovery policy.
class DeviceTrack: NSObject, RecordingTrack, @unchecked Sendable {
    let id: String
    let kind: TrackKind
    let source: String
    let files: SegmentFiles
    let signal: @Sendable (TrackSignal) -> Void
    let queue: DispatchQueue
    var armed = false
    var capture: DeviceCapture?
    var failures: FailureReporter
    private let adopt: @Sendable (WarmTarget) async -> WarmCapture?
    private var observers: [NSObjectProtocol] = []

    init(
        id: String, kind: TrackKind, source: String, files: SegmentFiles,
        adopt: @escaping @Sendable (WarmTarget) async -> WarmCapture?,
        signal: @escaping @Sendable (TrackSignal) -> Void
    ) {
        self.id = id
        self.kind = kind
        self.source = source
        self.files = files
        self.adopt = adopt
        self.signal = signal
        queue = DispatchQueue(label: "chord.track.\(id)")
        failures = FailureReporter(trackId: id, signal: signal)
        super.init()
        let center = NotificationCenter.default
        let watch:
            (Notification.Name, @escaping @Sendable (DeviceTrack) -> Void) -> NSObjectProtocol = {
                name, action in
                center.addObserver(forName: name, object: nil, queue: nil) { [weak self] note in
                    guard let self, (note.object as? AVCaptureDevice)?.uniqueID == source else {
                        return
                    }
                    self.queue.async { action(self) }
                }
            }
        observers = [
            watch(AVCaptureDevice.wasDisconnectedNotification) {
                $0.endCapture(reason: .deviceDisconnected)
            },
            watch(AVCaptureDevice.wasConnectedNotification) { $0.restoreCapture() },
        ]
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    func warmTarget() async throws -> WarmTarget {
        preconditionFailure("A device track supplies its warm target")
    }
    func beginCapture(adopting warm: WarmCapture? = nil) throws {
        preconditionFailure("A device track supplies its session")
    }
    func didStopCapture() {}
    func runtimeError(_ sessionId: ObjectIdentifier, message: String) {
        failures.report(message)
        endCapture(reason: .error)
    }

    func start() async throws {
        let warm = await adopt(try await warmTarget())
        try await queue.perform {
            self.armed = true
            try self.beginCapture(adopting: warm)
        }
    }
    func stop(reason: SegmentEndReason, at hostTime: Double?) async {
        let capture = await queue.run { () -> DeviceCapture? in
            self.armed = false
            return self.takeCapture()
        }
        if let capture { await finalize(capture, reason: reason, at: hostTime) }
    }
    func interrupt(reason: SegmentEndReason) async {
        if let capture = await queue.run({ self.takeCapture() }) {
            await finalize(capture, reason: reason)
        }
    }
    func restore() async { await queue.run { self.restoreCapture() } }

    /// Stops a prepared session if writer creation fails; observers and clocks are installed in the same order.
    func activate(_ session: AVCaptureSession, writer makeWriter: () throws -> SegmentWriter) throws
    {
        let writer: SegmentWriter
        do { writer = try makeWriter() } catch {
            session.stopRunning()
            throw error
        }
        let sessionId = ObjectIdentifier(session)
        let observer = NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil
        ) { [weak self] note in
            let message =
                (note.userInfo?[AVCaptureSessionErrorKey] as? Error)?.localizedDescription
                ?? "capture error"
            guard let self else { return }
            self.queue.async { self.runtimeError(sessionId, message: message) }
        }
        capture = DeviceCapture(
            session: session, writer: writer,
            clock: session.synchronizationClock ?? CMClockGetHostTimeClock(),
            errorObserver: observer)
        if !session.isRunning { session.startRunning() }
    }

    func takeCapture() -> DeviceCapture? {
        guard let capture else { return nil }
        self.capture = nil
        capture.session.stopRunning()
        didStopCapture()
        NotificationCenter.default.removeObserver(capture.errorObserver)
        return capture
    }
    func endCapture(reason: SegmentEndReason) {
        guard let capture = takeCapture() else { return }
        Task { await finalize(capture, reason: reason) }
    }
    func restoreCapture() {
        guard armed, capture == nil else { return }
        do { try beginCapture() } catch {
            failures.report("\(error)", fatal: WriterFailure.isDiskFull(error))
        }
    }
    func finalize(_ capture: DeviceCapture, reason: SegmentEndReason, at hostTime: Double? = nil)
        async
    {
        await capture.writer.finish(
            trackId: id, clock: capture.clock, reason: reason, at: hostTime, signal: signal)
    }
}
