import AVFoundation
import ApplicationServices
import CoreGraphics

public enum PermissionCenter {
    public static func current() -> Permissions {
        Permissions(
            screen: CGPreflightScreenCaptureAccess() ? .granted : .denied,
            microphone: status(for: .audio),
            camera: status(for: .video),
            accessibility: AXIsProcessTrusted() ? .granted : .denied
        )
    }

    public static func request(_ kind: PermissionKind) async -> Permissions {
        switch kind {
        case .screen: _ = CGRequestScreenCaptureAccess()
        case .microphone: _ = await AVCaptureDevice.requestAccess(for: .audio)
        case .camera: _ = await AVCaptureDevice.requestAccess(for: .video)
        case .accessibility:
            // Shows the system alert pointing to System Settings; it doesn't wait for the user.
            _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        }
        return current()
    }

    private static func status(for type: AVMediaType) -> PermissionStatus {
        switch AVCaptureDevice.authorizationStatus(for: type) {
        case .authorized: .granted
        case .denied: .denied
        case .restricted: .restricted
        case .notDetermined: .notDetermined
        @unknown default: .denied
        }
    }
}
