# @teamblocks.dev/chord-ui

Generic Svelte 5 controls, interaction helpers and theme tokens for Chord. Private workspace package that exports source directly, with no build step.

Add it as `workspace:*`. The consumer compiles Svelte and Tailwind CSS.

```svelte
<script lang="ts">
  import Slider from "@teamblocks.dev/chord-ui/Slider.svelte";
</script>
```

```css
@import "tailwindcss";
@import "@teamblocks.dev/chord-ui/theme.css";
```

Keep desktop APIs, product models and feature-specific components out of this package. Components take values, snippets and callbacks instead.

```sh
pnpm --filter @teamblocks.dev/chord-ui typecheck
pnpm --filter @teamblocks.dev/chord-ui test
```
