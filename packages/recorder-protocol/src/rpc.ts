/**
 * Framing: JSON-RPC 2.0 over the helper's stdin/stdout, one message per line. Helpers log to stderr only.
 * Batches are not supported.
 */

/** Bumped on breaking changes to the wire protocol or `session.json`. Sent in the `ready` notification. */
export const PROTOCOL_VERSION = 1;

export type RequestId = number | string;

export interface RpcRequest<Method extends string = string, Params = unknown> {
  jsonrpc: "2.0";
  /** Omit to send a notification: the helper runs it and sends no reply, even on failure. */
  id?: RequestId;
  method: Method;
  params?: Params;
}

export interface RpcSuccess<Result = unknown> {
  jsonrpc: "2.0";
  id: RequestId;
  result: Result;
}

export interface RpcFailure {
  jsonrpc: "2.0";
  /** `null` when the request's id couldn't be read. */
  id: RequestId | null;
  error: RpcError;
}

export interface RpcNotification<Method extends string = string, Params = unknown> {
  jsonrpc: "2.0";
  method: Method;
  params?: Params;
}

export interface RpcError {
  code: number;
  message: string;
  /** Present on helper-specific errors. */
  data?: { reason: ErrorReason };
}

/** Standard JSON-RPC error codes. */
export const RpcErrorCode = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** Helper-specific errors, in the range JSON-RPC reserves for implementations. */
export const ErrorReasonCode = {
  /** `startSession` while a session is recording or paused. */
  session_active: -32001,
  /** A session method with no session in progress. */
  no_session: -32002,
  /** e.g. `pauseSession` while already paused. */
  invalid_state: -32003,
  /** The config records nothing, or is otherwise unusable. */
  invalid_config: -32004,
  /** A track failed to start; the session was discarded. */
  start_failed: -32005,
  device_unavailable: -32006,
  display_unavailable: -32007,
  /** No window the `focusedWindow` screen mode may record is on screen. */
  window_unavailable: -32008,
} as const;

export type ErrorReason = keyof typeof ErrorReasonCode;
