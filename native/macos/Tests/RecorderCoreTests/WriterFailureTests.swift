import AVFoundation
import Testing

@testable import RecorderCore

@Test func detectsDiskFullErrors() {
    let posix = NSError(domain: NSPOSIXErrorDomain, code: Int(ENOSPC))
    let wrapped = NSError(
        domain: AVFoundationErrorDomain, code: -11800, userInfo: [NSUnderlyingErrorKey: posix])
    #expect(WriterFailure.isDiskFull(wrapped))
    #expect(
        WriterFailure.isDiskFull(
            NSError(domain: AVFoundationErrorDomain, code: AVError.Code.diskFull.rawValue)))
    #expect(
        WriterFailure.isDiskFull(
            NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)))
    #expect(!WriterFailure.isDiskFull(NSError(domain: AVFoundationErrorDomain, code: -11800)))
    #expect(!WriterFailure(nil, context: "no error").isDiskFull)
}
