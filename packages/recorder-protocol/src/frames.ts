/** A display preview's frame, from the helper's frame pipe. */
export interface PreviewFrame {
  /** The `ScreenPreview.id`. */
  id: string;
  /** JPEG, or PNG for a `transparent` background. */
  image: Uint8Array;
}

/**
 * Splits what the helper writes to its frame pipe, file descriptor 3, into frames: each is the `ScreenPreview.id`
 * in UTF-8, then the image, each preceded by its length in bytes as a big-endian uint32. Returns the function to
 * feed chunks to as they arrive; it calls `onFrame` with each whole frame.
 */
export function readPreviewFrames(
  onFrame: (frame: PreviewFrame) => void,
): (chunk: Uint8Array) => void {
  const decoder = new TextDecoder();
  let pending = new Uint8Array(0);
  return (chunk) => {
    const buffer = pending.length === 0 ? chunk : concat(pending, chunk);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;
    while (buffer.length - offset >= 4) {
      const idEnd = offset + 4 + view.getUint32(offset);
      if (buffer.length < idEnd + 4) break;
      const end = idEnd + 4 + view.getUint32(idEnd);
      if (buffer.length < end) break;
      onFrame({
        id: decoder.decode(buffer.subarray(offset + 4, idEnd)),
        image: buffer.slice(idEnd + 4, end),
      });
      offset = end;
    }
    pending = buffer.slice(offset);
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}
