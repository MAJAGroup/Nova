const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { mkdtemp, writeFile, readFile, rm, mkdir } = require('node:fs/promises');
const path=require('node:path'),os=require('node:os');

test('Nova displays its new identity and carries saved bookmarks, history and UI preferences forward', {timeout:60000}, async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'nova-branding-'));let app;
  try{
    const bookmark={id:'existing-bookmark',title:'Saved research',url:'https://example.test/research',at:Date.now()};
    const visit={...bookmark,id:'existing-visit',parent:null,journey:'research'};
    await writeFile(path.join(profile,'orbit-bookmarks.json'),JSON.stringify({bookmarks:[bookmark]}));
    await writeFile(path.join(profile,'orbit-history.json'),JSON.stringify({nodes:[visit]}));
    app=await _electron.launch({args:[path.resolve('.')],env:{...process.env,NOVA_USER_DATA:profile,NOVA_TEST_HIDDEN:'1',NOVA_START_URL:''}});
    let shell;const until=async predicate=>{const end=Date.now()+15000;while(!await predicate()){if(Date.now()>end)throw Error('Nova startup timed out');await new Promise(resolve=>setTimeout(resolve,40));}};
    await until(()=>{shell=app.windows().find(page=>page.url().endsWith('/ui/index.html'));return Boolean(shell);});
    await shell.waitForFunction(()=>document.documentElement.dataset.novaReady==='true');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
    assert.equal(await shell.title(),'Nova');assert.equal(await app.evaluate(({app})=>app.getName()),'Nova');
    assert.equal(await shell.evaluate(()=>typeof window.orbitBrowser),'undefined');
    assert.equal(await shell.evaluate(()=>typeof window.novaBrowser.getTabs),'function');
    assert.equal((await shell.evaluate(()=>window.novaBrowser.getBookmarks()))[0].title,bookmark.title);
    assert.equal((await shell.evaluate(()=>window.novaBrowser.getHistory()))[0].id,visit.id);
    await shell.waitForFunction(async()=>{const data=await window.novaBrowser.getTabs();return data.tabs.some(tab=>tab.url==='nova://newtab'&&!tab.loading);});
    const start=code=>app.evaluate(({webContents},code)=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/newtab/index.html')).executeJavaScript(code,true),code);
    await until(()=>start('document.documentElement.dataset.startReady === "true"'));
    assert.equal(await start('document.querySelector("h1").textContent'),'Nova');
    assert.equal(await start('typeof window.novaSearch.getLocalSuggestions'),'function');
    await start(`localStorage.setItem('orbit.start.motionPaused','1');localStorage.removeItem('nova.start.motionPaused');location.reload()`);
    await until(()=>start('document.documentElement.dataset.startReady === "true" && localStorage.getItem("nova.start.motionPaused") === "1"'));
    assert.equal(await start('document.getElementById("motion-toggle").getAttribute("aria-pressed")'),'true');
    assert.equal((JSON.parse(await readFile(path.join(profile,'nova-bookmarks.json'),'utf8'))).bookmarks[0].id,bookmark.id);
    await shell.locator('#assistant-reopen').click();
    assert.equal(await shell.locator('#chat-input').getAttribute('placeholder'),'Ask Nova anything…');
    await mkdir('artifacts',{recursive:true});
    const image=await app.evaluate(async({webContents})=>(await webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/newtab/index.html')).capturePage()).toDataURL());
    await writeFile('artifacts/nova-start-page.png',Buffer.from(image.split(',')[1],'base64'));
  }finally{if(app)await app.close();await rm(profile,{recursive:true,force:true});}
});
