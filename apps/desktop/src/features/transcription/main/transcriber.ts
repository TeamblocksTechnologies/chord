import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";
import { isTimedText, type TimedText } from "../domain/captions.ts";
import type { AppleSpeech, AppleSpeechAssets } from "./models.ts";

/** CHORD_TRANSCRIBER_HELPER overrides; dev uses the release build from `native/macos/scripts/build.sh`. */
export function transcriberBinary(): string {
  if (process.env.CHORD_TRANSCRIBER_HELPER) return process.env.CHORD_TRANSCRIBER_HELPER;
  if (app.isPackaged) return join(process.resourcesPath, "transcriber-helper");
  return resolve(app.getAppPath(), "../../native/macos/.build/release/transcriber-helper");
}

/**
 * Runs one transcriber helper command. It prints a JSON object per line, which `onLine` sees; the last is the answer.
 * Rejects with what it printed on stderr if it fails.
 */
function run(
  binary: string,
  args: string[],
  onLine?: (line: unknown) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let last: unknown;
    let errors = "";
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        last = JSON.parse(line);
      } catch {
        console.error(`[transcriber-helper] unreadable line: ${line}`);
        return;
      }
      onLine?.(last);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && last !== undefined) resolve(last);
      else reject(new Error(errors.trim() || `transcriber helper exited (${code})`));
    });
  });
}

/** Apple Speech through the transcriber helper; unavailable off macOS. */
export function appleSpeech(binary = transcriberBinary()): AppleSpeech {
  const unavailable: AppleSpeechAssets = {
    status: "unavailable",
    locale: null,
    locales: [],
    system: null,
  };
  const args = (command: string, locale: string | null) => (locale ? [command, locale] : [command]);
  return {
    async assets(locale) {
      if (process.platform !== "darwin") return unavailable;
      return (await run(binary, args("speech-assets", locale))) as AppleSpeechAssets;
    },
    async install(locale, onProgress) {
      if (process.platform !== "darwin") return unavailable;
      return (await run(binary, args("install-speech-assets", locale), (line) => {
        const { progress } = line as { progress?: unknown };
        if (typeof progress === "number") onProgress(progress);
      })) as AppleSpeechAssets;
    },
  };
}

/** A downloaded model to transcribe with: Parakeet from the folder it's in, or Apple Speech in `locale`. */
export type DownloadedModel =
  { id: "apple-speech"; locale: string | null } | { id: "parakeet-tdt-0.6b-v3"; folder: string };

/** Transcribes an audio file, such as a WAV, with `model`. */
export async function transcribe(
  file: string,
  model: DownloadedModel,
  binary = transcriberBinary(),
): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Transcription needs macOS");
  const args =
    model.id === "apple-speech"
      ? ["transcribe-speech", file, ...(model.locale ? [model.locale] : [])]
      : ["transcribe-parakeet", file, model.folder];
  const { text } = (await run(binary, args)) as { text: string };
  return text;
}

/** Timed recognition for recordings; older helpers must be rebuilt instead of fabricating caption timing. */
export async function transcribeTimed(
  file: string,
  model: DownloadedModel,
  signal?: AbortSignal,
): Promise<{ text: string; words: TimedText[] }> {
  if (process.platform !== "darwin") throw new Error("Transcription needs macOS");
  const args =
    model.id === "apple-speech"
      ? ["transcribe-speech", file, ...(model.locale ? [model.locale] : [])]
      : ["transcribe-parakeet", file, model.folder];
  const reply = (await run(transcriberBinary(), args, undefined, signal)) as {
    text: string;
    words?: unknown[];
  };
  if (!Array.isArray(reply.words) || !reply.words.every(isTimedText))
    throw new Error("Rebuild the local transcriber helper to enable timed captions");
  if (typeof reply.text !== "string")
    throw new Error("The local model returned an invalid transcript");
  if (reply.text.trim() && !reply.words.length)
    throw new Error(
      "The local model returned speech without caption timestamps. Try transcribing again.",
    );
  return { text: reply.text, words: reply.words };
}

export async function mediaDuration(file: string, signal?: AbortSignal): Promise<number> {
  const reply = (await run(transcriberBinary(), ["media-duration", file], undefined, signal)) as {
    duration: number;
  };
  if (!(reply.duration > 0) || !Number.isFinite(reply.duration))
    throw new Error("Couldn't read media duration");
  return reply.duration;
}
