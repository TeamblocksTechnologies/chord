import { open, type FileHandle } from "node:fs/promises";

/** Reads a PCM WAV a stretch at a time, so a long take isn't held in memory. */
export class WavReader {
  readonly channels: number;
  readonly rate: number;
  /** How many frames the file has. */
  readonly frames: number;
  readonly #handle: FileHandle;
  readonly #bytes: number;
  readonly #start: number;
  #position = 0;

  private constructor(
    handle: FileHandle,
    format: { channels: number; rate: number; bytes: number },
    start: number,
    frames: number,
  ) {
    this.#handle = handle;
    this.channels = format.channels;
    this.rate = format.rate;
    this.#bytes = format.bytes;
    this.#start = start;
    this.frames = frames;
  }

  static async open(file: string): Promise<WavReader> {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const header = Buffer.alloc(12);
      await handle.read(header, 0, 12, 0);
      if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE")
        throw new Error("Not a WAV file");
      let format: { channels: number; rate: number; bytes: number } | undefined;
      for (let offset = 12; offset + 8 <= size;) {
        const chunk = Buffer.alloc(8);
        await handle.read(chunk, 0, 8, offset);
        const id = chunk.toString("ascii", 0, 4);
        const length = chunk.readUInt32LE(4);
        if (id === "fmt ") {
          const fmt = Buffer.alloc(16);
          await handle.read(fmt, 0, 16, offset + 8);
          const tag = fmt.readUInt16LE(0);
          if (tag !== 1 && tag !== 0xfffe) throw new Error("Unsupported WAV format");
          format = {
            channels: fmt.readUInt16LE(2),
            rate: fmt.readUInt32LE(4),
            bytes: fmt.readUInt16LE(14) / 8,
          };
        } else if (id === "data") {
          if (!format || ![2, 3, 4].includes(format.bytes) || format.channels < 1)
            throw new Error("Unsupported WAV format");
          const frameBytes = format.channels * format.bytes;
          const end = Math.min(offset + 8 + length, size);
          return new WavReader(
            handle,
            format,
            offset + 8,
            Math.floor((end - offset - 8) / frameBytes),
          );
        }
        offset += 8 + length + (length % 2);
      }
      throw new Error("WAV has no sample data");
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** The next `count` frames or fewer, as one array of samples from -1 to 1 per channel; null at the end. */
  async read(count: number): Promise<Float32Array[] | null> {
    const frames = Math.min(count, this.frames - this.#position);
    if (frames <= 0) return null;
    const frameBytes = this.channels * this.#bytes;
    const buffer = Buffer.alloc(frames * frameBytes);
    const { bytesRead } = await this.#handle.read(
      buffer,
      0,
      buffer.length,
      this.#start + this.#position * frameBytes,
    );
    const got = Math.floor(bytesRead / frameBytes);
    if (got === 0) return null;
    this.#position += got;
    const samples = Array.from({ length: this.channels }, () => new Float32Array(got));
    for (let frame = 0; frame < got; frame++) {
      for (let channel = 0; channel < this.channels; channel++) {
        const at = frame * frameBytes + channel * this.#bytes;
        samples[channel]![frame] =
          this.#bytes === 2
            ? buffer.readInt16LE(at) / 0x8000
            : this.#bytes === 3
              ? buffer.readIntLE(at, 3) / 0x800000
              : buffer.readInt32LE(at) / 0x80000000;
      }
    }
    return samples;
  }

  async close(): Promise<void> {
    await this.#handle.close();
  }
}

/** Writes 24-bit PCM WAV a stretch at a time. The header's sizes are filled in when it closes. */
export class WavWriter {
  readonly channels: number;
  readonly rate: number;
  readonly #handle: FileHandle;
  #frames = 0;

  private constructor(handle: FileHandle, channels: number, rate: number) {
    this.#handle = handle;
    this.channels = channels;
    this.rate = rate;
  }

  static async create(file: string, channels: number, rate: number): Promise<WavWriter> {
    const handle = await open(file, "w");
    const writer = new WavWriter(handle, channels, rate);
    await handle.write(writer.#header());
    return writer;
  }

  /** Appends frames: one array of samples per channel, all the same length. Samples outside -1 to 1 are clipped. */
  async write(samples: Float32Array[]): Promise<void> {
    if (samples.length !== this.channels) throw new Error("The wrong number of channels");
    const frames = samples[0]!.length;
    const buffer = Buffer.alloc(frames * this.channels * 3);
    for (let frame = 0; frame < frames; frame++) {
      for (let channel = 0; channel < this.channels; channel++) {
        const value = Math.max(-1, Math.min(1, samples[channel]![frame]!));
        buffer.writeIntLE(
          Math.round(value < 0 ? value * 0x800000 : value * 0x7fffff),
          (frame * this.channels + channel) * 3,
          3,
        );
      }
    }
    await this.#handle.write(buffer);
    this.#frames += frames;
  }

  async close(): Promise<void> {
    try {
      await this.#handle.write(this.#header(), 0, 44, 0);
    } finally {
      await this.#handle.close();
    }
  }

  #header(): Buffer {
    const data = this.#frames * this.channels * 3;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + data, 4);
    header.write("WAVEfmt ", 8, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.rate, 24);
    header.writeUInt32LE(this.rate * this.channels * 3, 28);
    header.writeUInt16LE(this.channels * 3, 32);
    header.writeUInt16LE(24, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(data, 40);
    return header;
  }
}
