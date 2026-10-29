import { Menu, app, type MenuItemConstructorOptions } from "electron";

/**
 * The app menu, in place of Electron's default, whose reload and zoom shortcuts would take keys the user can give to
 * Chord's shortcuts. The shortcuts left here are reserved in `shared/shortcuts.ts`.
 */
export function setAppMenu(): void {
  const mac = process.platform === "darwin";
  // Reloading and the developer tools are only for working on Chord.
  const development: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ role: "reload" }, { role: "toggleDevTools" }];
  const view: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "togglefullscreen" } as const] : []),
    ...development,
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" } as const] : []),
      { role: "editMenu" },
      ...(view.length ? [{ label: "View", submenu: view }] : []),
      { role: "windowMenu" },
    ]),
  );
}
