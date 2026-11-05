import Foundation
import RecorderCore

// `--permissions` prints the permissions as a newly started process sees them, then exits. One that's running can
// keep seeing a permission allowed in System Settings since it started as denied, or be unable to use it.
if CommandLine.arguments.contains("--permissions") {
    let data = try JSONEncoder().encode(PermissionCenter.current())
    FileHandle.standardOutput.write(data + Data("\n".utf8))
    exit(0)
}

// Before anything polls the cursor, so its shapes can be matched to the standard ones.
MainActor.assumeIsolated { StandardCursors.prepare() }

let writer = OutputWriter()
let helper = Helper(send: { await writer.send($0) }, frames: FramePipe())

// Exit when stdin closes (Electron quit/crashed), on a shutdown command, or on SIGTERM/SIGINT.
// Either way the active session is finalized first.
Task {
    await withTaskGroup(of: Void.self) { group in
        group.addTask {
            await helper.run(lines: FileHandle.standardInput.bytes.lines)
        }
        group.addTask {
            for await sig in Signals.stream(for: [SIGTERM, SIGINT]) {
                Log.info("received signal \(sig)")
                await helper.shutdown()
                return
            }
        }
        await group.next()
        exit(0)
    }
}

// AVFoundation device notifications need a running main run loop.
RunLoop.main.run()
