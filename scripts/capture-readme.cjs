// Capture the real application with reserved .example demo pages and an isolated
// profile. No personal browsing data, credentials or production services are used.
const { _electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'screenshots');
const sections = [
  { name:'Space research', host:'research.nova.example', color:'#93d8ef', initial:'R', pages:[['webb','James Webb observations'],['exoplanets','Exoplanet field notes'],['galaxies','Mapping the Milky Way']] },
  { name:'Building Nova', host:'build.nova.example', color:'#b6a6ed', initial:'B', pages:[['platform','Web platform reference'],['interface','Nova interface notes'],['roadmap','Project roadmap']] },
  { name:'Design inspiration', host:'studio.nova.example', color:'#e7c392', initial:'S', pages:[['type','Typography and motion'],['light','Light, color and space'],['reading','Design reading list']] }
];
const icon = section => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="${section.color}"/><text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#122039">${section.initial}</text></svg>`).toString('base64');
const url = (section, page) => `https://${section.host}/${page[0]}`;

(async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'nova-readme-'));
  let app;
  const until = async predicate => {
    const end = Date.now()+20000;
    while (!await predicate()) { if(Date.now()>end) throw Error('Capture state timed out'); await new Promise(resolve=>setTimeout(resolve,60)); }
  };
  try {
    await mkdir(output, {recursive:true});
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); yesterday.setHours(10,0,0,0);
    const history = sections.flatMap((section,group)=>section.pages.map((page,index)=>({
      id:`demo-${group}-${index}`,journey:`demo-${group}`,title:page[1],url:url(section,page),favicon:icon(section),
      at:+yesterday+(group*60+index*12)*60000,parent:index?`demo-${group}-${index-1}`:null,kind:index?'navigation':'root'
    })));
    await writeFile(path.join(profile,'nova-history.json'),JSON.stringify({nodes:history}));
    await writeFile(path.join(profile,'nova-bookmarks.json'),JSON.stringify({bookmarks:history.map((visit,index)=>({...visit,id:`bookmark-${index}`}))}));
    app = await _electron.launch({args:[root],env:{...process.env,NOVA_USER_DATA:profile,NOVA_TEST_HIDDEN:'1',NOVA_START_URL:''}});
    let shell;
    await until(()=>{shell=app.windows().find(page=>page.url().endsWith('/ui/index.html'));return Boolean(shell);});
    shell.setDefaultTimeout(15000);
    await shell.waitForFunction(()=>document.documentElement.dataset.novaReady==='true');
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1600,1000);win.showInactive();});
    const start = code=>app.evaluate(({webContents},code)=>webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/newtab/index.html')).executeJavaScript(code,true),code);
    await until(()=>start('document.documentElement.dataset.startReady === "true"').catch(()=>false));
    await until(()=>start('document.getElementById("universe").dataset.phase === "revealed"'));
    await start('document.getElementById("start-search").blur();document.getElementById("motion-toggle").click()');
    await start('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const nativeImage = await app.evaluate(async({webContents})=>(await webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/newtab/index.html')).capturePage()).toDataURL());
    await writeFile(path.join(output,'new-tab.png'),Buffer.from(nativeImage.split(',')[1],'base64'));

    // Demo pages are actually loaded into tab renderers. The .example namespace
    // is reserved for examples and never contacts a real website.
    await app.evaluate(({session},data)=>{
      session.fromPartition('persist:nova').protocol.handle('https',request=>{
        const target=new URL(request.url),section=data.find(section=>section.host===target.hostname);
        if(!section)return new Response('Demo capture profile',{status:404});
        const page=section.pages.find(page=>'/'+page[0]===target.pathname)||section.pages[0];
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="${section.color}"/><text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#122039">${section.initial}</text></svg>`;
        const image='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
        return new Response(`<!doctype html><html><head><title>${page[1]}</title><link rel="icon" href="${image}"></head><body style="margin:0;padding:80px;font:18px system-ui;color:#c8e4ed;background:#0b1424"><p style="color:${section.color};letter-spacing:3px;font-size:12px">${section.name.toUpperCase()}</p><h1>${page[1]}</h1><p>A sample page in the Nova product demo.</p></body></html>`,{headers:{'content-type':'text/html'}});
      });
    },sections);
    for(const section of sections){
      const ids=[];
      for(const page of section.pages){
        const id=await shell.evaluate(address=>window.novaBrowser.newTab(address),url(section,page));ids.push(id);
        await until(()=>shell.evaluate(id=>window.novaBrowser.getTabs().then(data=>data.tabs.some(tab=>tab.id===id&&!tab.loading)),id));
      }
      await shell.evaluate(({ids,name})=>window.novaBrowser.groupTabs(ids,{name}),{ids,name:section.name});
    }
    const data=await shell.evaluate(()=>window.novaBrowser.getTabs());
    await shell.evaluate(id=>window.novaBrowser.activateTab(id),data.tabs.find(tab=>tab.isStartPage).id);
    await shell.locator('#cosmos-tab').click();
    await until(async()=>await shell.locator('#cosmos .star-label').count()>=9);
    await shell.mouse.move(12,90);
    await new Promise(resolve=>setTimeout(resolve,1200));
    await shell.screenshot({path:path.join(output,'constellations.png')});

    await shell.locator('#history-tab').click();
    const dateKey=[yesterday.getFullYear(),String(yesterday.getMonth()+1).padStart(2,'0'),String(yesterday.getDate()).padStart(2,'0')].join('-');
    await shell.locator(`#history .history-date[data-date="${dateKey}"]`).click();
    await until(async()=>await shell.locator('#history .star-label').count()===9);
    await new Promise(resolve=>setTimeout(resolve,500));
    await shell.screenshot({path:path.join(output,'history.png')});

    await shell.locator('#bookmarks-tab').click();
    await until(async()=>await shell.locator('#bookmarks .star-label').count()===9);
    await new Promise(resolve=>setTimeout(resolve,500));
    await shell.screenshot({path:path.join(output,'bookmarks.png')});
    await shell.locator('#bookmarks [data-mode="list"]').click();
    await shell.screenshot({path:path.join(output,'bookmarks-list.png')});
    await shell.locator('#bookmarks .history-close').click();

    await shell.locator('#cosmos-tab').click();
    const first=await shell.evaluate(()=>window.novaBrowser.getTabs().then(data=>data.tabs.find(tab=>!tab.isStartPage)));
    await shell.locator(`.browser-tab[data-tab-id="${first.id}"]`).hover();
    const resource=()=>app.evaluate(async({webContents})=>{
      const contents=webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/tab-resources.html'));
      if(!contents)return null;
      return contents.executeJavaScript('document.getElementById("resource-cpu").textContent');
    });
    await until(async()=>String(await resource()).endsWith('%'));
    const resourceImage=await app.evaluate(async({webContents})=>(await webContents.getAllWebContents().find(contents=>contents.getURL().endsWith('/ui/tab-resources.html')).capturePage()).toDataURL());
    await writeFile(path.join(output,'resources.png'),Buffer.from(resourceImage.split(',')[1],'base64'));
    await shell.mouse.move(12,90);

    await shell.locator('#assistant-reopen').click();
    await shell.locator('#chat-input').fill('group James Webb observations and Exoplanet field notes as Observatory');
    await shell.locator('#chat-input').press('Enter');
    await until(async()=>(await shell.locator('#chat-scroll').textContent()).includes('Observatory'));
    await new Promise(resolve=>setTimeout(resolve,1200));
    await shell.screenshot({path:path.join(output,'assistant.png')});
    await writeFile(path.join(output,'capture-info.json'),JSON.stringify({application:'Nova',viewport:{width:1600,height:1000},content:'Reserved .example demo pages and sample saved browsing data',screenshots:['new-tab','constellations','history','bookmarks','bookmarks-list','resources','assistant']},null,2)+'\n');
    console.log('Captured Nova product views in docs/screenshots/');
  }finally{if(app)await app.close();await rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
