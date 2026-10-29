/** Runs DeepFilterNet3 in an Electron utility process, so inference never blocks capture or the editor. */
import { statSync } from "node:fs";
import { denoiseWav } from "./denoiseFile.ts";
import { type DeepFilterModel, loadDeepFilterModel } from "./deepFilterModel.ts";

export interface NoiseWork {
  /** The folder the three networks are in. */
  folder: string;
  files: { source: string; output: string }[];
  /** The most the noise is reduced, in dB. */
  attenuationLimit?: number;
  threads?: number;
}

const port = process.parentPort;
if (!port) throw new Error("Noise reduction must run in a utility process");
port.once("message", async ({ data }: { data: NoiseWork }) => {
  let model: DeepFilterModel | undefined;
  try {
    model = await loadDeepFilterModel(data.folder, data.threads ?? 2);
    // Files differ in length, so each counts for its size.
    const sizes = data.files.map((file) => statSync(file.source).size);
    const total = sizes.reduce((sum, size) => sum + size, 0) || 1;
    let before = 0;
    for (const [index, file] of data.files.entries()) {
      await denoiseWav(
        model,
        file.source,
        file.output,
        { attenuationLimit: data.attenuationLimit },
        (fraction) => {
          port.postMessage({ progress: (before + fraction * sizes[index]!) / total });
        },
      );
      before += sizes[index]!;
    }
    port.postMessage({ done: true });
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    await model?.release().catch(() => {});
  }
});
