import AppKit
import os

/// The system cursor's shape, as a session's input recorder polls it.
public struct CursorShape: Sendable {
    /// The same for the same image and hotspot, so a shape is written once and changes are noticed.
    public var id: String
    /// Set when it's exactly one of AppKit's standard cursors. See `CursorKind` in the protocol.
    public var kind: String?
    /// In points from the image's top left.
    public var hotspot: CGPoint
    /// In points on screen.
    public var size: CGSize
    /// The image as PNG, at its largest resolution. Only read for shapes not yet written.
    public var png: @Sendable () -> Data?

    public init(
        id: String, kind: String? = nil, hotspot: CGPoint, size: CGSize,
        png: @escaping @Sendable () -> Data? = { nil }
    ) {
        self.id = id
        self.kind = kind
        self.hotspot = hotspot
        self.size = size
        self.png = png
    }
}

extension CursorShape: Equatable {
    public static func == (a: CursorShape, b: CursorShape) -> Bool {
        a.id == b.id && a.kind == b.kind && a.hotspot == b.hotspot && a.size == b.size
    }
}

/// The cursor showing anywhere on screen. Nil when it can't be read.
public let liveCursorShape: @Sendable () -> CursorShape? = {
    guard let cursor = NSCursor.currentSystem else { return nil }
    return StandardCursors.shape(of: cursor)
}

/// Recognises AppKit's standard cursors exactly, by their pixels and hotspot: never by resemblance. AppKit only loads
/// some of them once the app is set up on the main thread, so `prepare` must run there first; until it does, no shape
/// has a `kind`.
public enum StandardCursors {
    private static let kinds = OSAllocatedUnfairLock(initialState: [String: String]())

    /// Sets AppKit up without a Dock icon, and notes the standard cursors.
    @MainActor public static func prepare() {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let cursors: [(String, NSCursor)] = [
            ("arrow", .arrow), ("iBeam", .iBeam), ("iBeamVertical", .iBeamCursorForVerticalLayout),
            ("pointingHand", .pointingHand), ("openHand", .openHand), ("closedHand", .closedHand),
            ("crosshair", .crosshair), ("notAllowed", .operationNotAllowed),
            ("contextualMenu", .contextualMenu),
            ("dragCopy", .dragCopy), ("dragLink", .dragLink),
            ("disappearingItem", .disappearingItem),
            ("resizeLeftRight", .resizeLeftRight), ("resizeUpDown", .resizeUpDown),
        ]
        var found: [String: String] = [:]
        for (kind, cursor) in cursors {
            // Several look alike; the first listed wins.
            if let id = identity(of: cursor), found[id] == nil { found[id] = kind }
        }
        let noted = found
        kinds.withLock { $0 = noted }
        Log.info("cursor: \(found.count) standard cursors noted")
    }

    static func shape(of cursor: NSCursor) -> CursorShape? {
        guard let id = identity(of: cursor) else { return nil }
        let image = UncheckedImage(image: cursor.image)
        return CursorShape(
            id: id, kind: kinds.withLock { $0[id] }, hotspot: cursor.hotSpot,
            size: cursor.image.size,
            png: { image.png() }
        )
    }

    /// A hash of the image's smallest representation, drawn into a fixed pixel format, and the hotspot.
    static func identity(of cursor: NSCursor) -> String? {
        let image = cursor.image
        guard image.size.width > 0, image.size.height > 0,
            let rep = image.representations.min(by: { $0.pixelsWide < $1.pixelsWide }),
            rep.pixelsWide > 0, rep.pixelsHigh > 0
        else { return nil }
        let (width, height) = (rep.pixelsWide, rep.pixelsHigh)
        var proposed = CGRect(x: 0, y: 0, width: width, height: height)
        guard let cg = rep.cgImage(forProposedRect: &proposed, context: nil, hints: nil),
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ),
            let data = context.data
        else { return nil }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        var hash = Fnv1a()
        hash.add(UnsafeRawBufferPointer(start: data, count: width * height * 4))
        for value in [image.size.width, image.size.height, cursor.hotSpot.x, cursor.hotSpot.y] {
            withUnsafeBytes(of: value) { hash.add($0) }
        }
        return String(hash.value, radix: 16)
    }
}

/// A cursor's image, read off the main thread only to encode it once.
private struct UncheckedImage: @unchecked Sendable {
    let image: NSImage

    func png() -> Data? {
        let largest = image.representations.max(by: { $0.pixelsWide < $1.pixelsWide })
        if let bitmap = largest as? NSBitmapImageRep,
            let png = bitmap.representation(using: .png, properties: [:])
        {
            return png
        }
        // Not a bitmap (a PDF, say): draw it at 4x.
        let (width, height) = (Int(image.size.width * 4), Int(image.size.height * 4))
        guard width > 0, height > 0,
            let bitmap = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
                samplesPerPixel: 4,
                hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
                bitsPerPixel: 0
            )
        else { return nil }
        bitmap.size = image.size
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: CGRect(origin: .zero, size: image.size))
        return bitmap.representation(using: .png, properties: [:])
    }
}

private struct Fnv1a {
    var value: UInt64 = 0xcbf2_9ce4_8422_2325

    mutating func add(_ bytes: UnsafeRawBufferPointer) {
        for byte in bytes {
            value ^= UInt64(byte)
            value = value &* 0x100_0000_01b3
        }
    }
}
