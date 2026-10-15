// Disposable browser acceptance: no production accounts or update execution.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createApp} from '../../apps/api/src/create-app.js';
import {StateStore} from '../../platform/state-store.js';
import {AuthService} from '../../platform/auth/service.js';

const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(join(tmpdir(),'panel-browser-'));
const statePath=join(temp,'state.json');
const password=randomBytes(32).toString('hex');
const origin='http://127.0.0.1:49273';
const output=process.env.PANEL_BROWSER_OUTPUT || join(temp,'screenshots');
await mkdir(output,{recursive:true});
await new AuthService(new StateStore(statePath)).bootstrap('admin',password);
const app=await createApp({root,statePath,publicOrigin:origin,production:true,
  listener:{host:'127.0.0.1',port:49273}});
let browser;
try {
  await app.listen({host:'127.0.0.1',port:49273});
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,730,1280,1920]){
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let releaseAuth;
    const authGate=new Promise(resolve=>releaseAuth=resolve);
    await page.route('**/api/auth/session',async route=>{await authGate;await route.continue();});
    const navigation=page.goto(origin);
    await page.locator('.layout .dashboard-placeholder').waitFor();
    assert.equal(await page.locator('.module-sidebar').count(),1,'main shell must render before session response');
    assert.equal(await page.locator('.auth-shell').count(),0,'no blocking auth-check screen');
    assert.equal(await page.locator('#login-pass').count(),0,'do not flash login while checking in background');
    assert.equal(await page.locator('.sidebar-account').count(),0,'pending shell must not display private account data');
    releaseAuth();
    await navigation;
    await page.unroute('**/api/auth/status');
    await page.locator('#login-pass').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.locator('.module-nav button').first().waitFor();
    // A returning valid session also renders the shell while validation is delayed.
    let releaseExisting;
    const existingGate=new Promise(resolve=>releaseExisting=resolve);
    await page.route('**/api/auth/session',async route=>{await existingGate;await route.continue();});
    await page.reload();
    await page.locator('.dashboard-placeholder').waitFor();
    assert.equal(await page.locator('#login-pass,.sidebar-account').count(),0);
    releaseExisting();
    await page.locator('.module-nav button').first().waitFor();
    await page.unroute('**/api/auth/session');
    const names=await page.locator('.module-nav button,.platform-nav button').allTextContents();
    for(const name of [...names,'面板设置']){
      await page.getByRole('button',{name:name.trim(),exact:true}).click();
      await page.locator('.module-content').waitFor();
      // All module containers must fit; tables/nav may scroll internally.
      const outside=await page.locator('.module-content, .action-card, .settings-section, .sidebar-brand, .module-nav, .sidebar-settings')
        .evaluateAll(nodes=>nodes.filter(n=>{
          const r=n.getBoundingClientRect();
          return r.left < -1 || r.right > innerWidth+1;
        }).map(n=>n.className));
      assert.deepEqual(outside,[],width+' '+name+' container overflow');
      const frames=await page.locator('.module-content').evaluate(content=>{
        const sidebar=document.querySelector('.module-sidebar');
        const side=sidebar.getBoundingClientRect(), box=content.getBoundingClientRect();
        const nodes=[...content.querySelectorAll(':scope > .module-intro,:scope > .action-card,:scope > .settings-section,:scope > .action-flow > .action-card')];
        const rects=nodes.map(n=>n.getBoundingClientRect());
        return {centerError:Math.abs(box.right+side.left-innerWidth),width:box.width, gutter:innerWidth>730?box.left-side.right:box.top-side.bottom,
          radius:getComputedStyle(sidebar).borderTopLeftRadius,
          cards:nodes.map(n=>{const s=getComputedStyle(n);return {radius:s.borderTopLeftRadius,
            borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};}),
          gaps:rects.slice(1).map((r,i)=>r.top-rects[i].bottom)};
      });
      assert.ok(frames.width<=914.5,'content must fit the narrower 1200px overall shell');
      assert.ok(frames.centerError<1,width+' sidebar and content must be centered together');
      assert.ok(Math.abs(frames.gutter-24)<1,width+' sidebar-to-content gap must be 24px');
      assert.ok(frames.cards.length>0,'module title/card frame missing');
      assert.ok(frames.cards.every(c=>c.radius===frames.radius && c.borders.every(b=>b==='1px')),
        width+' '+name+' cards must match the rounded sidebar frame');
      assert.ok(frames.gaps.every(g=>Math.abs(g-24)<1),width+' '+name+' card gaps must match sidebar gap');
      await page.screenshot({path:join(output,width+'-'+names.indexOf(name)+'.png'),fullPage:true});
    }
    if(width===1280){
      await page.locator('#session-days').fill('7');
      await page.getByRole('button',{name:'保存登录有效期',exact:true}).click();
      await page.getByRole('status').filter({hasText:'当前设备的到期时间已更新'}).waitFor();
      await page.reload();
      await page.getByRole('button',{name:'面板设置',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#session-days')?.value==='7');
      const cookie=(await context.cookies()).find(c=>c.name==='lp_session');
      assert.ok(Math.abs(cookie.expires-Date.now()/1000-7*86400)<10,'browser cookie must use saved duration');
      await page.locator('#session-days').fill('30');
      await page.getByRole('button',{name:'保存登录有效期',exact:true}).click();
      await page.getByRole('status').filter({hasText:'当前设备的到期时间已更新'}).waitFor();
    }
    // Sidebar grouping, account placement and appearance controls remain intact.
    assert.equal(await page.locator('.sidebar-settings .sidebar-account').count(),1);
    assert.equal(await page.locator('footer').count(),0);
    assert.equal(await page.locator('.sidebar-heading .panel-version').count(),1);
    assert.equal(await page.locator('.module-nav button').filter({hasText:'面板维护'}).count(),0);
    assert.equal(await page.locator('.platform-nav button').filter({hasText:'面板维护'}).count(),1);
    const follow=page.getByRole('checkbox',{name:'跟随系统',exact:true});
    const dark=page.getByRole('button',{name:'深色',exact:true});
    const light=page.getByRole('button',{name:'浅色',exact:true});
    assert.equal(await dark.isDisabled(),true);
    assert.equal(await light.isDisabled(),true);
    await follow.uncheck();
    await dark.click();
    await page.reload();
    await page.locator('.module-sidebar').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await follow.isChecked(),false);
    await page.screenshot({path:join(output,width+'-dark.png'),fullPage:true});
    await light.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.emulateMedia({colorScheme:'dark'});
    await follow.check();
    assert.equal(await dark.isDisabled(),true);
    assert.equal(await light.isDisabled(),true);
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.emulateMedia({colorScheme:'light'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await follow.uncheck();
    assert.equal(await light.isDisabled(),false);
    await page.getByRole('button',{name:'退出登录',exact:true}).click();
    await page.locator('#login-pass').waitFor();
    await page.reload();
    await page.locator('#login-pass').waitFor();
    assert.deepEqual(errors,[],width+' uncaught browser errors');

    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await page.reload();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const cached=await page.evaluate(async()=>{
      const result=[];
      for(const name of await caches.keys())
        for(const request of await (await caches.open(name)).keys())
          result.push(new URL(request.url).pathname);
      return result;
    });
    assert.ok(cached.every(p=>p==='/offline.html' || p.startsWith('/icons/') || p.startsWith('/assets/')),
      'private route found in browser cache');
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator('#login-pass').count(),0,'offline page cannot retain live login/dashboard');
    assert.ok((await page.locator('body').innerText()).length>20,'offline explanation missing');
    await context.setOffline(false);
    await page.reload();
    await page.locator('#login-pass').waitFor();
    await context.close();
    console.log('PASS viewport '+width+': modules, themes, logout, cache isolation, offline/reconnect');
  }
  // Many modules must scroll inside the sidebar without pushing account controls offscreen.
  for(const viewport of [{width:1280,height:500},{width:390,height:600}]){
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    await page.route('**/api/modules',async route=>{
      const response=await route.fetch();
      const data=await response.json();
      data.modules.push(...Array.from({length:45},(_,i)=>({id:'fixture-'+i,name:'Fixture module '+i,version:'1.0.0'})));
      await route.fulfill({response,json:data});
    });
    await page.goto(origin);
    await page.locator('#login-pass').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.locator('.module-nav button').last().waitFor();
    const layout=await page.locator('.module-sidebar').evaluate(sidebar=>{
      const box=sidebar.getBoundingClientRect();
      const region=sidebar.querySelector('.sidebar-modules');
      const account=sidebar.querySelector('.sidebar-account').getBoundingClientRect();
      return {left:box.left,top:box.top,bottom:box.bottom,height:innerHeight,
        radius:parseFloat(getComputedStyle(sidebar).borderTopLeftRadius),
        overflowing:region.scrollHeight>region.clientHeight,accountBottom:account.bottom};
    });
    assert.ok(layout.radius>0,'sidebar must keep rounded outer frame');
    assert.ok(Math.abs(layout.top-16)<1,'sidebar must preserve its top gutter');
    assert.ok(Math.abs(layout.left-(Math.max(0,(viewport.width-1200)/2)+16))<1,'sidebar must follow the centered shell');
    assert.ok(layout.bottom<=layout.height-16+1,'sidebar must preserve bottom gutter');
    assert.ok(layout.accountBottom<=layout.bottom,'account controls must remain inside sidebar');
    assert.ok(layout.overflowing,'many modules must overflow the independent module region');
    await page.locator('.module-nav button').last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.sidebar-modules').evaluate(n=>n.scrollTop>0));
    await page.screenshot({path:join(output,'sidebar-overflow-'+viewport.width+'.png')});
    await context.close();
    console.log('PASS bounded rounded sidebar and scrolling '+viewport.width);
  }

} finally {
  await browser?.close();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
