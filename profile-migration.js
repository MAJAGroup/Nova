"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Legacy names are confined to migration; all new identities and writes use Nova.
const legacyProfileNames = ["ORBIT", "orbit-spatial-browser", "orbit-browser", "Orbit", "Odyssey", "odyssey", "odyssey-browser", "spacebar"];
const legacyDesktopIds = ["edu.buffalo.orbit"];
const legacyFiles = ["bookmarks", "history", "settings"].map(kind => [`orbit-${kind}.json`, `nova-${kind}.json`]);
const volatile = new Set(["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "ShaderCache", "GrShaderCache", "Crashpad", "DevToolsActivePort", "lockfile"]);
function copyFilter(source) {
  const name = path.basename(source);
  if (name.startsWith("Singleton") || volatile.has(name)) return false;
  const stat = fs.lstatSync(source); return stat.isDirectory() || stat.isFile();
}
function copyDirectory(source, destination) {
  const staging = `${destination}.migration-${process.pid}`;
  try {
    fs.cpSync(source, staging, { recursive: true, filter: copyFilter });
    fs.renameSync(staging, destination);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
function migrateNovaProfile(destination, legacyProfiles = []) {
  let migratedFrom = null;
  if (!fs.existsSync(destination)) {
    const legacy = legacyProfiles.find(candidate => candidate !== destination && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
    if (legacy) { fs.mkdirSync(path.dirname(destination), { recursive: true }); copyDirectory(legacy, destination); migratedFrom = legacy; }
    else fs.mkdirSync(destination, { recursive: true });
  }
  for (const [oldName, newName] of legacyFiles) {
    const oldFile = path.join(destination, oldName), newFile = path.join(destination, newName);
    if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) fs.copyFileSync(oldFile, newFile, fs.constants.COPYFILE_EXCL);
  }
  const oldPartition = path.join(destination, "Partitions", "orbit"), newPartition = path.join(destination, "Partitions", "nova");
  if (fs.existsSync(oldPartition) && !fs.existsSync(newPartition)) copyDirectory(oldPartition, newPartition);
  return { profilePath: destination, migratedFrom };
}
function configureNovaProfile(app, env = process.env) {
  app.setName("Nova");
  const override = env.NOVA_USER_DATA || env.ORBIT_USER_DATA;
  const appData = app.getPath("appData"), destination = override ? path.resolve(override) : path.join(appData, "Nova");
  const result = migrateNovaProfile(destination, override ? [] : legacyProfileNames.map(name => path.join(appData, name)));
  app.setPath("userData", destination); app.setPath("sessionData", destination);
  return { ...result, startUrl: env.NOVA_START_URL ?? env.ORBIT_START_URL,
    testHidden: (env.NOVA_TEST_HIDDEN ?? env.ORBIT_TEST_HIDDEN) === "1" };
}
module.exports = { configureNovaProfile, migrateNovaProfile, legacyDesktopIds };
