interface Window {
  chord: {
    platform: string;
    surface: import("#platform/contracts/desktop").Surface;
    desktop: import("#platform/contracts/desktop").DesktopAPI;
    updates: import("#features/settings/contracts/updates").UpdatesAPI;
    toolbar: import("#platform/contracts/desktop").DesktopAPI["toolbar"];
    shortcuts: import("#platform/contracts/desktop").DesktopAPI["shortcuts"];
    /** The pointer overlay windows only: the cursor in that display, and which overlays are on. */
    pointer: {
      onUpdate(
        listener: (update: import("#platform/contracts/desktop").PointerUpdate) => void,
      ): () => void;
      onShortcut(
        listener: (press: import("#platform/contracts/desktop").ShortcutPress) => void,
      ): () => void;
    };
    /** The area picker windows only: the display's areas to start from, and each edit. */
    areas: {
      init(): Promise<import("#platform/contracts/desktop").AreaPickerInit | null>;
      ready(): void;
      change(areas: import("@teamblocks.dev/chord-recorder-protocol").ScreenArea[]): void;
      finish(done: boolean): void;
    };
    /** The thumbnail window only: projects to draw thumbnails of, and what's drawn. */
    thumbnailRenderer: {
      onRender(
        listener: (
          id: number,
          project: import("#project-document/domain/recording").Project,
        ) => void,
      ): () => void;
      ready(): void;
      result(
        id: number,
        reply:
          | {
              ok: true;
              result: import("#features/projects/contracts/thumbnails").ThumbnailRender | null;
            }
          | { ok: false; error: string },
      ): Promise<void>;
    };
    /** Chooses what the next `getDisplayMedia` call captures: a `DisplaySource.id` or `PreviewWindow.id`. */
    selectPreviewSource(source: { kind: "display" | "window"; id: number }): Promise<void>;
    /** JPEG or PNG frames of this window's helper display previews, by `ScreenPreview.id`. */
    onPreviewFrame(listener: (id: string, image: Uint8Array) => void): () => void;
    /** Opens the System Settings pane where `kind` ("screen", "microphone", "camera", "accessibility") is allowed. */
    openPermissionSettings(kind: string): Promise<void>;
    /** Apps in the usual app folders, whether or not they're open. Empty off macOS. */
    installedApps(): Promise<{ bundleId: string; name: string; path: string }[]>;
    /** Apps open now, as in the Dock. Empty off macOS. */
    runningApps(): Promise<{ bundleId: string; name: string; path: string }[]>;
    /** App icons as data URLs, by bundle id. `pid` finds apps that run from outside the app folders. */
    appIcons(apps: { bundleId: string; pid?: number }[]): Promise<Record<string, string>>;
    /** The recorder helper, relayed by the main process. Rejections carry the RPC error's `code` and `data`. */
    helper: {
      request<M extends import("@teamblocks.dev/chord-recorder-protocol").MethodName>(
        method: M,
        params?: import("@teamblocks.dev/chord-recorder-protocol").MethodParams<M>,
      ): Promise<import("@teamblocks.dev/chord-recorder-protocol").MethodResult<M>>;
      /** Returns an unsubscribe function. */
      onNotification(listener: (method: string, params: unknown) => void): () => void;
    };
  };
}
