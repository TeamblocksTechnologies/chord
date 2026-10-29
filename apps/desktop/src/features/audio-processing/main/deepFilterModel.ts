/** Runs the three DeepFilterNet3 networks, from the ONNX files of its release, for `DeepFilter`. */
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import type { Networks } from "./deepFilter.ts";

const ERB_BANDS = 32;
const DF_BINS = 96;

export interface DeepFilterModel extends Networks {
  release(): Promise<void>;
}

/** The files the networks are in, inside the model's folder. */
export const DEEP_FILTER_FILES = ["enc.onnx", "erb_dec.onnx", "df_dec.onnx"] as const;

export async function loadDeepFilterModel(folder: string, threads = 2): Promise<DeepFilterModel> {
  const options: ort.InferenceSession.SessionOptions = {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
    executionProviders: ["cpu"],
  };
  const [encoder, erbDecoder, filterDecoder] = await Promise.all(
    DEEP_FILTER_FILES.map((file) => ort.InferenceSession.create(join(folder, file), options)),
  );
  return {
    async run(frames, erb, spec) {
      const inputs = {
        feat_erb: new ort.Tensor("float32", erb, [1, 1, frames, ERB_BANDS]),
        feat_spec: new ort.Tensor("float32", spec, [1, 2, frames, DF_BINS]),
      };
      const encoded = await encoder!.run(inputs);
      let gains: ort.InferenceSession.ReturnType | undefined;
      let filter: ort.InferenceSession.ReturnType | undefined;
      try {
        gains = await erbDecoder!.run({
          emb: encoded.emb!,
          e3: encoded.e3!,
          e2: encoded.e2!,
          e1: encoded.e1!,
          e0: encoded.e0!,
        });
        filter = await filterDecoder!.run({ emb: encoded.emb!, c0: encoded.c0! });
        // The tensors' memory belongs to the runtime, so what's kept is copied.
        return {
          gains: Float32Array.from(gains.m!.data as Float32Array),
          coefs: Float32Array.from(filter.coefs!.data as Float32Array),
          lsnr: Float32Array.from(encoded.lsnr!.data as Float32Array),
        };
      } finally {
        for (const outputs of [encoded, gains, filter])
          for (const tensor of Object.values(outputs ?? {})) tensor.dispose();
      }
    },
    async release() {
      await Promise.all([encoder, erbDecoder, filterDecoder].map((session) => session!.release()));
    },
  };
}
