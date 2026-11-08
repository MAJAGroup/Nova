"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");

const desktopString = value => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
// Desktop entries unescape string values before parsing quoted Exec arguments.
const execArgument = value => desktopString('"' + value.replace(/[\\"`$]/g, "\\$&").replace(/%/g, "%%") + '"');

// Wayland desktops resolve taskbar icons through an installed .desktop entry.
// Copy the icon out of the AppImage's temporary mount to a persistent user path.
async function registerLinuxDesktop({ dataHome, iconPath, executable, args = [] }) {
  const id = "edu.buffalo.orbit";
  const installedIcon = path.join(dataHome, "icons", "hicolor", "512x512", "apps", id + ".png");
  const desktopFile = path.join(dataHome, "applications", id + ".desktop");
  await fs.mkdir(path.dirname(installedIcon), { recursive: true });
  await fs.mkdir(path.dirname(desktopFile), { recursive: true });
  await fs.copyFile(iconPath, installedIcon);
  const entry = ["[Desktop Entry]", "Type=Application", "Name=ORBIT", "Comment=Explore the web in your own universe",
    `Exec=${[executable, ...args].map(execArgument).join(" ")} %U`, `Icon=${desktopString(installedIcon)}`,
    "Terminal=false", "Categories=Network;WebBrowser;", `StartupWMClass=${id}`, ""].join("\n");
  await fs.writeFile(desktopFile, entry, { mode: 0o644 });
  return { desktopFile, iconPath: installedIcon };
}
module.exports = { registerLinuxDesktop };
