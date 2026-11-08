const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { configureNovaProfile, migrateNovaProfile } = require('../profile-migration');

test('Nova adopts an existing profile and partition without modifying the original or copying process locks', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nova-migration-'));
  try {
    const legacy = path.join(root, 'orbit-spatial-browser'), destination = path.join(root, 'Nova');
    mkdirSync(path.join(legacy,'Partitions','orbit'),{recursive:true});
    writeFileSync(path.join(legacy,'orbit-bookmarks.json'),'original bookmarks');
    writeFileSync(path.join(legacy,'orbit-history.json'),'original history');
    writeFileSync(path.join(legacy,'orbit-settings.json'),'original settings');
    writeFileSync(path.join(legacy,'Partitions','orbit','Cookies'),'saved browser session');
    writeFileSync(path.join(legacy,'SingletonLock'),'running-process lock');
    const calls={}, app={setName:name=>{calls.name=name;},getPath:()=>root,setPath:(key,value)=>{calls[key]=value;}};
    const result=configureNovaProfile(app,{});
    assert.equal(result.migratedFrom,legacy); assert.equal(calls.name,'Nova');
    assert.equal(calls.userData,destination); assert.equal(calls.sessionData,destination);
    for(const kind of ['bookmarks','history','settings']) {
      assert.equal(readFileSync(path.join(destination,`nova-${kind}.json`),'utf8'),`original ${kind}`);
      assert.equal(readFileSync(path.join(legacy,`orbit-${kind}.json`),'utf8'),`original ${kind}`);
    }
    assert.equal(readFileSync(path.join(destination,'Partitions','nova','Cookies'),'utf8'),'saved browser session');
    assert.equal(existsSync(path.join(destination,'SingletonLock')),false);
    writeFileSync(path.join(destination,'nova-bookmarks.json'),'new Nova bookmarks');
    migrateNovaProfile(destination,[legacy]);
    assert.equal(readFileSync(path.join(destination,'nova-bookmarks.json'),'utf8'),'new Nova bookmarks');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('explicit Nova profiles remain isolated and Nova environment variables take precedence over legacy aliases', () => {
  const root=mkdtempSync(path.join(os.tmpdir(),'nova-overrides-'));
  try {
    mkdirSync(path.join(root,'ORBIT'));writeFileSync(path.join(root,'ORBIT','orbit-history.json'),'legacy');
    const app={setName:()=>{},getPath:()=>root,setPath:()=>{}};
    let data=configureNovaProfile(app,{NOVA_USER_DATA:path.join(root,'isolated'),ORBIT_USER_DATA:path.join(root,'wrong'),NOVA_START_URL:'nova://newtab',ORBIT_START_URL:'https://old.test',NOVA_TEST_HIDDEN:'1'});
    assert.equal(data.migratedFrom,null);assert.equal(data.startUrl,'nova://newtab');assert.equal(data.testHidden,true);
    assert.equal(existsSync(path.join(data.profilePath,'nova-history.json')),false);
    data=configureNovaProfile(app,{ORBIT_USER_DATA:path.join(root,'legacy-override'),ORBIT_START_URL:'https://legacy.test',ORBIT_TEST_HIDDEN:'1'});
    assert.equal(data.profilePath,path.join(root,'legacy-override'));assert.equal(data.startUrl,'https://legacy.test');assert.equal(data.testHidden,true);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('local preferences migrate to Nova once while respecting newer values and unavailable storage', async () => {
  const { migrateNovaPreferences }=await import('../ui/lib/preferences.js');
  const values=new Map([['orbit.start.motionPaused','1'],['orbit.cosmos.sidebarHidden','1'],['nova.cosmos.sidebarHidden','0'],['unrelated','keep']]);
  const storage={get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  migrateNovaPreferences(storage);
  assert.equal(values.get('nova.start.motionPaused'),'1');assert.equal(values.get('nova.cosmos.sidebarHidden'),'0');assert.equal(values.get('unrelated'),'keep');
  assert.doesNotThrow(()=>migrateNovaPreferences({get length(){throw Error('disabled');}}));
});

test('Nova packaging, executable name and desktop identity agree', () => {
  const metadata=require('../package.json'),lock=require('../package-lock.json');
  assert.equal(metadata.name,'nova-browser');assert.equal(lock.name,metadata.name);assert.equal(lock.packages[''].name,metadata.name);
  assert.equal(metadata.productName,'Nova');assert.equal(metadata.build.productName,'Nova');
  assert.equal(metadata.build.appId,'edu.buffalo.nova');assert.equal(metadata.desktopName,'edu.buffalo.nova.desktop');
});
