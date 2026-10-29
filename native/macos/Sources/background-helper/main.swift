import AVFoundation
import CoreImage
import Foundation

// A bounded, one-frame-at-a-time bridge between AVFoundation and local ONNX inference.
// info <source> prints JSON. mask <source> <output.mp4> <width> <height> emits a 12-byte
// little-endian header (Double source time, UInt32 byte count) followed by BGRA pixels;
// stdin replies with width*height foreground alpha bytes. A zero byte count ends frames.
// The mask video keeps the source's frame timestamps and duration. Originals are never rewritten.

func fail(_ error: Error) -> Never {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}

struct ProcessingError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw ProcessingError(message: message) }
}

func buffer(width: Int, height: Int) throws -> CVPixelBuffer {
    var result: CVPixelBuffer?
    let code = CVPixelBufferCreate(
        kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &result)
    guard code == kCVReturnSuccess, let result else {
        throw ProcessingError(message: "Could not allocate video frame")
    }
    return result
}

func header(time: Double, count: UInt32) throws {
    var data = Data()
    var bits = time.bitPattern.littleEndian
    var size = count.littleEndian
    withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: &size) { data.append(contentsOf: $0) }
    try FileHandle.standardOutput.write(contentsOf: data)
}

func readMask(count: Int) throws -> Data {
    var result = Data()
    while result.count < count {
        guard let chunk = try FileHandle.standardInput.read(upToCount: count - result.count),
            !chunk.isEmpty
        else {
            throw ProcessingError(message: "Background processing was cancelled")
        }
        result.append(chunk)
    }
    return result
}

func process(source: URL, output: URL, width: Int, height: Int) async throws {
    try check(
        width >= 32 && height >= 32 && width <= 2048 && height <= 2048 && width % 2 == 0
            && height % 2 == 0, "Invalid mask dimensions")
    let asset = AVURLAsset(url: source)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
        throw ProcessingError(message: "This camera segment has no video")
    }
    let transform = try await track.load(.preferredTransform)
    let duration = try await asset.load(.duration)
    let reader = try AVAssetReader(asset: asset)
    let decoded = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    decoded.alwaysCopiesSampleData = false
    reader.add(decoded)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    let input = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: width * height * 8, AVVideoMaxKeyFrameIntervalKey: 30,
            ],
        ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
        ])
    try check(writer.canAdd(input), "Could not encode foreground masks")
    writer.add(input)
    try check(
        writer.startWriting(), writer.error?.localizedDescription ?? "Could not start mask video")
    writer.startSession(atSourceTime: .zero)
    try check(
        reader.startReading(), reader.error?.localizedDescription ?? "Could not read camera video")
    let context = CIContext(options: [.cacheIntermediates: false])
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let scaled = try buffer(width: width, height: height)
    var first: CMTime?
    var frames = 0
    do {
        while let sample = decoded.copyNextSampleBuffer() {
            let (frame, local) = try autoreleasepool {
                guard let image = sample.imageBuffer else {
                    throw ProcessingError(message: "Could not decode camera frame")
                }
                let timestamp = sample.presentationTimeStamp
                if first == nil { first = timestamp }
                let local = timestamp - first!
                let oriented = CIImage(cvPixelBuffer: image).transformed(by: transform)
                let translated = oriented.transformed(
                    by: CGAffineTransform(
                        translationX: -oriented.extent.minX, y: -oriented.extent.minY))
                let resized = translated.transformed(
                    by: CGAffineTransform(
                        scaleX: Double(width) / translated.extent.width,
                        y: Double(height) / translated.extent.height))
                context.render(
                    resized, to: scaled, bounds: CGRect(x: 0, y: 0, width: width, height: height),
                    colorSpace: colorSpace)
                CVPixelBufferLockBaseAddress(scaled, .readOnly)
                let base = CVPixelBufferGetBaseAddress(scaled)!
                let stride = CVPixelBufferGetBytesPerRow(scaled)
                var pixels = Data(capacity: width * height * 4)
                for row in 0..<height {
                    pixels.append(
                        base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self),
                        count: width * 4)
                }
                CVPixelBufferUnlockBaseAddress(scaled, .readOnly)
                try header(time: local.seconds, count: UInt32(pixels.count))
                try FileHandle.standardOutput.write(contentsOf: pixels)
                let mask = try readMask(count: width * height)
                let frame = try buffer(width: width, height: height)
                CVPixelBufferLockBaseAddress(frame, [])
                let destination = CVPixelBufferGetBaseAddress(frame)!.assumingMemoryBound(
                    to: UInt8.self)
                let bytesPerRow = CVPixelBufferGetBytesPerRow(frame)
                mask.withUnsafeBytes { raw in
                    let alpha = raw.bindMemory(to: UInt8.self)
                    for y in 0..<height {
                        for x in 0..<width {
                            let index = y * bytesPerRow + x * 4
                            let value = alpha[y * width + x]
                            destination[index] = value
                            destination[index + 1] = value
                            destination[index + 2] = value
                            destination[index + 3] = 255
                        }
                    }
                }
                CVPixelBufferUnlockBaseAddress(frame, [])
                return (frame, local)
            }
            while !input.isReadyForMoreMediaData {
                try check(
                    writer.status == .writing,
                    writer.error?.localizedDescription ?? "Mask encoder stopped")
                try await Task.sleep(for: .milliseconds(2))
            }
            try check(
                adaptor.append(frame, withPresentationTime: local),
                writer.error?.localizedDescription ?? "Could not write foreground mask")
            frames += 1
        }
        try check(
            reader.status == .completed,
            reader.error?.localizedDescription ?? "Camera video could not be fully decoded")
        try check(frames > 0, "This camera segment has no frames")
        input.markAsFinished()
        writer.endSession(atSourceTime: duration)
        await writer.finishWriting()
        try check(
            writer.status == .completed,
            writer.error?.localizedDescription ?? "Could not finish mask video")
        try header(time: duration.seconds, count: 0)
    } catch {
        reader.cancelReading()
        writer.cancelWriting()
        try? FileManager.default.removeItem(at: output)
        throw error
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
do {
    if arguments.count == 2 && arguments[0] == "info" {
        let asset = AVURLAsset(url: URL(fileURLWithPath: arguments[1]))
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw ProcessingError(message: "This camera segment has no video")
        }
        let size = try await track.load(.naturalSize)
        let transform = try await track.load(.preferredTransform)
        let frame = CGRect(origin: .zero, size: size).applying(transform)
        let duration = try await asset.load(.duration)
        let info = [
            "width": abs(frame.width), "height": abs(frame.height), "duration": duration.seconds,
        ]
        try FileHandle.standardOutput.write(
            contentsOf: JSONSerialization.data(withJSONObject: info))
    } else if arguments.count == 5 && arguments[0] == "mask", let width = Int(arguments[3]),
        let height = Int(arguments[4])
    {
        try await process(
            source: URL(fileURLWithPath: arguments[1]), output: URL(fileURLWithPath: arguments[2]),
            width: width, height: height)
    } else {
        throw ProcessingError(
            message:
                "usage: background-helper info <video> | mask <video> <output.mp4> <width> <height>"
        )
    }
} catch { fail(error) }
