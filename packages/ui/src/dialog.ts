/** Matches the modal exit transition in app.css, so a dialog isn't unmounted while it is still fading out. */
const EXIT_MS = 160;

export function afterExit(callback: () => void): () => void {
  return () => void setTimeout(callback, EXIT_MS);
}
