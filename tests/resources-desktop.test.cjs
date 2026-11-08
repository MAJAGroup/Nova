const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('tab hover shows live native memory, CPU and audio without pausing the page, and cleans up on leave and close', { timeout:90000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(),'nova-resources-'));
  const server = createServer((req,res) => {
    res.setHeader('Content-Type','text/html');
    if (req.url === '/busy') res.end(`<title>Busy resource fixture</title><h1>Busy page</h1><script>
      window.tickCount=0;setInterval(()=>{const end=performance.now()+60;while(performance.now()<end){};window.tickCount++;},100);
      window.startTestAudio=async()=>{window.testAudio=new AudioContext();const gain=testAudio.createGain();gain.gain.value=.001;gain.connect(testAudio.destination);const oscillator=testAudio.createOscillator();oscillator.connect(gain);oscillator.start();await testAudio.resume();};
    </script>`);
    else res.end('<title>Quiet resource fixture</title><h1>Quiet page</h1>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app,shell,stage='startup'; const errors=[];
  const until=async predicate=>{const end=Date.now()+15000;while(!await predicate()){if(Date.now()>end)throw Error('Timed out: '+stage);await new Promise(resolve=>setTimeout(resolve,60));}};
  const card=()=>app.evaluate(async({BrowserWindow})=>{
    const view=BrowserWindow.getAllWindows()[0].contentView.children.find(view=>view.webContents?.getURL().endsWith('/ui/tab-resources.html'));
    if(!view)return {visible:false};
    const data=await view.webContents.executeJavaScript(`({id:document.body.dataset.tabId,title:document.getElementById('resource-title').textContent,memory:document.getElementById('resource-memory').textContent,cpu:document.getElementById('resource-cpu').textContent,audio:document.getElementById('resource-audio').textContent})`);
    return {...data,visible:view.getVisible(),bounds:view.getBounds()};
  });
  const page=code=>app.evaluate(({webContents},{url,code})=>webContents.getAllWebContents().find(contents=>contents.getURL()===url).executeJavaScript(code,true),{url:base+'/busy',code});
  try{
    app=await _electron.launch({args:[path.resolve('.'),'--autoplay-policy=no-user-gesture-required'],env:{...process.env,NOVA_USER_DATA:profile,NOVA_START_URL:base+'/quiet',NOVA_TEST_HIDDEN:'1'}});
    await until(()=>{shell=app.windows().find(page=>page.url().endsWith('/ui/index.html'));return Boolean(shell);});
    shell.setDefaultTimeout(10000);shell.on('pageerror',error=>errors.push(error.message));
    await shell.waitForFunction(()=>document.documentElement.dataset.novaReady==='true');
    await app.evaluate(({app,BrowserWindow})=>{BrowserWindow.getAllWindows()[0].showInactive();const original=app.getAppMetrics.bind(app);app.testResourceCalls=0;app.getAppMetrics=()=>{app.testResourceCalls++;return original();};});
    const initial=await shell.evaluate(()=>window.novaBrowser.getTabs()),quietId=initial.activeId;
    const busyId=await shell.evaluate(url=>window.novaBrowser.newTab(url),base+'/busy');
    await until(()=>page('document.readyState === "complete" && window.tickCount > 2').catch(()=>false));
    const button=shell.locator(`.browser-tab[data-tab-id="${busyId}"]`);
    const bounds=()=>app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].contentView.children.find(view=>view.webContents?.getURL()===url).getBounds(),base+'/busy');
    const originalBounds=await bounds();
    stage='CPU and memory';await button.hover();
    await until(async()=>{const data=await card();return data.visible&&data.id===busyId&&parseFloat(data.cpu)>1&&parseFloat(data.memory)>0;});
    assert.deepEqual(await bounds(),originalBounds);
    assert.equal(await button.getAttribute('aria-describedby'),'tab-resource-description');
    assert.match(await shell.locator('#tab-resource-description').textContent(),/Memory: .* MB.*CPU:/);
    const before=await card(),ticks=await page('tickCount');
    await page('window.testAllocation=new Uint8Array(24*1024*1024);testAllocation.fill(7);');
    await until(async()=>parseFloat((await card()).memory)>parseFloat(before.memory)+10);
    assert.ok(await page('tickCount')>ticks);
    // Browser state updates must keep the hovered node and keyboard focus intact.
    await button.evaluate(el=>{el.dataset.preserved='yes';});
    await shell.evaluate(id=>window.novaBrowser.groupTabs([id],{name:'Resource test'}),busyId);
    assert.equal(await button.getAttribute('data-preserved'),'yes');
    assert.equal((await card()).visible,true);
    assert.equal((await shell.evaluate(()=>window.novaBrowser.getTabs())).activeId,busyId);
    const image=await app.evaluate(async({webContents})=>(await webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/tab-resources.html')).capturePage()).toDataURL());
    await mkdir('artifacts',{recursive:true});await writeFile('artifacts/tab-resources.png',Buffer.from(image.split(',')[1],'base64'));

    stage='real audio states';assert.equal((await card()).audio,'Silent');
    await page('startTestAudio()');await until(async()=>(await card()).audio==='Playing');
    await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(contents=>contents.getURL()===url).setAudioMuted(true),base+'/busy');
    await until(async()=>(await card()).audio==='Muted');
    await page('testAudio.close()');
    await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(contents=>contents.getURL()===url).setAudioMuted(false),base+'/busy');
    await until(async()=>(await card()).audio==='Silent');

    stage='leaving hover stops sampling';await shell.mouse.move(8,8);
    await until(async()=>!(await card()).visible);
    const calls=await app.evaluate(({app})=>app.testResourceCalls);
    await new Promise(resolve=>setTimeout(resolve,1250));
    assert.equal(await app.evaluate(({app})=>app.testResourceCalls),calls);
    assert.equal(await button.getAttribute('aria-describedby'),null);

    stage='inactive tabs and keyboard dismissal';
    await shell.locator(`.browser-tab[data-tab-id="${quietId}"]`).hover();
    await until(async()=>{const data=await card();return data.visible&&data.id===quietId;});
    assert.equal((await shell.evaluate(()=>window.novaBrowser.getTabs())).activeId,busyId);
    await shell.keyboard.press('Escape');await until(async()=>!(await card()).visible);
    await button.focus();await until(async()=>{const data=await card();return data.visible&&data.id===busyId;});
    await button.press('Escape');await until(async()=>!(await card()).visible);

    stage='closed tabs and viewport edge';
    await shell.mouse.move(8,8);await button.hover();await until(async()=>(await card()).visible);
    await shell.evaluate(id=>window.novaBrowser.closeTab(id),busyId);await until(async()=>!(await card()).visible);
    const last=shell.locator(`.browser-tab[data-tab-id="${quietId}"]`);await last.hover();
    await until(async()=>(await card()).visible);
    const cardBounds=(await card()).bounds,viewport=await shell.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert.ok(cardBounds.x>=0&&cardBounds.y>=0&&cardBounds.x+cardBounds.width<=viewport.width&&cardBounds.y+cardBounds.height<=viewport.height);
    await shell.locator('#history-tab').click();await until(async()=>!(await card()).visible);
    assert.deepEqual(errors,[]);
  }catch(error){console.error('Resource test stage:',stage);throw error;}
  finally{if(app)await app.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});await rm(profile,{recursive:true,force:true});}
});
