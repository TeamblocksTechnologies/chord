import Foundation
import Testing

@testable import RecorderCore

private func parse(_ json: String) -> Result<Request, RequestFailure> {
    Request.parse(json)
}

private func encode(_ message: Outgoing) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(message), as: UTF8.self)
}

@Test func startSessionFillsDefaults() throws {
    let request = try parse(
        #"{"jsonrpc":"2.0","id":1,"method":"startSession","params":{"outputDirectory":"/tmp","screen":{}}}"#
    ).get()
    #expect(request.id == 1)
    #expect(
        request.command
            == .startSession(SessionConfig(outputDirectory: "/tmp", screen: ScreenConfig())))
}

@Test func decodesCameraAndScreenQuality() throws {
    let request = try parse(
        #"""
        {"jsonrpc":"2.0","id":1,"method":"startSession","params":{"outputDirectory":"/tmp",
        "screen":{"quality":{"fps":60,"hdr":true}},
        "cameras":[{"deviceId":"a"},{"deviceId":"b","format":{"width":1920,"height":1080},"fps":60,"bitrate":9000000}]}}
        """#.replacingOccurrences(of: "\n", with: "")
    ).get()
    #expect(
        request.command
            == .startSession(
                SessionConfig(
                    outputDirectory: "/tmp",
                    screen: ScreenConfig(quality: VideoQuality(fps: 60, hdr: true)),
                    cameras: [
                        CameraConfig(deviceId: "a"),
                        CameraConfig(
                            deviceId: "b", format: .init(width: 1920, height: 1080), fps: 60,
                            bitrate: 9_000_000),
                    ]
                )))
}

@Test func decodesScreenModes() throws {
    func mode(_ json: String) throws -> ScreenMode {
        try JSONDecoder().decode(ScreenMode.self, from: Data(json.utf8))
    }
    #expect(try mode(#"{"type":"display"}"#) == .mainDisplay)
    #expect(
        try mode(#"{"type":"display","displayIds":[1,2],"background":"transparent"}"#)
            == .display(ids: [1, 2], background: .transparent)
    )
    #expect(
        try mode(
            #"{"type":"area","areas":[{"displayId":2,"x":10,"y":20,"width":640,"height":360}]}"#)
            == .area(
                areas: [ScreenArea(displayId: 2, x: 10, y: 20, width: 640, height: 360)],
                background: .desktop)
    )
    #expect(throws: DecodingError.self) { try mode(#"{"type":"area"}"#) }
    #expect(throws: DecodingError.self) { try mode(#"{"type":"display","background":"blurred"}"#) }
    #expect(
        try mode(#"{"type":"applications","bundleIds":["com.apple.Notes"],"displayId":2}"#)
            == .applications(bundleIds: ["com.apple.Notes"], displayId: 2)
    )
    #expect(try mode(#"{"type":"focusedWindow"}"#) == .focusedWindow(bundleIds: nil))
    #expect(
        try mode(#"{"type":"focusedWindow","bundleIds":["a"]}"#) == .focusedWindow(bundleIds: ["a"])
    )
    #expect(throws: DecodingError.self) { try mode(#"{"type":"applications"}"#) }
    #expect(throws: DecodingError.self) { try mode(#"{"type":"region"}"#) }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let encoded = try encoder.encode(ScreenMode.applications(bundleIds: ["a"], displayId: nil))
    #expect(
        String(decoding: encoded, as: UTF8.self) == #"{"bundleIds":["a"],"type":"applications"}"#)
    #expect(
        String(decoding: try encoder.encode(ScreenMode.mainDisplay), as: UTF8.self)
            == #"{"type":"display"}"#)
    let transparent = ScreenMode.display(ids: [3], background: .transparent)
    #expect(
        try JSONDecoder().decode(ScreenMode.self, from: encoder.encode(transparent)) == transparent)
}

@Test func decodesPinnedWindows() throws {
    let start = try parse(
        #"{"jsonrpc":"2.0","id":1,"method":"startSession","params":{"outputDirectory":"/tmp","screen":{"pinnedWindowIds":[7,9]}}}"#
    ).get()
    #expect(
        start.command
            == .startSession(
                SessionConfig(
                    outputDirectory: "/tmp", screen: ScreenConfig(pinnedWindowIds: [7, 9])
                )))
    let set = try parse(
        #"{"jsonrpc":"2.0","id":2,"method":"setPinnedWindows","params":{"windowIds":[]}}"#
    ).get()
    #expect(set.command == .setPinnedWindows([]))
    guard
        case .failure(let failure) = parse(
            #"{"jsonrpc":"2.0","id":3,"method":"setPinnedWindows","params":{}}"#)
    else {
        Issue.record("expected a failure")
        return
    }
    #expect(failure.error == .invalidParams("params.windowIds is required"))
}

@Test func decodesUpdateSession() throws {
    let update = try parse(
        #"{"jsonrpc":"2.0","id":1,"method":"updateSession","params":{"microphones":[{"deviceId":"a"}],"systemAudio":true}}"#
    ).get()
    #expect(
        update.command
            == .updateSession(
                SessionUpdate(
                    microphones: [MicrophoneConfig(deviceId: "a")], systemAudio: true
                )))
    let empty = try parse(#"{"jsonrpc":"2.0","id":2,"method":"updateSession","params":{}}"#).get()
    #expect(empty.command == .updateSession(SessionUpdate()))
}

@Test func acceptsStringIdsAndNotifications() throws {
    #expect(try parse(#"{"jsonrpc":"2.0","id":"a","method":"ping"}"#).get().id == "a")
    #expect(
        try parse(#"{"jsonrpc":"2.0","method":"addMark"}"#).get()
            == Request(id: nil, command: .addMark(kind: "mark", note: nil)))
}

@Test func classifiesFailures() {
    func failure(_ json: String) -> RequestFailure? {
        if case .failure(let failure) = parse(json) { failure } else { nil }
    }
    #expect(failure("nope")?.error.code == -32700)
    #expect(failure(#"{"id":1,"method":"ping"}"#)?.error.code == -32600)
    #expect(failure(#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#)?.error.code == -32600)
    #expect(
        failure(#"{"jsonrpc":"2.0","id":2,"method":"nope"}"#)
            == RequestFailure(id: 2, isNotification: false, error: .methodNotFound("nope")))
    #expect(failure(#"{"jsonrpc":"2.0","method":"nope"}"#)?.isNotification == true)
    #expect(
        failure(#"{"jsonrpc":"2.0","id":3,"method":"startSession","params":{"screen":{}}}"#)?.error
            == .invalidParams("params.outputDirectory is required")
    )
}

@Test func encodesNotifications() throws {
    let json = try encode(
        .event(.segmentStarted(trackId: "mic-1", file: "mic-1-001.m4a", start: 0.5)))
    #expect(
        json
            == #"{"jsonrpc":"2.0","method":"segmentStarted","params":{"file":"mic-1-001.m4a","start":0.5,"trackId":"mic-1"}}"#
    )
    #expect(try encode(.event(.devicesChanged)) == #"{"jsonrpc":"2.0","method":"devicesChanged"}"#)
}

@Test func decodesSetMetering() throws {
    let request = try parse(
        #"{"jsonrpc":"2.0","id":1,"method":"setMetering","params":{"enabled":true}}"#
    ).get()
    #expect(request.command == .setMetering(enabled: true))
}

@Test func encodesBatchedLevels() throws {
    let json = try encode(
        .event(
            .levels([
                TrackLevel(trackId: "mic-1", averageDb: -30, peakDb: -12),
                TrackLevel(trackId: "mic-2", averageDb: -40, peakDb: -20),
            ])))
    #expect(
        json
            == #"{"jsonrpc":"2.0","method":"levels","params":{"levels":[{"averageDb":-30,"peakDb":-12,"trackId":"mic-1"},{"averageDb":-40,"peakDb":-20,"trackId":"mic-2"}]}}"#
    )
}

@Test func clampsLevels() {
    #expect(
        TrackLevel(trackId: "a", averageDb: -.infinity, peakDb: .nan)
            == TrackLevel(trackId: "a", averageDb: -160, peakDb: -160))
    #expect(TrackLevel(trackId: "a", averageDb: -758, peakDb: 3).peakDb == 0)
}

@Test func readyIncludesProtocolVersion() throws {
    #expect(
        try encode(.event(.ready(version: "1.2.3")))
            == #"{"jsonrpc":"2.0","method":"ready","params":{"protocolVersion":1,"version":"1.2.3"}}"#
    )
}

@Test func encodesResponsesAndErrors() throws {
    #expect(try encode(.response(id: 1)) == #"{"id":1,"jsonrpc":"2.0","result":null}"#)
    #expect(
        try encode(.error(id: "x", HelperError(.noSession, "no session").rpcError))
            == #"{"error":{"code":-32002,"data":{"reason":"no_session"},"message":"no session"},"id":"x","jsonrpc":"2.0"}"#
    )
    #expect(
        try encode(.error(id: nil, .parseError("invalid JSON")))
            == #"{"error":{"code":-32700,"message":"invalid JSON"},"id":null,"jsonrpc":"2.0"}"#
    )
}

@Test func audioSourcesRoundTrip() throws {
    let request = try parse(
        #"{"jsonrpc":"2.0","id":1,"method":"setAudioPreview","params":{"sources":[{"kind":"microphone","deviceId":"m"},{"kind":"systemAudio"}]}}"#
    ).get()
    #expect(request.command == .setAudioPreview([.microphone(deviceId: "m"), .systemAudio]))
    #expect(
        try encode(
            .event(
                .previewLevels([
                    AudioSourceLevel(source: .systemAudio, averageDb: -.infinity, peakDb: -6)
                ])))
            == #"{"jsonrpc":"2.0","method":"previewLevels","params":{"levels":[{"averageDb":-160,"peakDb":-6,"source":{"kind":"systemAudio"}}]}}"#
    )
    if case .failure(let failure) = parse(
        #"{"jsonrpc":"2.0","id":2,"method":"setAudioPreview","params":{"sources":[{"kind":"speaker"}]}}"#
    ) {
        #expect(failure.error.code == -32602)
    } else {
        Issue.record("expected unknown kinds to be rejected")
    }
}

@Test func screenPreviewsRoundTrip() throws {
    let request = try parse(
        #"{"jsonrpc":"2.0","id":1,"method":"setScreenPreview","params":{"previews":[{"id":"a","displayId":1},{"id":"b","displayId":2,"background":"transparent","excludedBundleIds":["x"],"showsCursor":false}]}}"#
    ).get()
    #expect(
        request.command
            == .setScreenPreview([
                ScreenPreviewRequest(id: "a", displayId: 1),
                ScreenPreviewRequest(
                    id: "b", displayId: 2, background: .transparent, excludedBundleIds: ["x"],
                    showsCursor: false),
            ]))
    #expect(
        try encode(
            .response(
                id: 1,
                result: .screenPreview(failures: [ScreenPreviewFailure(id: "a", message: "gone")])))
            == #"{"id":1,"jsonrpc":"2.0","result":{"failures":[{"id":"a","message":"gone"}]}}"#
    )
}

@Test func previewWindowEncodesNullExplicitly() throws {
    #expect(
        try encode(.response(id: 1, result: .previewWindow(nil)))
            == #"{"id":1,"jsonrpc":"2.0","result":{"window":null}}"#)
    #expect(
        try encode(.event(.previewWindow(PreviewWindow(id: 3, bundleId: "a", appName: "A"))))
            == #"{"jsonrpc":"2.0","method":"previewWindow","params":{"window":{"appName":"A","bundleId":"a","id":3}}}"#
    )
}

@Test func mouseButtonEncodesItsState() throws {
    #expect(
        try encode(.event(.mouseButton(down: true)))
            == #"{"jsonrpc":"2.0","method":"mouseButton","params":{"down":true}}"#)
}

@Test func keyPressEncodesTheKeyAndModifiers() throws {
    #expect(
        try encode(.event(.keyPress(keyCode: 8, modifiers: ["command", "shift"])))
            == #"{"jsonrpc":"2.0","method":"keyPress","params":{"keyCode":8,"modifiers":["command","shift"]}}"#
    )
}
