import CoreGraphics
import Foundation
import Testing

@testable import RecorderCore

@Test func modesDecideWhatEachScreenTrackCaptures() {
    let main = CGMainDisplayID()
    let other = main &+ 1
    func target(_ displayId: CGDirectDisplayID, _ subject: ScreenSubject, _ mode: ScreenMode)
        -> ScreenTarget?
    {
        ScreenGroup.target(displayId, for: subject, in: mode)
    }

    #expect(target(main, .mode, .mainDisplay) == .display(area: nil, background: .desktop))
    #expect(target(other, .mode, .mainDisplay) == nil)
    let both = ScreenMode.display(ids: [main, other], background: .transparent)
    #expect(
        target(other, .mode, both)
            == .display(area: nil, background: .transparent, showsSystemUI: false))
    #expect(target(main, .area(1), both) == nil)

    let size = CGDisplayBounds(main).size
    let areas = ScreenMode.area(
        areas: [
            ScreenArea(displayId: main, x: 10, y: 20, width: 300, height: 200),
            ScreenArea(displayId: other, x: 0, y: 0, width: 100, height: 100),
            // Clipped to the display.
            ScreenArea(displayId: main, x: size.width - 50, y: 0, width: 100, height: 100),
        ], background: .desktop)
    #expect(target(main, .mode, areas) == nil)
    #expect(
        target(main, .area(1), areas)
            == .display(area: CGRect(x: 10, y: 20, width: 300, height: 200), background: .desktop))
    #expect(
        target(main, .area(2), areas)
            == .display(
                area: CGRect(x: size.width - 50, y: 0, width: 50, height: 100), background: .desktop
            ))
    #expect(target(main, .area(3), areas) == nil)

    #expect(target(other, .mode, .focusedWindow(bundleIds: nil)) == .window(bundleIds: nil))
    #expect(target(main, .pinned(7), .mainDisplay) == nil)
    #expect(ScreenTarget.display(area: nil, background: .desktop).isTransparent == false)
    #expect(ScreenTarget.applications(bundleIds: ["a"]).isTransparent)
}

@Test func desktopTransparencyAndSystemUIAreIndependent() throws {
    let main = CGMainDisplayID()
    for background in [ScreenBackground.desktop, .transparent] {
        for showsSystemUI in [false, true] {
            let mode = ScreenMode.display(
                ids: [main], background: background, showsSystemUI: showsSystemUI)
            let target = ScreenGroup.target(main, for: .mode, in: mode)
            #expect(
                target == .display(area: nil, background: background, showsSystemUI: showsSystemUI))
            #expect(target?.isTransparent == (background == .transparent))
            for bundleId in [
                "com.apple.dock", "com.apple.systemuiserver", "com.apple.controlcenter",
            ] {
                #expect(
                    ScreenGroup.shows(
                        bundleId, pid: 123, on: background, showsSystemUI: showsSystemUI,
                        excluded: [], captureChord: true) == showsSystemUI)
            }
            #expect(
                ScreenGroup.shows(
                    "test.app", pid: 123, on: background, showsSystemUI: showsSystemUI,
                    excluded: [], captureChord: true))
            #expect(
                !ScreenGroup.shows(
                    "test.hidden", pid: 123, on: background, showsSystemUI: showsSystemUI,
                    excluded: ["test.hidden"], captureChord: true))
            let data = try JSONEncoder().encode(mode)
            #expect(try JSONDecoder().decode(ScreenMode.self, from: data) == mode)
            let preview = ScreenPreviewRequest(
                id: "test", displayId: main, background: background, showsSystemUI: showsSystemUI)
            #expect(
                try JSONDecoder().decode(
                    ScreenPreviewRequest.self, from: JSONEncoder().encode(preview)) == preview)
        }
    }
    #expect(
        !ScreenGroup.shows(
            "com.apple.wallpaper.agent", pid: 123, on: .transparent, showsSystemUI: true,
            excluded: [], captureChord: true))
    #expect(ScreenPreviewRequest(id: "old", displayId: main, background: .desktop).showsSystemUI)
    #expect(
        !ScreenPreviewRequest(id: "old", displayId: main, background: .transparent).showsSystemUI)
}
