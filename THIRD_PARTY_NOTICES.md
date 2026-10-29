# Third-party notices

Chord is licensed under the [AGPL-3.0](LICENSE). It uses the third-party software and models below under their own licenses. Full license texts are in [`apps/desktop/resources/licenses`](apps/desktop/resources/licenses).

## Software

| Component                                                                                                                   | License                                                                                                                              | Used for                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [Electron](https://github.com/electron/electron)                                                                            | MIT, plus the licenses of the Chromium and Node.js components it embeds (see the `LICENSES.chromium.html` file in an Electron build) | Desktop shell                                             |
| [Svelte](https://github.com/sveltejs/svelte) and its runtime dependencies                                                   | MIT, Apache-2.0                                                                                                                      | Renderer UI                                               |
| [Mediabunny](https://mediabunny.dev)                                                                                        | MPL-2.0                                                                                                                              | Media decoding and encoding in the renderer               |
| [gifenc](https://github.com/mattdesl/gifenc)                                                                                | MIT                                                                                                                                  | GIF export                                                |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) (`onnxruntime-node`)                                               | MIT                                                                                                                                  | Running the noise reduction and background removal models |
| [electron-updater](https://github.com/electron-userland/electron-builder) and its dependencies                              | MIT, ISC, BSD-3-Clause, BlueOak-1.0.0                                                                                                | Application updates                                       |
| [Lucide](https://github.com/lucide-icons/lucide), icon shapes in `packages/ui/src/Icon.svelte`                              | ISC, plus MIT for the icons derived from Feather                                                                                     | Interface icons                                           |
| [DM Sans](https://github.com/googlefonts/dm-fonts), via Fontsource                                                          | OFL-1.1                                                                                                                              | Interface typeface                                        |
| [FluidAudio](https://github.com/FluidInference/FluidAudio) 0.17.7                                                           | Apache-2.0                                                                                                                           | Runs the Parakeet speech model on-device                  |
| [fastcluster](https://danifold.net/fastcluster.html) and [VBx](https://github.com/BUTSpeechFIT/VBx), included in FluidAudio | BSD-2-Clause, Apache-2.0                                                                                                             | Speaker clustering in FluidAudio                          |

The npm packages above, with their transitive dependencies, are listed with their license texts in [`npm-packages.txt`](apps/desktop/resources/licenses/npm-packages.txt). Development-only tooling (TypeScript, Vite, Tailwind CSS, test tools) is not part of a built app and is not listed there.

Mediabunny is under the Mozilla Public License 2.0. Chord uses it unmodified; its source is available at <https://github.com/Vanilagy/mediabunny>. Changes to Mediabunny's own files must be shared under the MPL-2.0.

Apple's frameworks (ScreenCaptureKit, AVFoundation, Speech, Sound Isolation and others) are part of macOS and are not redistributed with Chord.

FluidAudio carries further notices for parts of it that Chord's transcription helper does not use, such as speech synthesis. They are in its `ThirdPartyLicenses` folder at <https://github.com/FluidInference/FluidAudio>.

## Models

Chord downloads these on request, and never bundles them. Each is fetched at a pinned revision and verified against a checksum. They remain under their own licenses.

| Model                                                                    | License           | Source                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| NVIDIA Parakeet TDT 0.6B v3, in the Core ML conversion by FluidInference | CC-BY-4.0         | <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>, <https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml> |
| DeepFilterNet3                                                           | MIT or Apache-2.0 | <https://github.com/Rikorose/DeepFilterNet>                                                                               |
| MODNet, as ONNX weights by Xenova                                        | Apache-2.0        | <https://huggingface.co/Xenova/modnet>, <https://github.com/ZHKKKe/MODNet>                                                |
| BEN2 Base, as ONNX weights by onnx-community                             | MIT               | <https://huggingface.co/onnx-community/BEN2-ONNX>, <https://huggingface.co/PramaLLC/BEN2>                                 |

Parakeet is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). NVIDIA created the original model, and FluidInference converted it to Core ML. Chord runs the converted model and makes no further changes to it.

Transcripts, noise-reduced audio and background masks are output of these models on the user's own recordings; none of these licenses applies to that output.
