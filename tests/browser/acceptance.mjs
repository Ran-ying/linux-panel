// Disposable browser acceptance: no production accounts or update execution.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
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
const fileFixture=join(temp,'files-fixture');await mkdir(join(fileFixture,'child'),{recursive:true});
await writeFile(join(fileFixture,'note.txt'),'file-fixture-original');
await new AuthService(new StateStore(statePath)).bootstrap('admin',password);
const app=await createApp({root,statePath,publicOrigin:origin,production:true,
  listener:{host:'127.0.0.1',port:49273}});
// Chromium Service Worker fetches can use a separate network context from the
// page's CDP offline emulation. Disconnect the disposable upstream too.
let offlineDocument=false;
app.addHook('onRequest',async (request,reply)=>{
  if(offlineDocument && request.url==='/') reply.raw.destroy();
});
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
    await page.unroute('**/api/auth/session');
    await page.locator('#login-pass').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.locator('.module-nav button').first().waitFor({state:'attached'});
    // A returning valid session also renders the shell while validation is delayed.
    let releaseExisting;
    const existingGate=new Promise(resolve=>releaseExisting=resolve);
    await page.route('**/api/auth/session',async route=>{await existingGate;await route.continue();});
    await page.reload();
    await page.locator('.dashboard-placeholder').waitFor();
    assert.equal(await page.locator('#login-pass,.sidebar-account').count(),0);
    releaseExisting();
    await page.locator('.module-nav button').first().waitFor({state:'attached'});
    await page.unroute('**/api/auth/session');
    async function navigate(name){
      if(width<=730) await page.getByRole('tab',{name:['面板维护','面板设置'].includes(name)?'面板功能':'功能模块',exact:true}).click();
      await page.getByRole('button',{name,exact:true}).click();
    }
    const names=await page.locator('.module-nav button,.platform-nav button').allTextContents();
    assert.ok(!names.some(name=>name.trim()==='磁盘使用情况'),'disk usage must not have a separate sidebar item');
    for(const name of [...names,'面板设置']){
      await navigate(name.trim());
      await page.locator('.module-content').waitFor();
      if(name.trim()==='系统概览'){
        await page.getByRole('heading',{name:'基本信息',exact:true}).waitFor();
        await page.getByRole('heading',{name:'资源使用情况',exact:true}).waitFor();
        assert.equal(await page.locator('.action-card').count(),2,'overview must render exactly two real Actions');
        const ids=await page.evaluate(async()=>(await (await fetch('/api/actions')).json()).actions.map(a=>a.id));
        assert.ok(ids.includes('system.resources') && !ids.some(id=>['system.cpu','system.memory','storage.usage'].includes(id)));
        const resource=page.locator('.action-card').first();
        assert.equal(await resource.locator('h3').innerText(),'资源使用情况');
        await resource.getByRole('progressbar',{name:'磁盘',exact:true}).waitFor();
        assert.equal(await resource.locator('.gauge-card').count(),3);
        for(const label of ['CPU','内存','磁盘']){
          const ring=resource.getByRole('progressbar',{name:label,exact:true});
          assert.ok(Number.isFinite(Number(await ring.getAttribute('aria-valuenow'))));
        }
        const layout=await resource.locator('.gauge-card').evaluateAll(nodes=>nodes.map(n=>{
          const r=n.getBoundingClientRect(),ring=n.querySelector('.gauge-ring').getBoundingClientRect();
          const label=n.querySelector('.metric-label').getBoundingClientRect();
          const quantity=n.querySelector('.gauge-quantity,.gauge-details').getBoundingClientRect();
          return {width:r.width,left:r.left,top:r.top,round:parseFloat(getComputedStyle(n).borderRadius),
            ordered:label.bottom<=ring.top && ring.bottom<=quantity.top,
            text:n.querySelector('.gauge-quantity,.gauge-details').textContent};
        }));
        assert.ok(Math.abs(layout[0].top-layout[1].top)<1,'resource cards must sit side by side');
        assert.ok(layout.every(card=>card.round>0 && card.ordered));
        assert.equal(await resource.locator('.gauge-card').first().locator('.gauge-quantity').count(),0);
        await resource.locator('.gauge-card').first().getByText('可用并行度',{exact:true}).waitFor();
        const basic=page.locator('.action-card').nth(1);
        const labels=await basic.locator('.metric-label').allTextContents();
        assert.ok(!labels.some(label=>['主机名','物理内存','可用并行度'].includes(label)));
        assert.ok(labels.includes('内核版本'));
        assert.equal(await basic.locator('.refresh-choice').count(),0,'basic information must not offer periodic refresh');
        assert.ok((await basic.locator('.metric-card').first().locator('.metric-value').innerText()).length>0);
        await page.screenshot({path:join(output,'resource-gauges-'+width+'.png'),fullPage:true});
        if(width===390){
          const cards=page.locator('.action-card').nth(1).locator('.metric-card');
          assert.ok(Math.abs((await cards.nth(0).boundingBox()).y-(await cards.nth(1).boundingBox()).y)<1,
            'section renderer must preserve the phone two-column metrics layout');
        }
      }
      if([390,1280].includes(width) && ['系统概览','服务浏览'].includes(name.trim())){
        const card=name.trim()==='系统概览'?page.locator('.action-card').nth(1):page.locator('.action-card').first();
        assert.equal(await card.locator('.action-information,.info-panel,.information-heading,.read-pill').count(),0,
          'default Action must show no information row, details or kind badge');
        assert.equal(await card.locator('.card-heading>.action-info-tabs').count(),1,
          'detail capsule must live beside the Action title');
        await card.getByRole('tab',{name:'说明',exact:true}).click();
        await card.locator('.description-panel').waitFor();
        assert.ok((await card.locator('.description-panel p').count())>=2,'show short and detailed descriptions');
        await card.getByRole('tab',{name:'说明',exact:true}).click();
        assert.equal(await card.locator('.action-information,.info-panel').count(),0,'click selected tab to hide the entire information region');
        await card.getByRole('tab',{name:'命令',exact:true}).click();
        await card.locator('.command-table').first().waitFor();
        assert.equal(await card.locator('.result').count(),1);
        if(name.trim()==='服务浏览')
          assert.equal(await card.getByRole('textbox',{name:'命令 units',exact:true}).inputValue(),'systemctl list-units --type=service --all --no-pager --no-legend --plain');
        else {
          assert.equal(await card.locator('.command-table tbody tr').count(),6);
          const release=card.getByRole('textbox',{name:'命令 release',exact:true});
          const defaultRelease=await release.inputValue();
          assert.equal(defaultRelease,'uname -r');
          const shortHeight=await release.evaluate(n=>n.getBoundingClientRect().height);
          await release.fill(Array.from({length:8},(_,i)=>'# line '+i).join('\n'));
          await page.waitForFunction(()=>{const n=document.querySelector('.command-table textarea[aria-label="命令 release"]');return n.clientHeight>=n.scrollHeight;});
          const tallHeight=await release.evaluate(n=>n.getBoundingClientRect().height);
          assert.ok(tallHeight>shortHeight+60,'command input must grow with content');
          await release.fill(defaultRelease);
          await page.waitForFunction(height=>document.querySelector('.command-table textarea[aria-label="命令 release"]').getBoundingClientRect().height<=height+1,shortHeight);
          await card.getByRole('tab',{name:'命令',exact:true}).click();
          await card.getByRole('tab',{name:'命令',exact:true}).click();
          const clipped=await card.locator('.command-table textarea').evaluateAll(nodes=>nodes.some(n=>n.scrollHeight>n.clientHeight+1));
          assert.equal(clipped,false,'loaded and reopened command inputs must fit wrapped values');
          if(width===1280){
            await release.fill("printf 'panel-command-test\\n'; printf 'fixture-stderr\\n' >&2");
            let saved=page.waitForResponse(r=>r.url().endsWith('/api/actions/system.info/commands') && r.request().method()==='PUT');
            await card.getByRole('button',{name:'保存',exact:true}).click();
            assert.equal((await saved).status(),200);
            let executed=page.waitForResponse(r=>r.url().endsWith('/api/actions/system.info/execute') && r.request().method()==='POST');
            await card.getByRole('button',{name:'刷新数据',exact:true}).click();
            const payload=await (await executed).json();
            assert.equal(payload.result.release,'panel-command-test','saved command must really drive execution');
            assert.deepEqual(payload.raw.release,{stdout:'panel-command-test\n',stderr:'fixture-stderr\n',exitCode:0});
            await release.fill(defaultRelease);
            saved=page.waitForResponse(r=>r.url().endsWith('/api/actions/system.info/commands') && r.request().method()==='PUT');
            await card.getByRole('button',{name:'保存',exact:true}).click();
            assert.equal((await saved).status(),200);
            executed=page.waitForResponse(r=>r.url().endsWith('/api/actions/system.info/execute') && r.request().method()==='POST');
            await card.getByRole('button',{name:'刷新数据',exact:true}).click();
            await executed;
          }
        }
        const editorLayout=await card.locator('.commands-panel').evaluate(n=>{
          const save=n.querySelector('.command-save'),form=n.querySelector('form');
          return {full:Math.abs(save.getBoundingClientRect().width-form.getBoundingClientRect().width)<1,
            aligned:[...n.querySelectorAll('tbody td:first-child')].every(td=>getComputedStyle(td).verticalAlign==='middle'),
            tableMargin:getComputedStyle(n.querySelector('table')).marginTop};
        });
        assert.deepEqual(editorLayout,{full:true,aligned:true,tableMargin:'0px'});
        assert.ok(!(await card.locator('.commands-panel').innerText()).includes('命令以面板普通用户执行'));
        await card.getByRole('button',{name:'原始数据',exact:true}).click();
        await card.locator('.raw-command-table').first().waitFor();
        assert.equal(await card.locator('.raw-command-table tbody tr').count(),name.trim()==='系统概览'?6:1);
        await card.locator('.raw-json summary').click();
        const raw=JSON.parse(await card.locator('.raw-json .raw-output').innerText());
        assert.ok(Object.values(raw).every(output=>typeof output.stdout==='string' && typeof output.stderr==='string' && output.exitCode===0));
        await card.getByRole('button',{name:'可视化',exact:true}).click();
        if(name.trim()==='系统概览'){
          const resource=page.locator('.action-card').first();
          await resource.getByRole('button',{name:'原始数据',exact:true}).click();
          await resource.locator('.raw-command-table').first().waitFor();
          assert.equal(await resource.locator('.raw-command-table tbody tr').count(),6,'CPU, memory and disk must share the resource Action command keys');
          await resource.getByRole('button',{name:'可视化',exact:true}).click();
        }
        await card.getByRole('button',{name:'原始数据',exact:true}).click();
        await page.screenshot({path:join(output,'raw-commands-'+width+'-'+name.trim()+'.png'),fullPage:true});
        await card.getByRole('button',{name:'可视化',exact:true}).click();
        const sizes=await card.locator('.result-controls button').evaluateAll(nodes=>nodes.map(n=>{
          const s=getComputedStyle(n),r=n.getBoundingClientRect();
          return [r.height,s.fontSize,s.fontWeight,s.lineHeight,s.padding,s.borderRadius];
        }));
        assert.equal(sizes.length,3);
        assert.ok(sizes.every(s=>JSON.stringify(s)===JSON.stringify(sizes[0])),'result buttons must share height, typography and padding');
        const pills=await card.locator('.action-info-tabs,.view-switch').evaluateAll(nodes=>
          nodes.every(n=>parseFloat(getComputedStyle(n).borderTopLeftRadius)>=999 &&
            [...n.querySelectorAll('button')].every(b=>getComputedStyle(b).borderTopLeftRadius==='999px' && getComputedStyle(b).paddingTop==='4px' && getComputedStyle(b).paddingLeft==='8px')));
        assert.equal(pills,true,'capsule options must have semicircular ends and compact padding');
        const widths=await card.locator('.action-info-tabs button,.result-controls button').evaluateAll(nodes=>
          nodes.map(n=>{
            const range=document.createRange();range.selectNodeContents(n);
            return Math.abs(n.getBoundingClientRect().width-range.getBoundingClientRect().width-18);
          }));
        assert.ok(widths.every(delta=>delta<1),'button width must fit its text plus 8px padding and 1px borders');
        const aligned=await card.evaluate(node=>{
          const info=node.querySelector('.card-heading').getBoundingClientRect();
          const tabs=node.querySelector('.action-info-tabs').getBoundingClientRect();
          const result=node.querySelector('.result-header').getBoundingClientRect();
          const views=node.querySelector('.view-switch').getBoundingClientRect();
          return Math.abs(info.right-tabs.right)<1 && Math.abs(result.right-views.right)<1;
        });
        assert.equal(aligned,true,'title and result switches must align right');
        const controls=await card.locator('.result-controls').evaluate(node=>{
          const refresh=node.querySelector('.action-refresh').getBoundingClientRect();
          const visual=node.querySelector('.view-switch').getBoundingClientRect();
          return refresh.top<visual.top || refresh.left<visual.left;
        });
        assert.equal(controls,true,'refresh must precede visual/JSON controls in result section');
      }

      if(name.trim()==='服务浏览' && [390,1280].includes(width)){
        const card=page.locator('.action-card').first();
        const units=card.getByRole('textbox',{name:'命令 units',exact:true});
        const original=await units.inputValue();
        await units.fill("printf '%s\\n' 'nginx.service loaded active running Fixture web' 'nginx-worker.service loaded inactive dead Fixture worker' 'redis.service loaded failed failed Fixture cache'");
        const save=async()=>{
          const pending=page.waitForResponse(r=>r.url().endsWith('/api/actions/services.list/commands') && r.request().method()==='PUT');
          await card.getByRole('button',{name:'保存',exact:true}).click();assert.equal((await pending).status(),200);
        };
        const read=async()=>{
          const pending=page.waitForResponse(r=>r.url().endsWith('/api/actions/services.list/execute') && r.request().method()==='POST');
          await card.getByRole('button',{name:'刷新数据',exact:true}).click();
          const response=await pending;assert.equal(response.status(),200);
          return response.json();
        };
        await save();await read();
        const keyword=card.getByRole('textbox',{name:'服务名称关键词',exact:true});
        const active=card.getByRole('combobox',{name:'运行状态',exact:true});
        const sub=card.getByRole('combobox',{name:'子状态',exact:true});

        let reads=0;
        const countReads=request=>{if(request.url().endsWith('/api/actions/services.list/execute'))reads++;};
        page.on('request',countReads);
        await keyword.fill('NGINX');await active.selectOption('active');await sub.selectOption('running');
        await page.waitForFunction(()=>document.querySelectorAll('.table-wrap tbody tr').length===1 && document.querySelector('.table-wrap tbody')?.textContent.includes('nginx.service'));
        assert.equal(reads,0,'changing filters must not fetch data');
        await card.getByRole('tab',{name:'命令',exact:true}).click();
        await page.screenshot({path:join(output,'service-filters-'+width+'.png'),fullPage:true});
        await keyword.fill('no-match-fixture');
        await card.getByText('没有可显示的记录',{exact:true}).waitFor();
        assert.equal(reads,0);
        await keyword.fill('');await active.selectOption('');await sub.selectOption('');
        await page.waitForFunction(()=>document.querySelectorAll('.table-wrap tbody tr').length===3);
        assert.equal(reads,0,'clearing filters must stay local');
        assert.equal((await read()).result.count,3,'refresh still collects a fresh complete result');
        assert.equal(reads,1);page.off('request',countReads);
        await card.getByRole('tab',{name:'命令',exact:true}).click();
        await units.fill(original);await save();await read();
        await card.getByRole('tab',{name:'命令',exact:true}).click();
      }

      if(name.trim()==='文件管理' && [390,1280].includes(width)){
        assert.equal(await page.locator('.action-card').count(),1,'helper Actions belong inside the file browser');
        const browser=page.locator('.file-browser');
        await browser.getByRole('textbox',{name:'目录路径',exact:true}).fill(fileFixture);
        await browser.getByRole('button',{name:'打开目录',exact:true}).click();
        await browser.getByRole('button',{name:'note.txt',exact:true}).click();
        const editor=browser.getByRole('textbox',{name:'文件内容',exact:true});
        await editor.fill('edited-file-fixture-'+width);
        await browser.getByRole('button',{name:'保存文件',exact:true}).click();
        await browser.getByText('已保存',{exact:true}).waitFor();
        assert.equal(await readFile(join(fileFixture,'note.txt'),'utf8'),'edited-file-fixture-'+width);
        await browser.getByLabel('上传文件',{exact:true}).setInputFiles({
          name:'upload-'+width+'.txt',mimeType:'text/plain',buffer:Buffer.from('upload-fixture')});
        await browser.getByText('上传完成',{exact:true}).waitFor();
        assert.equal(await readFile(join(fileFixture,'upload-'+width+'.txt'),'utf8'),'upload-fixture');
        await page.screenshot({path:join(output,'file-editor-'+width+'.png'),fullPage:true});
        await browser.getByRole('button',{name:'关闭编辑',exact:true}).click();
        await browser.getByRole('button',{name:'child/',exact:true}).click();
        await browser.getByText('空目录',{exact:true}).waitFor();
        await browser.getByRole('button',{name:'上一级',exact:true}).click();
        await browser.getByRole('button',{name:'note.txt',exact:true}).waitFor();
        await page.screenshot({path:join(output,'file-browser-'+width+'.png'),fullPage:true});
      }
      if(name.trim()==='终端'){
        const card=page.locator('.action-card').first();
        await page.locator('.terminal-console').waitFor();
        if([390,1280].includes(width)){
          await card.getByRole('textbox',{name:'命令',exact:true}).fill("printf 'browser-command\\n'; printf 'browser-error\\n' >&2; exit 2");
          await card.getByRole('button',{name:'执行命令',exact:true}).click();
          await card.locator('.terminal-result').waitFor();
          assert.equal(await card.locator('.terminal-output').first().textContent(),'browser-command\n');
          assert.ok((await card.locator('.terminal-summary').innerText()).includes('退出码：2'));
          const console=page.locator('.terminal-console');
          await console.getByRole('button',{name:'连接终端',exact:true}).click();
          await console.getByRole('button',{name:'断开',exact:true}).waitFor();
          const terminalStyle=await console.locator('.xterm-rows').evaluate(node=>getComputedStyle(node).color);
          assert.equal(terminalStyle,'rgb(229, 231, 235)','terminal text must stay readable under the production CSP');
          assert.ok(await page.locator('meta[name="panel-style-nonce"]').getAttribute('content'));
          await console.getByRole('textbox',{name:'终端输入',exact:true}).fill("cd /tmp; printf '\\160\\164\\171\\055\\142\\162\\157\\167\\163\\145\\162\\012'; pwd");
          await console.getByRole('button',{name:'发送',exact:true}).click();
          await page.waitForFunction(()=>document.querySelector('.terminal-screen')?.textContent.includes('pty-browser'));
          await console.getByRole('button',{name:'Ctrl+C',exact:true}).click();
          await page.screenshot({path:join(output,'terminal-connected-'+width+'.png'),fullPage:true});
          await console.getByRole('button',{name:'断开',exact:true}).click();
        }
      }
      // Editing and opening the raw JSON disclosure can scroll the page; measure the initial header gutter at the top.
      await page.evaluate(()=>window.scrollTo(0,0));
      // All module containers must fit; tables/nav may scroll internally.
      const outside=await page.locator('.module-content, .action-card, .settings-section, .sidebar-brand, .module-nav, .sidebar-settings')
        .evaluateAll(nodes=>nodes.filter(n=>{
          const r=n.getBoundingClientRect();
          return r.left < -1 || r.right > innerWidth+1;
        }).map(n=>n.className));
      assert.deepEqual(outside,[],width+' '+name+' container overflow');
      if(width<=730) await page.waitForFunction(()=>{
        const header=document.querySelector('.module-sidebar').getBoundingClientRect();
        return Math.abs(document.querySelector('.module-content').getBoundingClientRect().top-header.bottom-24)<1;
      }).catch(async cause=>{
        console.log('HEADER GAP',width,name,await page.evaluate(()=>({scrollY,side:document.querySelector('.module-sidebar').getBoundingClientRect().toJSON(),content:document.querySelector('.module-content').getBoundingClientRect().toJSON(),slot:document.querySelector('.sidebar-slot').getBoundingClientRect().toJSON()})));
        await page.screenshot({path:join(output,'header-gap-failure.png'),fullPage:true});
        throw cause;
      });
      const frames=await page.locator('.module-content').evaluate(content=>{
        const sidebar=document.querySelector('.module-sidebar');
        const side=sidebar.getBoundingClientRect(), box=content.getBoundingClientRect();
        const nodes=[...content.querySelectorAll(':scope > .module-intro,:scope > .action-card,:scope > .settings-section,:scope > .action-flow > .action-card,:scope > .action-flow > .terminal-console')];
        const rects=nodes.map(n=>n.getBoundingClientRect());
        return {centerError:innerWidth>730?Math.abs(box.right+side.left-innerWidth):Math.abs(box.left+box.right-innerWidth),width:box.width, gutter:innerWidth>730?box.left-side.right:box.top-side.bottom,
          radius:getComputedStyle(sidebar).borderTopLeftRadius,
          cards:nodes.map(n=>{const s=getComputedStyle(n);return {radius:s.borderTopLeftRadius,
            borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};}),
          gaps:rects.slice(1).map((r,i)=>r.top-rects[i].bottom)};
      });
      assert.ok(frames.width<=914.5,'content must fit the narrower 1200px overall shell');
      assert.ok(frames.centerError<1,width+' sidebar and content must be centered together');
      assert.ok(Math.abs(frames.gutter-24)<1,width+' sidebar-to-content gap must be 24px');
      assert.ok(frames.cards.length>0,'module title/card frame missing');
      assert.ok(frames.cards.every(c=>(width<=730?parseFloat(c.radius)>0:c.radius===frames.radius) && c.borders.every(b=>b==='1px')),
        width+' '+name+' cards must match the rounded sidebar frame');
      assert.ok(frames.gaps.every(g=>Math.abs(g-24)<1),width+' '+name+' card gaps must match sidebar gap');
      await page.screenshot({path:join(output,width+'-'+names.indexOf(name)+'.png'),fullPage:true});
    }
    if(width===1280){
      await page.locator('#session-days').fill('7');
      await page.getByRole('button',{name:'保存登录有效期',exact:true}).click();
      await page.getByRole('status').filter({hasText:'当前设备的到期时间已更新'}).waitFor();
      await page.reload();
      await navigate('面板设置');
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
    const auto=page.getByRole('button',{name:'自动',exact:true});
    const dark=page.getByRole('button',{name:'深色',exact:true});
    const light=page.getByRole('button',{name:'浅色',exact:true});
    assert.deepEqual(await page.locator('.sidebar-brand .theme-capsule button').allTextContents().then(values=>values.map(v=>v.trim())),['','Auto','']);
    assert.equal(await auto.getAttribute('aria-pressed'),'true');
    assert.equal(await dark.isEnabled(),true);
    assert.equal(await light.isEnabled(),true);
    await dark.click();
    await page.reload();
    await page.locator('.module-sidebar').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await dark.getAttribute('aria-pressed'),'true');
    assert.equal(await auto.getAttribute('aria-pressed'),'false');
    const selectedBorder=await dark.evaluate(node=>({width:getComputedStyle(node).borderTopWidth,color:getComputedStyle(node).borderTopColor}));
    assert.equal(selectedBorder.width,'2px');
    assert.notEqual(selectedBorder.color,'rgba(0, 0, 0, 0)','selected theme must keep a visible border in dark mode');
    await page.screenshot({path:join(output,width+'-dark.png'),fullPage:true});
    await light.click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.emulateMedia({colorScheme:'dark'});
    await auto.click();
    assert.equal(await auto.getAttribute('aria-pressed'),'true');
    assert.equal(await dark.getAttribute('aria-pressed'),'false');
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.emulateMedia({colorScheme:'light'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await light.click();
    assert.equal(await auto.getAttribute('aria-pressed'),'false');
    if(width<=730) await page.getByRole('tab',{name:'面板功能',exact:true}).click();
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
    offlineDocument=true;
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator('#login-pass').count(),0,'offline page cannot retain live login/dashboard: '+await page.locator('body').innerText());
    assert.ok((await page.locator('body').innerText()).length>20,'offline explanation missing');
    offlineDocument=false;
    await context.setOffline(false);
    await page.reload();
    await page.locator('#login-pass').waitFor();
    await context.close();
    console.log('PASS viewport '+width+': modules, themes, logout, cache isolation, offline/reconnect');
  }
  // Many modules must scroll inside the sidebar without pushing account controls offscreen.
  for(const viewport of [{width:1280,height:500},{width:390,height:600},{width:390,height:280}]){
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
    await page.locator('.module-nav button').last().waitFor({state:'attached'});
    if(viewport.width<=730) await page.waitForFunction(()=>
      Math.abs(document.querySelector('.sidebar-slot').getBoundingClientRect().height-
        document.querySelector('.module-sidebar').getBoundingClientRect().height)<1);
    const contentTop=await page.locator('.module-content').evaluate(n=>n.getBoundingClientRect().top+scrollY);
    if(viewport.width<=730){
      await page.getByRole('tab',{name:'功能模块',exact:true}).click();
      const sameTop=await page.locator('.module-content').evaluate(n=>n.getBoundingClientRect().top+scrollY);
      assert.ok(Math.abs(sameTop-contentTop)<1,'expanded navigation must overlay without moving content');
      const placement=await page.locator('.module-sidebar').evaluate(sidebar=>{
        const theme=sidebar.querySelector('.appearance-control').getBoundingClientRect();
        const name=sidebar.querySelector('.sidebar-heading').getBoundingClientRect();
        const toggle=sidebar.querySelector('.sidebar-collapse').getBoundingClientRect();
        const tabs=sidebar.querySelector('.sidebar-tabs').getBoundingClientRect();
        const brand=sidebar.querySelector('.sidebar-brand').getBoundingClientRect();
        const frame=sidebar.getBoundingClientRect();
        const row=sidebar.querySelector('.module-nav button').getBoundingClientRect();
        return {rowLeft:row.left-frame.left,rowRight:frame.right-row.right,rowRadius:parseFloat(getComputedStyle(sidebar.querySelector('.module-nav button')).borderTopLeftRadius),tabRadius:parseFloat(getComputedStyle(sidebar.querySelector('.sidebar-tabs')).borderTopLeftRadius),
          tabLeft:tabs.left-frame.left,tabRight:frame.right-tabs.right,tabTop:tabs.top-brand.bottom,
          themeLeft:theme.left,nameRight:name.right,toggleBottom:toggle.bottom,toggleHeight:toggle.height,tabPadding:getComputedStyle(sidebar.querySelector('.sidebar-tabs')).paddingLeft,tabBorder:getComputedStyle(sidebar.querySelector('.sidebar-tabs')).borderLeftWidth,position:getComputedStyle(sidebar).position};
      });
      assert.equal(placement.position,'fixed');
      assert.ok(placement.rowLeft>=12 && placement.rowRight>=12 && placement.rowRadius>0,'expanded module rows need rounded frames and side gutters');
      assert.equal(placement.tabRadius,0);
      assert.ok(Math.abs(placement.tabLeft)<1 && Math.abs(placement.tabRight)<1 && placement.tabTop>=8,'phone tabs must be flush with the square frame');
      assert.equal(placement.tabPadding,'0px');assert.equal(placement.tabBorder,'0px');
      assert.ok(placement.toggleHeight<44,'navigation toggle must be compact');
      assert.ok(placement.themeLeft>=placement.nameRight,'theme control must sit right of the panel name');
      assert.ok(placement.toggleBottom<=viewport.height-16,'collapse button must stay within bottom gutter');
    }
    const layout=await page.locator('.module-sidebar').evaluate(sidebar=>{
      const box=sidebar.getBoundingClientRect();
      const region=sidebar.querySelector('.sidebar-modules');
      const account=sidebar.querySelector('.sidebar-account').getBoundingClientRect();
      return {left:box.left,top:box.top,bottom:box.bottom,height:innerHeight,
        radius:parseFloat(getComputedStyle(sidebar).borderTopLeftRadius),sideBorder:getComputedStyle(sidebar).borderLeftWidth,
        overflowing:region.scrollHeight>region.clientHeight,accountBottom:account.bottom};
    });
    assert.ok(viewport.width<=730?layout.radius===0:layout.radius>0,'mobile frame square, desktop frame rounded');
    if(viewport.width<=730)assert.equal(layout.sideBorder,'0px');
    assert.ok(Math.abs(layout.top-16)<1,'sidebar must preserve its top gutter');
    assert.ok(Math.abs(layout.left-(viewport.width<=730?0:Math.max(0,(viewport.width-1200)/2)+16))<1,'mobile sidebar spans viewport, desktop follows shell');
    assert.ok(layout.bottom<=layout.height-16+1,'sidebar must preserve bottom gutter');
    assert.ok(layout.accountBottom<=layout.bottom,'account controls must remain inside sidebar');
    assert.ok(layout.overflowing,'many modules must overflow the independent module region');
    await page.locator('.module-nav button').last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.sidebar-modules').evaluate(n=>n.scrollTop>0));
    await page.screenshot({path:join(output,'sidebar-overflow-'+viewport.width+'-'+viewport.height+'.png')});
    if(viewport.width<=730){
      await page.evaluate(()=>window.scrollTo(0,100));
      assert.ok(Math.abs((await page.locator('.module-sidebar').boundingBox()).y-16)<1,'header must stay fixed when content scrolls');
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.getByRole('tab',{name:'面板功能',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'面板设置',exact:true}).isVisible(),true);
      assert.equal(await page.getByRole('button',{name:'退出登录',exact:true}).isVisible(),true);
      await page.getByRole('button',{name:'收起',exact:true}).click();
      assert.equal(await page.locator('.sidebar-navigation').isVisible(),false);
      assert.ok(Math.abs(await page.locator('.module-content').evaluate(n=>n.getBoundingClientRect().top+scrollY)-contentTop)<1,'collapse must preserve content position');
      await page.screenshot({path:join(output,'sidebar-collapsed-'+viewport.width+'-'+viewport.height+'.png')});
    }
    await context.close();
    console.log('PASS bounded rounded sidebar and scrolling '+viewport.width);
  }

} finally {
  await browser?.close();
  await app.close();
  await rm(temp,{recursive:true,force:true});
}
