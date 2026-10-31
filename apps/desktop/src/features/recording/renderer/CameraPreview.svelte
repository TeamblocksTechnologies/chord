<script lang="ts">
  import type { CameraSource } from "@teamblocks.dev/chord-recorder-protocol";
  import type { CameraQuality } from "../domain/quality.ts";
  import { cameraPreview } from "./preview.ts";
  import VideoPreview from "./VideoPreview.svelte";

  let {
    camera,
    size,
    mirrored,
  }: { camera: CameraSource; size?: CameraQuality; mirrored: boolean } = $props();
</script>

<VideoPreview
  open={cameraPreview(camera, size)}
  aspect={size ? size.width / size.height : undefined}
  {mirrored}
/>
