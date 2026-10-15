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
  for(const width of [320,390,730,1280]){
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);
    await page.locator('#login-pass').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.locator('.module-nav button').first().waitFor();
    const names=await page.locator('.module-nav button').allTextContents();
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
      await page.screenshot({path:join(output,width+'-'+names.indexOf(name)+'.png'),fullPage:true});
    }
    // Compact sidebar, bottom-only separators and no card spacing.
    assert.equal(await page.locator('.sidebar-settings .sidebar-account').count(),1);
    assert.equal(await page.locator('footer').count(),0);
    const cardStyles=await page.locator('.action-card,.settings-section').evaluateAll(nodes=>nodes.map(n=>{
      const s=getComputedStyle(n);
      return [s.marginTop,s.marginBottom,s.marginLeft,s.marginRight,s.borderTopWidth,s.borderLeftWidth,s.borderRightWidth];
    }));
    assert.ok(cardStyles.every(values=>values.every(v=>v==='0px')),'cards should be contiguous with bottom borders only');
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
} finally {
  await browser?.close();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
