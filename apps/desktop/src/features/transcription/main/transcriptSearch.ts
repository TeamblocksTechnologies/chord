import type { RecordingTranscript } from "../domain/captions.ts";
import type { Project } from "#project-document/domain/recording";
import {
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  searchTerms,
  searchTranscript,
  type SearchClip,
  type TranscriptHit,
} from "../contracts/transcriptSearch.ts";

interface Dependencies {
  projects(): readonly Project[];
  transcript(directory: string): Promise<RecordingTranscript | undefined>;
  clips(directory: string): Promise<SearchClip[]>;
}

interface Entry {
  transcript: RecordingTranscript;
  clips: SearchClip[];
}

/** Most results from one recording, and from the whole library. */
const PER_RECORDING = 3;
const TOTAL = 40;

/**
 * Searches what's said across the library. Each recording's transcript is read the first time a search needs it and
 * kept until it changes, so nothing is stored beyond the transcripts themselves. Cuts are read from the projects at
 * each search, so editing them needs no update here.
 */
export class TranscriptSearch {
  #dependencies: Dependencies;
  #entries = new Map<string, Promise<Entry | undefined>>();

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  /** A recording's transcript or length of its lead track changed, or it was removed. */
  invalidate(directory: string): void {
    this.#entries.delete(directory);
  }

  async search(query: string): Promise<TranscriptHit[]> {
    if (
      query.length > MAX_SEARCH_LENGTH ||
      query.trim().length < MIN_SEARCH_LENGTH ||
      !searchTerms(query).length
    )
      return [];
    const projects = this.#dependencies
      .projects()
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const present = new Set(
      projects.flatMap((project) =>
        project.recordings.flatMap((recording) => recording.directory ?? []),
      ),
    );
    for (const directory of this.#entries.keys())
      if (!present.has(directory)) this.#entries.delete(directory);
    const found = await Promise.all(
      projects.flatMap((project) =>
        project.recordings.flatMap((recording) => {
          const directory = recording.directory;
          if (!directory) return [];
          return [
            this.#entry(directory).then((entry): TranscriptHit[] =>
              entry
                ? searchTranscript(
                    entry.transcript,
                    entry.clips,
                    recording.cuts ?? [],
                    query,
                    PER_RECORDING,
                  ).map((match) => ({ ...match, projectId: project.id, recordingId: recording.id }))
                : [],
            ),
          ];
        }),
      ),
    );
    return found.flat().slice(0, TOTAL);
  }

  #entry(directory: string): Promise<Entry | undefined> {
    let entry = this.#entries.get(directory);
    if (!entry) {
      const loading = this.#load(directory).catch((): undefined => {
        // A missing or unreadable recording only affects itself, and is looked at again next time.
        if (this.#entries.get(directory) === loading) this.#entries.delete(directory);
        return undefined;
      });
      entry = loading;
      this.#entries.set(directory, entry);
    }
    return entry;
  }

  async #load(directory: string): Promise<Entry | undefined> {
    const transcript = await this.#dependencies.transcript(directory);
    return transcript
      ? { transcript, clips: await this.#dependencies.clips(directory) }
      : undefined;
  }
}
