import CoreMedia

/// The shared timeline every track and mark is measured against.
/// ScreenCaptureKit and AVFoundation sample timestamps are in this clock's time base.
public struct HostClock: Sendable {
    public var now: @Sendable () -> Double

    public init(now: @escaping @Sendable () -> Double) {
        self.now = now
    }

    public static let host = HostClock { CMClockGetTime(CMClockGetHostTimeClock()).seconds }
}
