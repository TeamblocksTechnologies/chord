import Foundation
import os

public enum Log {
    private static let logger = Logger(
        subsystem: "dev.teamblocks.chord.recorder-helper", category: "helper")

    public static func info(_ message: String) {
        logger.info("\(message, privacy: .public)")
        write("INFO \(message)")
    }

    public static func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
        write("ERROR \(message)")
    }

    private static func write(_ line: String) {
        try? FileHandle.standardError.write(contentsOf: Data((line + "\n").utf8))
    }
}
