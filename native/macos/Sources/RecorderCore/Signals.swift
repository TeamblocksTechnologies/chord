import Foundation

public enum Signals {
    /// Emits the signal number each time one of `signals` is received.
    public static func stream(for signals: [Int32]) -> AsyncStream<Int32> {
        AsyncStream { continuation in
            let sources = signals.map { sig -> DispatchSourceSignal in
                signal(sig, SIG_IGN)
                let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
                source.setEventHandler { continuation.yield(sig) }
                source.resume()
                return source
            }
            continuation.onTermination = { _ in
                for source in sources {
                    source.cancel()
                }
            }
        }
    }
}
