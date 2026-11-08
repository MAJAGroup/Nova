const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { registerLinuxDesktop } = require('../linux-desktop');

test('Linux desktop registration preserves the icon and uses a stable identity and safely quoted launch path', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'orbit-desktop-'));
  const iconPath = path.resolve('assets/icon.png');
  try {
    const installed = await registerLinuxDesktop({ dataHome, iconPath, executable: '/tmp/My Browser/ORBIT%ready.AppImage', args: ['--appimage-extract-and-run'] });
    assert.deepEqual(await readFile(installed.iconPath), await readFile(iconPath));
    let entry = await readFile(installed.desktopFile, 'utf8');
    assert.match(entry, /^StartupWMClass=edu\.buffalo\.orbit$/m);
    assert.match(entry, /^Exec="\/tmp\/My Browser\/ORBIT%%ready\.AppImage" "--appimage-extract-and-run" %U$/m);
    assert.ok(entry.includes('Icon=' + installed.iconPath));
    const updated = await registerLinuxDesktop({ dataHome, iconPath, executable: '/new/place/electron', args: ['/projects/orbit'] });
    assert.equal(updated.desktopFile, installed.desktopFile);
    entry = await readFile(installed.desktopFile, 'utf8');
    assert.match(entry, /^Exec="\/new\/place\/electron" "\/projects\/orbit" %U$/m);
    assert.ok(!entry.includes('My Browser'));
  } finally { await rm(dataHome, { recursive: true, force: true }); }
});
