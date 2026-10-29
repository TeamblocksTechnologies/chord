import AVFoundation

/// A device held running so a session starting soon doesn't wait for it to power up.
public protocol WarmDevice: Sendable {
    func stop() async
}

public enum WarmTarget: Sendable, Equatable {
    case microphone(MicrophoneConfig)
    case camera(CameraConfig)

    var key: String {
        switch self {
        case .microphone(let config): "microphone:\(config.deviceId)"
        case .camera(let config): "camera:\(config.deviceId)"
        }
    }
}

public typealias WarmDeviceFactory = @Sendable (WarmTarget) async throws -> any WarmDevice

/// Keeps the microphones and cameras of `warmUp` running, without recording them, until a session's tracks take them
/// over. Warming is best effort: a device that can't start is logged and left for the session to report.
actor DeviceWarmer {
    private let makeDevice: WarmDeviceFactory
    private var devices: [String: (target: WarmTarget, device: any WarmDevice)] = [:]

    init(makeDevice: @escaping WarmDeviceFactory) {
        self.makeDevice = makeDevice
    }

    /// Warms exactly the microphones and cameras in `update`, restarting a camera whose settings changed; an update
    /// without any releases them all.
    func set(_ update: SessionUpdate) async {
        let targets =
            update.microphones.map(WarmTarget.microphone) + update.cameras.map(WarmTarget.camera)
        let wanted = Dictionary(
            targets.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        for (key, warm) in devices where wanted[key] != warm.target {
            devices[key] = nil
            await warm.device.stop()
        }
        for target in targets where devices[target.key] == nil {
            do {
                devices[target.key] = (target, try await makeDevice(target))
            } catch {
                Log.error("could not warm up \(target.key): \(error)")
            }
        }
    }

    /// Hands over the device warmed for exactly `target`, which the caller then owns and stops.
    func take(_ target: WarmTarget) -> (any WarmDevice)? {
        guard let warm = devices[target.key], warm.target == target else { return nil }
        devices[target.key] = nil
        return warm.device
    }
}

/// Runs real devices: a capture session each, set up as its track records it, so the track can take it over
/// running.
public let liveWarmDevices: WarmDeviceFactory = { target in
    switch target {
    case .microphone(let config):
        guard let device = AVCaptureDevice(uniqueID: config.deviceId) else {
            throw HelperError(.deviceUnavailable, "microphone \(config.deviceId) is not connected")
        }
        let (session, output) = try MicrophoneTrack.makeSession(device)
        let capture = WarmCapture(session: session, output: output)
        await capture.start()
        return capture
    case .camera(let config):
        // Without access the session would never produce frames, and asking is the session's job.
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            throw HelperError(.deviceUnavailable, "camera access is not granted")
        }
        guard let device = AVCaptureDevice(uniqueID: config.deviceId) else {
            throw HelperError(.deviceUnavailable, "camera \(config.deviceId) is not connected")
        }
        let (session, output, locked) = try CameraTrack.makeSession(device, config: config)
        defer { if locked { device.unlockForConfiguration() } }
        let capture = WarmCapture(session: session, output: output)
        await capture.start()
        return capture
    }
}

/// A running capture session nothing records yet. A track taking it over sets the output's delegate.
final class WarmCapture: WarmDevice, @unchecked Sendable {
    let session: AVCaptureSession
    let output: AVCaptureOutput
    private let queue = DispatchQueue(label: "chord.warmup")

    init(session: AVCaptureSession, output: AVCaptureOutput) {
        self.session = session
        self.output = output
    }

    /// Starts the session. For a camera, also waits for its first frame, which can come a second after starting.
    func start() async {
        await queue.run {
            guard let video = self.output as? AVCaptureVideoDataOutput else {
                self.session.startRunning()
                return
            }
            let watcher = FrameWatcher()
            video.setSampleBufferDelegate(
                watcher, queue: DispatchQueue(label: "chord.warmup.frames"))
            self.session.startRunning()
            if watcher.frame.wait(timeout: .now() + 3) == .timedOut {
                Log.error("warm camera sent no frame within 3 seconds")
            }
            video.setSampleBufferDelegate(nil, queue: nil)
        }
    }

    func stop() async {
        await queue.run { self.session.stopRunning() }
    }
}

private final class FrameWatcher: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate,
    @unchecked Sendable
{
    let frame = DispatchSemaphore(value: 0)

    func captureOutput(_: AVCaptureOutput, didOutput _: CMSampleBuffer, from _: AVCaptureConnection)
    {
        frame.signal()
    }
}

extension TrackContext {
    /// The session warmed for `target`, if it was warmed by the live factory with the same settings.
    func warmCapture(for target: WarmTarget) async -> WarmCapture? {
        guard let device = await adopt(target) else { return nil }
        if let capture = device as? WarmCapture { return capture }
        await device.stop()
        return nil
    }
}
