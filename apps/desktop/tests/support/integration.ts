// Shared by the integration checks, which run inside Electron's main process.
//
// Checks must pass however slow the machine is, so they never wait a fixed time for something to happen. They wait
// for the state they're about to check instead, and the time limit only bounds a check that's failing. A fixed pause is
// only right as a lower bound, to let a time-based guard in the app expire, since a slow machine only waits longer.
import { BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Longer than anything a passing check waits for, even on a slow CI runner, and short of the runner's timeout. */
const TIMEOUT = 60_000;
const POLL = 25;

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `check` until it returns something truthy, and returns that. A check that throws is retried, since pages
 * reload and windows open in the meantime; the last error is reported if it never holds.
 */
export async function until<T>(
  check: () => T | Promise<T>,
  label = "UI state",
  { timeout = TIMEOUT }: { timeout?: number } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  let failure: unknown;
  for (;;) {
    try {
      const result = await check();
      if (result) return result as NonNullable<T>;
      failure = undefined;
    } catch (error) {
      failure = error;
    }
    if (Date.now() > deadline) {
      await screenshotWindows(`timeout ${label}`);
      throw new Error(
        `Timed out after ${timeout / 1000}s waiting for ${label}`,
        failure ? { cause: failure } : undefined,
      );
    }
    await pause(POLL);
  }
}

/**
 * Retries `assertion` until it passes, for state that follows an action a little later. If it never does, its last
 * failure is reported.
 */
export const eventually = (assertion: () => void | Promise<void>, label = "the expected state") =>
  until(async () => {
    await assertion();
    return true;
  }, label);

/**
 * Waits a moment before checking that something didn't happen, such as a menu reopening. There's nothing to wait
 * for, so on a slow machine this can only make a check miss a bug, never fail a correct app.
 */
export const settle = (ms = 300) => pause(ms);

// Wrapped scripts report what failed: Electron otherwise only says "Script failed to execute".
const AsyncFunction = (async () => {}).constructor as new (body: string) => unknown;
function isExpression(code: string) {
  try {
    new AsyncFunction(`return (${code}\n);`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `code` in `win`'s page and returns its result, resolved if it's a promise. Throws with the page's error and
 * the code that failed.
 */
// Like executeJavaScript, results are whatever the page returns unless a type is given.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluate<T = any>(win: BrowserWindow, code: string): Promise<T> {
  // Statements can't be wrapped as an expression; they run as they are.
  if (!isExpression(code)) return win.webContents.executeJavaScript(code);
  const result = await win.webContents.executeJavaScript(
    `(async () => {
      try {
        return { value: await (${code}\n) };
      } catch (error) {
        return { error: error instanceof Error ? error.stack || error.message : String(error) };
      }
    })()`,
  );
  if ("error" in result) {
    throw new Error(
      `Script failed in the ${surfaceOf(win)} window: ${result.error}\n  in: ${code}`,
    );
  }
  return result.value;
}

/**
 * Clicks the element `element` finds, an expression run in the page, once it's there and enabled. Finding and
 * clicking happen together, so the page can't replace the element in between.
 */
export async function click(win: BrowserWindow, element: string, label = element) {
  await until(
    () =>
      evaluate(
        win,
        `(() => {
          const element = ${element};
          if (!element || element.disabled) return false;
          element.click();
          return true;
        })()`,
      ),
    `${label} to click`,
  );
}

/** `document.querySelector(selector)`, as an expression for `click`. */
export const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

/** The first element matching `selector` whose trimmed text is `text`, as an expression for `click`. */
export const withText = (selector: string, text: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)})`;

function surfaceOf(win: BrowserWindow) {
  const url = win.webContents.getURL();
  return (url && new URL(url).searchParams.get("surface")) || "app";
}

/** The window showing `surface`, such as `main`, if it's open. */
export const surfaceWindow = (surface: string) =>
  BrowserWindow.getAllWindows().find(
    (win) => !win.isDestroyed() && surfaceOf(win) === surface,
  ) as BrowserWindow;

/** Waits for the window showing `surface` to open. */
export const openedWindow = (surface: string) =>
  until(() => surfaceWindow(surface), `the ${surface} window`);

/**
 * Reloads `win`'s page and waits for the new one to load. Until then the old page answers, so a check looking for
 * an element could find it there.
 */
export async function reload(win: BrowserWindow) {
  const loaded = new Promise<void>((resolve) =>
    win.webContents.once("did-finish-load", () => resolve()),
  );
  win.webContents.reload();
  await loaded;
}

/**
 * Waits for `win`'s page to finish its transitions and animations, such as a menu's entrance, so what's measured is
 * where things end up. Endless animations, like spinners, are left running. The window must be showing, since hidden
 * pages don't draw frames.
 */
export const animationsDone = (win: BrowserWindow) =>
  evaluate(
    win,
    `(async () => {
      const finite = (animation) => animation.effect?.getTiming().iterations !== Infinity;
      for (;;) {
        // A frame first, so transitions that start with this one are counted.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const running = document.getAnimations().filter((animation) => finite(animation) && animation.playState === "running");
        if (!running.length) return;
        await Promise.all(running.map((animation) => animation.finished.catch(() => {})));
      }
    })()`,
  );

/** Screenshots every window showing, for diagnosing a check that timed out. */
async function screenshotWindows(label: string) {
  const name = label.replace(/[^\w-]+/g, "-").slice(0, 80);
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed() && win.isVisible()) await screenshot(win, `${name}-${surfaceOf(win)}`);
}

/** Waits for `win`'s page to draw its next frame, by which time input sent before has been handled. */
export const nextFrame = (win: BrowserWindow) =>
  evaluate(win, "new Promise((resolve) => requestAnimationFrame(() => resolve()))");

/** Saves a screenshot of `win` with the check's diagnostics, when they're kept. */
export async function screenshot(win: BrowserWindow, label: string) {
  if (!process.env.CHORD_TEST_SCREENSHOTS) return;
  mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
  // Screenshots are only diagnostics, so the compositor failing to take one doesn't fail the check.
  const image = await win.webContents.capturePage().catch((error: unknown) => {
    console.warn(`Couldn't take the ${label} screenshot:`, error);
  });
  if (image) writeFileSync(join(process.env.CHORD_TEST_SCREENSHOTS, `${label}.png`), image.toPNG());
}
