import AVFoundation
import AppKit
import ScreenCaptureKit

public enum SourceCatalog {
    public static func list() async -> SourceList {
        let names = await displayNames()
        let describe = { (id: CGDirectDisplayID) -> DisplaySource in display(id, name: names[id]) }
        var displays: [DisplaySource]
        var applications: [ApplicationSource] = []
        // Bounded: ScreenCaptureKit can drop the callback, which would block every request after this one.
        if let content = try? await SCShareableContent.onScreen(within: SCStream.callbackTimeout) {
            displays = content.displays.map { describe($0.displayID) }
            applications = content.applications
                .filter { !$0.bundleIdentifier.isEmpty }
                .map {
                    ApplicationSource(
                        bundleId: $0.bundleIdentifier, name: $0.applicationName, pid: $0.processID)
                }
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        } else {
            // Without screen recording permission, displays are still listable through CoreGraphics.
            var count: UInt32 = 0
            CGGetActiveDisplayList(0, nil, &count)
            var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
            CGGetActiveDisplayList(count, &ids, &count)
            displays = ids.map(describe)
        }

        return SourceList(
            displays: displays,
            applications: applications,
            windows: ScreenGroup.pinnableWindows(),
            microphones: devices(types: [.microphone, .external], media: .audio).map {
                DeviceSource(
                    id: $0.device.uniqueID, name: $0.device.localizedName, isDefault: $0.isDefault)
            },
            cameras: devices(
                types: [.builtInWideAngleCamera, .external, .continuityCamera, .deskViewCamera],
                media: .video
            ).map {
                CameraSource(
                    id: $0.device.uniqueID, name: $0.device.localizedName, isDefault: $0.isDefault,
                    formats: CameraTrack.formats(of: $0.device)
                )
            }
        )
    }

    /// Display names by id. NSScreen only covers displays that are on; others fall back to their id.
    @MainActor private static func displayNames() -> [CGDirectDisplayID: String] {
        var names: [CGDirectDisplayID: String] = [:]
        for screen in NSScreen.screens {
            guard
                let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                    as? NSNumber
            else { continue }
            names[number.uint32Value] = screen.localizedName
        }
        return names
    }

    private static func display(_ id: CGDirectDisplayID, name: String?) -> DisplaySource {
        let mode = CGDisplayCopyDisplayMode(id)
        let width = mode?.pixelWidth ?? CGDisplayPixelsWide(id)
        return DisplaySource(
            id: id,
            name: name ?? "Display \(id)",
            width: width,
            height: mode?.pixelHeight ?? CGDisplayPixelsHigh(id),
            scale: mode.map { Double(width) / Double(max($0.width, 1)) } ?? 1,
            isMain: CGDisplayIsMain(id) != 0
        )
    }

    private static func devices(
        types: [AVCaptureDevice.DeviceType], media: AVMediaType
    ) -> [(device: AVCaptureDevice, isDefault: Bool)] {
        let defaultId = AVCaptureDevice.default(for: media)?.uniqueID
        return AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: media, position: .unspecified
        )
        .devices
        .map { ($0, $0.uniqueID == defaultId) }
    }
}
