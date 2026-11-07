const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = require("../package.json");
const files = [
  "assets/orbit.png",
  "desktop-main.js",
  "desktop-preload.js",
  "desktop-state.js",
  "newtab.html",
  "app.js",
  "styles.css",
];
const stage = path.join(root, ".desktop-build");
fs.mkdirSync(stage, { recursive: true });
for (const file of files) {
  fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(stage, file));
}
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "orbit-browser",
      version: manifest.version,
      description: manifest.description,
      author: "ORBIT contributors",
      main: "desktop-main.js",
      build: {
        appId: "edu.buffalo.orbit",
        productName: "ORBIT",
        electronVersion: require("electron/package.json").version,
        files,
        asar: true,
        npmRebuild: false,
        directories: { output: path.join(root, "release") },
        linux: {
          icon: "assets/orbit.png",
          target: ["AppImage"],
          category: "Network;WebBrowser;",
        },
        mac: { category: "public.app-category.productivity" },
        win: { target: "nsis" },
      },
    },
    null,
    2,
  ),
);
console.log(
  "Prepared native desktop sources without remote-service dependencies.",
);
