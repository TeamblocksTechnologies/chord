import Foundation

/// Serializes outgoing messages as JSON lines.
public actor OutputWriter {
    private let handle: FileHandle
    private let encoder: JSONEncoder

    public init(handle: FileHandle = .standardOutput) {
        self.handle = handle
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        self.encoder = encoder
    }

    public func send(_ message: Outgoing) {
        do {
            let data = try encoder.encode(message) + Data("\n".utf8)
            try handle.write(contentsOf: data)
        } catch {
            Log.error("failed to write message: \(error)")
        }
    }
}
