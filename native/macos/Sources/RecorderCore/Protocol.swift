import Foundation

/// Bumped on breaking changes to the wire protocol or `session.json`. Mirrors `PROTOCOL_VERSION` in
/// `packages/recorder-protocol`, which is the source of truth for the contract.
public let protocolVersion = 1

/// JSON-RPC 2.0 over stdio: one message per line. Requests arrive on stdin; responses and notifications
/// leave on stdout. Logs go to stderr only so they never corrupt the protocol stream. Batches are not supported.
/// Display preview frames go to file descriptor 3 (see `FramePipe`).

public enum RequestID: Codable, Sendable, Hashable, ExpressibleByIntegerLiteral,
    ExpressibleByStringLiteral
{
    case number(Int)
    case string(String)

    public init(integerLiteral value: Int) { self = .number(value) }
    public init(stringLiteral value: String) { self = .string(value) }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let number = try? c.decode(Int.self) {
            self = .number(number)
        } else {
            self = .string(try c.decode(String.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .number(let number): try c.encode(number)
        case .string(let string): try c.encode(string)
        }
    }
}

public struct RPCError: Error, Sendable, Equatable {
    public var code: Int
    public var message: String
    /// Machine-readable name, sent as `data.reason`.
    public var reason: String?

    public init(code: Int, message: String, reason: String? = nil) {
        self.code = code
        self.message = message
        self.reason = reason
    }

    public static func parseError(_ message: String) -> RPCError {
        RPCError(code: -32700, message: message)
    }
    public static func invalidRequest(_ message: String) -> RPCError {
        RPCError(code: -32600, message: message)
    }
    public static func methodNotFound(_ method: String) -> RPCError {
        RPCError(code: -32601, message: "method not found: \(method)")
    }
    public static func invalidParams(_ message: String) -> RPCError {
        RPCError(code: -32602, message: message)
    }
    public static func internalError(_ message: String) -> RPCError {
        RPCError(code: -32603, message: message)
    }
}

public enum Command: Sendable, Equatable {
    case ping
    case shutdown
    case getPermissions
    case requestPermission(PermissionKind)
    case listSources
    case warmUp(SessionUpdate)
    case startSession(SessionConfig)
    case stopSession
    case pauseSession
    case resumeSession
    case setScreenMode(ScreenMode)
    case setPinnedWindows([UInt32])
    case updateSession(SessionUpdate)
    case addMark(kind: String, note: String?)
    case setMetering(enabled: Bool)
    case setAudioPreview([AudioSource])
    case setScreenPreview([ScreenPreviewRequest])
    case setWindowPreview(WindowPreviewConfig)
    case setMouseWatch(enabled: Bool)
    case setKeyWatch(enabled: Bool)
}

public struct Request: Decodable, Sendable, Equatable {
    /// `nil` for notifications, which get no response.
    public var id: RequestID?
    public var command: Command

    private enum CodingKeys: String, CodingKey { case jsonrpc, id, method, params }
    private struct PermissionParams: Decodable { var permission: PermissionKind }
    private struct MarkParams: Decodable {
        var kind: String?
        var note: String?
    }
    private struct MeteringParams: Decodable { var enabled: Bool }
    private struct ScreenModeParams: Decodable { var mode: ScreenMode }
    private struct PinnedWindowsParams: Decodable { var windowIds: [UInt32] }
    private struct AudioPreviewParams: Decodable { var sources: [AudioSource] }
    private struct ScreenPreviewParams: Decodable { var previews: [ScreenPreviewRequest] }

    public init(id: RequestID?, command: Command) {
        self.id = id
        self.command = command
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard (try? c.decode(String.self, forKey: .jsonrpc)) == "2.0" else {
            throw RPCError.invalidRequest(#"jsonrpc must be "2.0""#)
        }
        guard let method = try? c.decode(String.self, forKey: .method) else {
            throw RPCError.invalidRequest("method must be a string")
        }
        do {
            id = try c.decodeIfPresent(RequestID.self, forKey: .id)
        } catch {
            throw RPCError.invalidRequest("id must be a string or integer")
        }

        func params<T: Decodable>(_ type: T.Type) throws -> T {
            do { return try c.decode(T.self, forKey: .params) } catch {
                throw RPCError.invalidParams(describe(error))
            }
        }
        func optionalParams<T: Decodable>(_ type: T.Type) throws -> T? {
            do { return try c.decodeIfPresent(T.self, forKey: .params) } catch {
                throw RPCError.invalidParams(describe(error))
            }
        }

        switch method {
        case "ping": command = .ping
        case "shutdown": command = .shutdown
        case "getPermissions": command = .getPermissions
        case "requestPermission":
            command = .requestPermission(try params(PermissionParams.self).permission)
        case "listSources": command = .listSources
        case "warmUp": command = .warmUp(try params(SessionUpdate.self))
        case "startSession": command = .startSession(try params(SessionConfig.self))
        case "stopSession": command = .stopSession
        case "pauseSession": command = .pauseSession
        case "resumeSession": command = .resumeSession
        case "setScreenMode": command = .setScreenMode(try params(ScreenModeParams.self).mode)
        case "setPinnedWindows":
            command = .setPinnedWindows(try params(PinnedWindowsParams.self).windowIds)
        case "updateSession": command = .updateSession(try params(SessionUpdate.self))
        case "addMark":
            let mark = try optionalParams(MarkParams.self)
            command = .addMark(kind: mark?.kind ?? "mark", note: mark?.note)
        case "setMetering": command = .setMetering(enabled: try params(MeteringParams.self).enabled)
        case "setAudioPreview":
            command = .setAudioPreview(try params(AudioPreviewParams.self).sources)
        case "setScreenPreview":
            command = .setScreenPreview(try params(ScreenPreviewParams.self).previews)
        case "setWindowPreview": command = .setWindowPreview(try params(WindowPreviewConfig.self))
        case "setMouseWatch":
            command = .setMouseWatch(enabled: try params(MeteringParams.self).enabled)
        case "setKeyWatch": command = .setKeyWatch(enabled: try params(MeteringParams.self).enabled)
        default:
            throw RPCError.methodNotFound(method)
        }
    }
}

public struct RequestFailure: Error, Sendable, Equatable {
    public var id: RequestID?
    /// Errors in notifications are logged, not answered.
    public var isNotification: Bool
    public var error: RPCError
}

extension Request {
    private struct Probe: Decodable {
        var id: RequestID?
        var method: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try? c.decodeIfPresent(RequestID.self, forKey: .id)
            method = try? c.decodeIfPresent(String.self, forKey: .method)
        }
    }

    public static func parse(_ line: String) -> Result<Request, RequestFailure> {
        let data = Data(line.utf8)
        guard (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) != nil
        else {
            return .failure(
                RequestFailure(id: nil, isNotification: false, error: .parseError("invalid JSON")))
        }
        do {
            return .success(try JSONDecoder().decode(Request.self, from: data))
        } catch {
            let probe = try? JSONDecoder().decode(Probe.self, from: data)
            let rpcError = error as? RPCError ?? .invalidRequest("request must be a JSON object")
            let isNotification = probe?.method != nil && probe?.id == nil && rpcError.code != -32600
            return .failure(
                RequestFailure(id: probe?.id, isNotification: isNotification, error: rpcError))
        }
    }
}

/// Readable decoding errors, e.g. "params.screen.quality.fps: expected Int".
func describe(_ error: Error) -> String {
    func path(_ keys: [CodingKey]) -> String {
        keys.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
    }
    switch error as? DecodingError {
    case .keyNotFound(let key, let context)?:
        return "\(path(context.codingPath + [key])) is required"
    case .typeMismatch(let type, let context)?:
        return "\(path(context.codingPath)): expected \(type)"
    case .valueNotFound(let type, let context)?:
        return "\(path(context.codingPath)): expected \(type)"
    case .dataCorrupted(let context)?:
        return "\(path(context.codingPath)): \(context.debugDescription)"
    default:
        return "\(error)"
    }
}

public enum ResponseResult: Sendable, Equatable {
    case none
    case permissions(Permissions)
    case sources(SourceList)
    case session(SessionInfo)
    case mark(Mark)
    case audioPreview(failures: [AudioSourceFailure])
    case screenPreview(failures: [ScreenPreviewFailure])
    case previewWindow(PreviewWindow?)
}

/// Sent as JSON-RPC notifications; the case name is the method.
public enum Event: Sendable, Equatable {
    case ready(version: String)
    case sessionState(SessionInfo)
    case segmentStarted(trackId: String, file: String, start: Double)
    case segmentEnded(trackId: String, file: String, end: Double, reason: SegmentEndReason)
    case levels([TrackLevel])
    case trackError(trackId: String, message: String)
    case devicesChanged
    case previewLevels([AudioSourceLevel])
    case previewWindow(PreviewWindow?)
    case mouseButton(down: Bool)
    /// A key went down, with the modifiers held at the time.
    case keyPress(keyCode: Int, modifiers: [String])
}

public enum Outgoing: Encodable, Sendable, Equatable {
    case response(id: RequestID, result: ResponseResult = .none)
    /// `id` is nil when the request's id couldn't be read.
    case error(id: RequestID?, RPCError)
    case event(Event)

    private enum CodingKeys: String, CodingKey { case jsonrpc, id, result, error, method, params }
    private enum ErrorKeys: String, CodingKey { case code, message, data }

    private struct Ready: Encodable {
        var version: String
        var protocolVersion: Int
    }
    private struct SegmentStarted: Encodable {
        var trackId: String
        var file: String
        var start: Double
    }
    private struct SegmentEnded: Encodable {
        var trackId: String
        var file: String
        var end: Double
        var reason: SegmentEndReason
    }
    private struct Levels: Encodable { var levels: [TrackLevel] }
    private struct PreviewLevels: Encodable { var levels: [AudioSourceLevel] }
    private struct AudioPreviewResult: Encodable { var failures: [AudioSourceFailure] }
    private struct ScreenPreviewResult: Encodable { var failures: [ScreenPreviewFailure] }
    /// `{"window": null}` when there's none, rather than omitting the key.
    private struct WindowResult: Encodable {
        var window: PreviewWindow?
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(window, forKey: .window)
        }
        private enum CodingKeys: String, CodingKey { case window }
    }
    private struct MouseButton: Encodable { var down: Bool }
    private struct KeyPress: Encodable {
        var keyCode: Int
        var modifiers: [String]
    }
    private struct TrackError: Encodable {
        var trackId: String
        var message: String
    }
    private struct ErrorData: Encodable { var reason: String }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("2.0", forKey: .jsonrpc)
        switch self {
        case .response(let id, let result):
            try c.encode(id, forKey: .id)
            switch result {
            case .none: try c.encodeNil(forKey: .result)
            case .permissions(let value): try c.encode(value, forKey: .result)
            case .sources(let value): try c.encode(value, forKey: .result)
            case .session(let value): try c.encode(value, forKey: .result)
            case .mark(let value): try c.encode(value, forKey: .result)
            case .audioPreview(let failures):
                try c.encode(AudioPreviewResult(failures: failures), forKey: .result)
            case .screenPreview(let failures):
                try c.encode(ScreenPreviewResult(failures: failures), forKey: .result)
            case .previewWindow(let window):
                try c.encode(WindowResult(window: window), forKey: .result)
            }
        case .error(let id, let error):
            if let id { try c.encode(id, forKey: .id) } else { try c.encodeNil(forKey: .id) }
            var e = c.nestedContainer(keyedBy: ErrorKeys.self, forKey: .error)
            try e.encode(error.code, forKey: .code)
            try e.encode(error.message, forKey: .message)
            try e.encodeIfPresent(error.reason.map(ErrorData.init), forKey: .data)
        case .event(let event):
            switch event {
            case .ready(let version):
                try c.encode("ready", forKey: .method)
                try c.encode(
                    Ready(version: version, protocolVersion: protocolVersion), forKey: .params)
            case .sessionState(let info):
                try c.encode("sessionState", forKey: .method)
                try c.encode(info, forKey: .params)
            case .segmentStarted(let trackId, let file, let start):
                try c.encode("segmentStarted", forKey: .method)
                try c.encode(
                    SegmentStarted(trackId: trackId, file: file, start: start), forKey: .params)
            case .segmentEnded(let trackId, let file, let end, let reason):
                try c.encode("segmentEnded", forKey: .method)
                try c.encode(
                    SegmentEnded(trackId: trackId, file: file, end: end, reason: reason),
                    forKey: .params)
            case .levels(let levels):
                try c.encode("levels", forKey: .method)
                try c.encode(Levels(levels: levels), forKey: .params)
            case .trackError(let trackId, let message):
                try c.encode("trackError", forKey: .method)
                try c.encode(TrackError(trackId: trackId, message: message), forKey: .params)
            case .devicesChanged:
                try c.encode("devicesChanged", forKey: .method)
            case .previewLevels(let levels):
                try c.encode("previewLevels", forKey: .method)
                try c.encode(PreviewLevels(levels: levels), forKey: .params)
            case .previewWindow(let window):
                try c.encode("previewWindow", forKey: .method)
                try c.encode(WindowResult(window: window), forKey: .params)
            case .mouseButton(let down):
                try c.encode("mouseButton", forKey: .method)
                try c.encode(MouseButton(down: down), forKey: .params)
            case .keyPress(let keyCode, let modifiers):
                try c.encode("keyPress", forKey: .method)
                try c.encode(KeyPress(keyCode: keyCode, modifiers: modifiers), forKey: .params)
            }
        }
    }
}
