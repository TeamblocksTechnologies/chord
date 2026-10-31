# @teamblocks.dev/chord-ui

Svelte 5 controls, interaction helpers and theme tokens for Chord, including the recording controls the app shows on Home, in the floating toolbar and in the recording island. It exports source directly, with no build step.

Add it as `workspace:*` inside this repository. Outside it, install it from GitHub:

```sh
pnpm add "github:TeamblocksTechnologies/chord#main&path:packages/ui"
```

The consumer compiles Svelte and Tailwind CSS.

```svelte
<script lang="ts">
  import Slider from "@teamblocks.dev/chord-ui/Slider.svelte";
</script>
```

```css
@import "tailwindcss";
@import "@teamblocks.dev/chord-ui/theme.css";
```

Keep desktop APIs out of this package. Generic components take values, snippets and callbacks.

## Recording controls

`recording/` holds the source cells and their popovers. They read what they show from a recording environment: the sources to choose from, the user's preferences, and components for live previews. The desktop app provides its recorder's in `apps/desktop/src/features/recording/renderer/recordingEnvironment.ts`; another page can provide stand-ins.

```svelte
<script lang="ts">
  import { initialSetup } from "@teamblocks.dev/chord-ui/model/setup";
  import { provideRecordingEnvironment } from "@teamblocks.dev/chord-ui/recording/environment";
  import RecordingControls from "@teamblocks.dev/chord-ui/recording/RecordingControls.svelte";

  provideRecordingEnvironment(environment);
  let setup = $state(initialSetup());
</script>

<RecordingControls {setup} />
```

`model/` is the framework-free setup and quality model the controls edit. The desktop app's domain code shares it, so it must not import Svelte or any component.

```sh
pnpm --filter @teamblocks.dev/chord-ui typecheck
pnpm --filter @teamblocks.dev/chord-ui test
```
