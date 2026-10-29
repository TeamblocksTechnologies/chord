import type { StreamTargetChunk } from "mediabunny";

/** A file the main process writes an export to: written as a stream, then kept or removed. */
export interface ExportFile {
  writable: WritableStream<StreamTargetChunk>;
  close(keep: boolean): Promise<void>;
}

/** Starts writing the chosen file at `path`. */
export async function openExportFile(path: string): Promise<ExportFile> {
  const { export: files } = window.chord.desktop;
  const id = await files.open(path);
  let closed = false;
  return {
    writable: new WritableStream({
      write: ({ data, position }) => files.write(id, position, data),
    }),
    async close(keep) {
      if (closed) return;
      closed = true;
      await files.close(id, keep);
    },
  };
}
