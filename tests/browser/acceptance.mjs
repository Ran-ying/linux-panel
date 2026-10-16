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
const lockedFixture=join(temp,'readonly-fixture');await mkdir(lockedFixture,{mode:0o555});
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
    // Disposable Cron fixture: run the new generic scheduler UI without any
    // system cron write or privileged socket on the browser CI host.
    let cronJobs=[],cronVersion=0,cronListCalls=0;
    const cronSystemJobs=[
      {id:'system-cron-certbot',sourceType:'cron.d',source:'/etc/cron.d/certbot',
        name:'certbot',owner:'root',expression:'0 */12 * * *',command:'/usr/bin/certbot',
        enabled:true,control:'none',nextRun:'',detail:'fixture'},
      {id:'user-cron-alice',sourceType:'user-crontab',source:'crontab:alice',
        name:'alice',owner:'alice',expression:'0 2 * * *',command:'/usr/bin/true',
        enabled:false,control:'none',nextRun:'',detail:'fixture'},
      {id:'systemd-apt-timer',sourceType:'systemd-timer',source:'apt-daily.timer',
        name:'apt-daily.timer',owner:'systemd',expression:'systemd',command:'apt-daily.service',
        enabled:true,control:'none',nextRun:'2026-10-17T00:00:00Z',detail:'fixture'}
    ];
    const cronRevision=()=>String(cronVersion).padStart(64,'0');
    await page.route('**/api/actions/cron.*/execute',async route=>{
      const id=new URL(route.request().url()).pathname.split('/')[3];
      const input=route.request().postDataJSON()?.input ?? {};
      let result,status=200;
      if(id==='cron.list'){
        cronListCalls++;
        result={tasks:cronJobs,revision:cronRevision(),count:cronJobs.length,
          systemTasks:cronSystemJobs,systemCount:cronSystemJobs.length,systemWarnings:[]};
      }
      else if(input.revision!==cronRevision()){status=409;result={error:'任务已改变'};}
      else if(id==='cron.save'){
        const task={...input.task,id:input.task.id??'00000000-0000-4000-8000-000000000001'};
        const index=cronJobs.findIndex(row=>row.id===task.id);
        if(index>=0)cronJobs[index]=task;else cronJobs.push(task);
        cronVersion++;result={id:task.id,revision:cronRevision()};
      }else if(id==='cron.remove'){
        cronJobs=cronJobs.filter(row=>row.id!==input.id);
        cronVersion++;result={id:input.id,revision:cronRevision()};
      }else{status=404;result={error:'Unknown fixture action'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(
        status===200?{action:id,result}:result)});
    });
    // Disposable Nginx fixture: browser exercises real controls without root writes.
    let nginxSites=[],nginxVersions=0,nginxSyntaxGood=true;
    const nginxToggleActions=[];
    const revision=()=>String(++nginxVersions).padStart(64,'0');
    await page.route('**/api/actions/nginx.*/execute',async route=>{
      const id=new URL(route.request().url()).pathname.split('/')[3];
      const input=route.request().postDataJSON()?.input??{};
      let data,status=200;
      const target=nginxSites.find(site=>site.name===input.name);
      if(id==='nginx.sites')data={source:'fixture',count:nginxSites.length,
        enabledCount:nginxSites.filter(site=>site.enabled==='启用链接').length,
        sites:nginxSites.map(({content,...site})=>site),warnings:[]};
      else if(id==='nginx.check')data={ok:nginxSyntaxGood,status:nginxSyntaxGood?'配置检查通过':'配置检查失败',
        exitCode:nginxSyntaxGood?0:1,output:'fixture -t',identity:'root'};
      else if(id==='nginx.read'){
        if(!target){status=404;data={error:'配置不存在'};}
        else data={name:target.name,content:target.content,revision:target.revision,enabled:target.enabled==='启用链接'};
      }else if(id==='nginx.apply'){
        if(input.operation==='enable'||input.operation==='disable')nginxToggleActions.push(input.operation);
        if(input.operation==='create'){
          if(target){status=409;data={error:'站点已存在'};}
          else{nginxSites.push({name:input.name,location:'sites-available',enabled:'未启用',
            serverNames:'fixture.test, www.fixture.test',listens:'80',file:'/etc/nginx/sites-available/'+input.name,
            editable:true,content:input.content,revision:revision()});}
        }else if(!target||target.revision!==input.revision){status=409;data={error:'版本冲突'};}
        else if(input.operation==='remove')nginxSites=nginxSites.filter(s=>s!==target);
        else{
          if(input.operation==='edit')target.content=input.content;
          if(input.operation==='enable')target.enabled='启用链接';
          if(input.operation==='disable')target.enabled='未启用';
          target.revision=revision();
        }
        if(status===200)data={ok:true,status:'修改成功',revision:target?.revision??'',
          validated:true,reloaded:true,output:'fixture'};
      }else{status=404;data={error:'Unknown action'};}
      await route.fulfill({status,contentType:'application/json',
        body:JSON.stringify(status===200?{action:id,result:data}:data)});
    });
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
    assert.deepEqual(names.slice(0,4).map(name=>name.trim()),['系统概览','服务浏览','终端','文件管理']);
    assert.ok(!names.some(name=>name.trim()==='磁盘使用情况'),'disk usage must not have a separate sidebar item');
    for(const name of [...names,'面板设置']){
      await navigate(name.trim());
      await page.locator('.module-content').waitFor();
      if(name.trim()==='定时任务' && [390,1280].includes(width)){
        const schedule=page.locator('.scheduled-tasks');
        await schedule.getByRole('heading',{name:'Linux Panel 托管的定时任务'}).waitFor();
        const headings=await schedule.locator(':scope > h3.system-title').allTextContents();
        assert.deepEqual(headings,['Linux Panel 托管的定时任务','系统现有定时任务'],
          'managed tasks must appear before existing system tasks');
        const systemTable=schedule.locator('.system-task-table');
        const visibleRows=systemTable.locator('tbody tr');
        const source=systemTable.getByRole('combobox',{name:'按来源筛选'});
        const owner=systemTable.getByRole('combobox',{name:'按执行用户筛选'});
        const status=systemTable.getByRole('combobox',{name:'按任务状态筛选'});
        assert.equal(await visibleRows.count(),3);
        assert.deepEqual(await owner.locator('option').allTextContents(),
          ['全部用户','alice','root','systemd']);
        const callsBeforeFilters=cronListCalls;
        await source.selectOption('user-crontab');
        assert.equal(await visibleRows.count(),1);
        await owner.selectOption('root');
        await systemTable.getByText('该来源没有发现系统任务').waitFor();
        await owner.selectOption('alice');
        assert.equal(await visibleRows.count(),1);
        await status.selectOption('enabled');
        await systemTable.getByText('该来源没有发现系统任务').waitFor();
        await status.selectOption('disabled');
        assert.equal(await visibleRows.count(),1);
        assert.ok((await visibleRows.first().innerText()).includes('alice'));
        await source.selectOption('all');
        await owner.selectOption('all');
        await status.selectOption('all');
        assert.equal(await visibleRows.count(),3);
        assert.equal(cronListCalls,callsBeforeFilters,'dropdown filtering must not refresh backend');
        await page.getByRole('button',{name:'新建任务'}).click();
        const form=page.getByRole('dialog',{name:'新建定时任务'});
        await form.getByRole('textbox',{name:'任务名称'}).fill('Fixture nightly');
        await form.getByRole('textbox',{name:'Cron 表达式'}).fill('0 2 * * *');
        await form.getByRole('textbox',{name:'执行命令'}).fill('/usr/bin/true');
        await form.getByRole('button',{name:'保存'}).click();
        await page.getByText('Fixture nightly').waitFor();
        await page.getByRole('button',{name:'停用 Fixture nightly'}).click();
        await schedule.locator('.task-table:not(.system-task-table)').getByRole('cell',{name:'已停用',exact:true}).waitFor();
        await page.getByRole('button',{name:'删除 Fixture nightly'}).click();
        await page.getByRole('dialog',{name:'删除任务'}).getByRole('button',{name:'删除'}).click();
        await page.getByText('暂无由 Linux Panel 管理的定时任务').waitFor();
      }
      if(name.trim()==='Nginx 网站' && [390,1280].includes(width)){
        const manager=page.locator('.managed-configs');
        assert.equal(await manager.locator('.config-detail-panel').count(),0,
          'the website details pane must be absent before selecting a website');
        assert.equal(await manager.locator('.config-site-list').count(),0,
          'an empty site list should not render an empty row table');
        assert.equal(await manager.locator('.config-table,.config-location').count(),0,
          'old multi-column layout and sites-available indicator must be removed');
        assert.ok(!((await manager.innerText()).includes('状态复选框：勾选为启用')),
          'the old instructional paragraph must be removed');
        await manager.getByRole('button',{name:'新建网站'}).click();
        const editor=page.getByRole('dialog',{name:'新建网站配置'});
        await editor.getByRole('textbox',{name:'配置文件名'}).fill('fixture-site');
        await editor.getByRole('textbox',{name:'Nginx 配置内容'})
          .fill('server { listen 80; server_name fixture.test www.fixture.test; }');
        await editor.getByRole('button',{name:'保存配置'}).click();
        const website=manager.getByRole('button',{name:'查看网站 fixture-site'});
        const enabled=manager.getByRole('checkbox',{name:'启用状态：fixture-site'});
        await enabled.waitFor();
        assert.equal(await enabled.isChecked(),false,'new Nginx site defaults to unchecked');
        assert.equal(await manager.locator('.config-detail-panel').count(),0,
          'new sites are listed on the left without automatically showing details');
        assert.equal(await manager.getByRole('button',{name:'编辑 fixture-site'}).count(),0,
          'edit actions must remain hidden before selecting a website');
        assert.equal(await manager.getByRole('button',{name:'删除 fixture-site'}).count(),0,
          'delete actions must remain hidden before selecting a website');
        const hostnames=await manager.locator('.config-site-row .config-domain').allTextContents();
        assert.deepEqual(hostnames,['fixture.test','www.fixture.test'],
          'each hostname must occupy its own line beneath the configuration name');
        const domainPositions=await manager.locator('.config-site-row .config-domain')
          .evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
        assert.ok(domainPositions[0]<domainPositions[1],
          'each domain should be vertically stacked, not comma-separated on one line');
        assert.equal(await manager.getByText('sites-available',{exact:true}).count(),0,
          'do not display internal config directory labels');
        assert.equal(await manager.getByRole('columnheader',{name:'监听'}).count(),0);
        assert.equal(await manager.getByRole('columnheader',{name:'操作'}).count(),0);
        assert.equal(await manager.getByRole('button',{name:'启用 fixture-site'}).count(),0);
        assert.equal(await manager.getByRole('button',{name:'停用 fixture-site'}).count(),0);
        await website.click();
        const details=manager.locator('.config-detail-panel');
        await details.waitFor();
        assert.equal(await website.getAttribute('aria-pressed'),'true');
        await details.getByRole('button',{name:'编辑 fixture-site'}).click();
        const updated=page.getByRole('dialog',{name:'编辑网站配置'});
        await updated.getByRole('textbox',{name:'Nginx 配置内容'})
          .fill('server { listen 8080; server_name fixture.test www.fixture.test; }');
        await updated.getByRole('button',{name:'保存配置'}).click();
        await details.getByRole('button',{name:'收起'}).click();
        await details.waitFor({state:'detached'});
        assert.equal(await website.getAttribute('aria-pressed'),'false');
        assert.equal(await manager.getByRole('button',{name:'编辑 fixture-site'}).count(),0);
        await website.click();
        await details.waitFor();
        const browserLayout=await manager.locator('.config-browser').evaluate(node=>{
          const list=node.querySelector('.config-list-panel').getBoundingClientRect();
          const detail=node.querySelector('.config-detail-panel').getBoundingClientRect();
          return {list:{right:list.right,bottom:list.bottom},
            detail:{left:detail.left,top:detail.top}};
        });
        if(width===1280)assert.ok(browserLayout.detail.left>browserLayout.list.right-2,
          'details should appear to the right of the site list on desktop');
        else assert.ok(browserLayout.detail.top>=browserLayout.list.bottom-2,
          'details should appear below the list on mobile');
        await enabled.click();
        const enableConfirm=page.getByRole('dialog',{name:'启用网站'});
        await enableConfirm.waitFor();
        assert.equal(await enabled.isChecked(),false,'checkbox cannot switch before confirmation');
        assert.deepEqual(nginxToggleActions,[],'opening confirmation must not submit a state change');
        await enableConfirm.getByRole('button',{name:'取消'}).click();
        await enableConfirm.waitFor({state:'hidden'});
        assert.equal(await enabled.isChecked(),false,'cancel leaves the site disabled');
        assert.deepEqual(nginxToggleActions,[],'cancel must not trigger the Nginx apply Action');
        await enabled.click();
        await enableConfirm.getByRole('button',{name:'确认操作'}).click();
        await enableConfirm.waitFor({state:'hidden'});
        assert.equal(await enabled.isChecked(),true,'confirmed enable checks the box');
        assert.deepEqual(nginxToggleActions,['enable']);
        await enabled.click();
        const disableConfirm=page.getByRole('dialog',{name:'停用网站'});
        await disableConfirm.waitFor();
        assert.equal(await enabled.isChecked(),true,'disabled state must wait for confirmation');
        await disableConfirm.getByRole('button',{name:'取消'}).click();
        await disableConfirm.waitFor({state:'hidden'});
        assert.equal(await enabled.isChecked(),true,'cancel leaves the site enabled');
        assert.deepEqual(nginxToggleActions,['enable']);
        await enabled.click();
        await disableConfirm.getByRole('button',{name:'确认操作'}).click();
        await disableConfirm.waitFor({state:'hidden'});
        assert.equal(await enabled.isChecked(),false,'confirmed disable unchecks the box');
        assert.deepEqual(nginxToggleActions,['enable','disable']);
        assert.equal(await details.count(),1,'selected site details remain visible after an update');
        await manager.getByRole('button',{name:'刷新数据'}).click();
        await details.waitFor();
        assert.equal(await website.getAttribute('aria-pressed'),'true',
          'refresh should not lose the selected website');
        await manager.getByRole('button',{name:'检查 Nginx 配置'}).click();
        await manager.getByText('配置检查通过',{exact:true}).waitFor();
        await details.getByRole('button',{name:'删除 fixture-site'}).click();
        await page.getByRole('dialog',{name:'删除网站配置'})
          .getByRole('button',{name:'确认操作'}).click();
        await manager.getByText('没有找到站点配置文件').waitFor();
        assert.equal(await details.count(),0,'removing the selected site must close the details pane');
        await page.screenshot({path:join(output,'nginx-manager-'+width+'.png'),fullPage:true});
      }
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
        await browser.waitFor();
        const card=page.locator('.action-card');
        assert.equal(await card.locator('.action-info-tabs,.result-header').count(),0,'file browser owns its controls');
        assert.equal(await browser.getByText('目录路径',{exact:true}).count(),0,'path input retains only its accessible label');
        const pathBar=browser.locator('.file-path-bar');
        const items=await pathBar.locator(':scope>button,:scope>input').evaluateAll(nodes=>nodes.map(n=>({
          tag:n.tagName,label:n.textContent,height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top
        })));
        assert.deepEqual(items.map(i=>i.tag),['BUTTON','INPUT','BUTTON']);
        assert.deepEqual(items.filter(i=>i.tag==='BUTTON').map(i=>i.label),['上一级','打开目录']);
        assert.ok(items.every(i=>Math.abs(i.height-items[0].height)<1 && Math.abs(i.top-items[0].top)<1),'three equal-height controls stay on one row');
        assert.deepEqual(await browser.locator('.file-toolbar>button').allTextContents(),['上传文件','新建文件','新建文件夹']);
        assert.equal(await browser.getByText('可将文件拖入此处上传',{exact:true}).count(),0);
        assert.equal(await browser.getByText('文件权限：root',{exact:true}).count(),0);
        const toolbarStyle=await browser.locator('.file-path-bar>button,.file-toolbar>button').evaluateAll(nodes=>nodes.map(node=>{
          const css=getComputedStyle(node);return {height:node.getBoundingClientRect().height,fontSize:css.fontSize,fontWeight:css.fontWeight,fontFamily:css.fontFamily};
        }));
        assert.ok(toolbarStyle.every(x=>x.height===toolbarStyle[0].height && x.fontSize===toolbarStyle[0].fontSize && x.fontWeight===toolbarStyle[0].fontWeight && x.fontFamily===toolbarStyle[0].fontFamily), 'both toolbar rows share height and typography');
        await browser.getByRole('textbox',{name:'目录路径',exact:true}).fill(lockedFixture);
        await browser.getByRole('button',{name:'打开目录',exact:true}).click();
        await browser.getByText('面板服务账户没有当前目录的写入权限。请打开可写目录后新建或上传文件。',{exact:true}).waitFor();
        for(const label of ['上传文件','新建文件','新建文件夹'])assert.equal(await browser.getByRole('button',{name:label,exact:true}).isDisabled(),true);
        await browser.getByRole('textbox',{name:'目录路径',exact:true}).fill(fileFixture);
        await browser.getByRole('button',{name:'打开目录',exact:true}).click();
        await browser.getByRole('button',{name:'note.txt',exact:true}).click();
        const editor=browser.getByRole('textbox',{name:'文件内容',exact:true});
        await editor.fill('edited-file-fixture-'+width);
        // A slow follow-up listing must finish before the completion notice:
        // otherwise an immediate upload can be silently discarded by busy.
        await page.route('**/api/actions/files.list/execute',async route=>{
          await new Promise(resolve=>setTimeout(resolve,250));await route.continue();
        });
        await browser.getByRole('button',{name:'保存文件',exact:true}).click();
        await browser.getByText('已保存',{exact:true}).waitFor();
        assert.equal(await browser.getByRole('button',{name:'上传文件',exact:true}).isEnabled(),true);
        await page.unroute('**/api/actions/files.list/execute');
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
        await browser.getByRole('button',{name:'修改权限和属主 note.txt',exact:true}).click();
        const permissions=browser.getByRole('dialog',{name:'修改权限与所有者'});
        await permissions.waitFor();
        await permissions.getByRole('textbox',{name:'文件权限',exact:true}).fill('0600');
        await permissions.getByRole('combobox',{name:'文件用户',exact:true}).waitFor({state:'visible'});
        await page.waitForFunction(()=>{
          const dialog=document.querySelector('.file-action-dialog[open]');
          return dialog && [...dialog.querySelectorAll('select')].length===2 &&
            [...dialog.querySelectorAll('select')].every(select=>select.options.length>1);
        });
        assert.ok(await permissions.getByRole('combobox',{name:'文件用户',exact:true}).locator('option').count()>1);
        assert.ok(await permissions.getByRole('combobox',{name:'文件用户组',exact:true}).locator('option').count()>1);
        const selectArrow=await permissions.getByRole('combobox',{name:'文件用户',exact:true}).evaluate(select=>{
          const pseudo=getComputedStyle(select.closest('label'),'::after');
          return {appearance:getComputedStyle(select).appearance,right:pseudo.right,bottom:pseudo.bottom};
        });
        assert.equal(selectArrow.appearance,'none');
        assert.equal(selectArrow.right,'20px','select chevron should be inset from the edge');
        assert.equal(selectArrow.bottom,'17px');
        await permissions.getByRole('button',{name:'保存',exact:true}).click();
        await browser.getByText('权限与属主已保存',{exact:true}).waitFor();
        assert.equal((await (await import('node:fs/promises')).stat(join(fileFixture,'note.txt'))).mode & 0o777,0o600);
        await browser.getByRole('button',{name:'修改权限和属主 note.txt',exact:true}).click();
        const permissionsAgain=browser.getByRole('dialog',{name:'修改权限与所有者'});
        await permissionsAgain.getByRole('textbox',{name:'文件权限',exact:true}).fill('0644');
        await permissionsAgain.getByRole('button',{name:'保存',exact:true}).click();
        await browser.getByText('权限与属主已保存',{exact:true}).waitFor();
        const fileHeaders=await browser.locator('.file-table th').allTextContents();
        assert.ok(fileHeaders.includes('大小（MB）'));
        assert.ok(fileHeaders.includes('权限 / 所有者'));
        const metadata=await browser.locator('.file-table tbody tr').evaluateAll(rows=>rows.map(row=>({
          size:row.children[2].textContent,date:row.querySelector('.file-date')?.textContent,time:row.querySelector('.file-time')?.textContent,
          dateTop:row.querySelector('.file-date')?.getBoundingClientRect().top,timeTop:row.querySelector('.file-time')?.getBoundingClientRect().top
        })));
        assert.ok(metadata.every(row=>/^(≥ )?[\d,]+\.\d{2} MB$/.test(row.size.trim())),'MB values have exactly two decimals');
        assert.ok(metadata.every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date) && /^\d{2}:\d{2}:\d{2}$/.test(row.time) && row.timeTop>row.dateTop),'modified dates and times occupy separate lines');
        await browser.getByRole('button',{name:'新建文件',exact:true}).click();
        await browser.getByRole('textbox',{name:'名称',exact:true}).fill('created-'+width+'.txt');
        await browser.getByRole('button',{name:'确定',exact:true}).click();
        await browser.getByText('已新建',{exact:true}).waitFor();
        assert.equal(await readFile(join(fileFixture,'created-'+width+'.txt'),'utf8'),'');
        await browser.getByRole('button',{name:'重命名 created-'+width+'.txt',exact:true}).click();
        await browser.getByRole('dialog',{name:'重命名'}).getByRole('textbox',{name:'新名称',exact:true}).fill('renamed-'+width+'.txt');
        await browser.getByRole('button',{name:'确定',exact:true}).click();
        await browser.getByText('已重命名',{exact:true}).waitFor();
        assert.equal(await readFile(join(fileFixture,'renamed-'+width+'.txt'),'utf8'),'');
        await browser.getByRole('button',{name:'删除 renamed-'+width+'.txt',exact:true}).click();
        const deleteDialog=browser.getByRole('dialog',{name:'删除确认'});
        await deleteDialog.waitFor();
        await deleteDialog.getByRole('button',{name:'删除',exact:true}).click();
        await browser.getByText('已删除',{exact:true}).waitFor();
        await assert.rejects(readFile(join(fileFixture,'renamed-'+width+'.txt')),{code:'ENOENT'});
        await browser.getByRole('button',{name:'新建文件夹',exact:true}).click();
        await browser.getByRole('textbox',{name:'名称',exact:true}).fill('new-dir-'+width);
        await browser.getByRole('button',{name:'确定',exact:true}).click();
        await browser.getByText('已新建',{exact:true}).waitFor();
        // Drop uses the browser File/DataTransfer path, not the file picker.
        await browser.evaluate((element,width)=>{
          const data=new DataTransfer();data.items.add(new File(['drop-fixture'],'drop-'+width+'.txt',{type:'text/plain'}));
          element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
        },width);
        await browser.getByText('上传完成',{exact:true}).waitFor();
        assert.equal(await readFile(join(fileFixture,'drop-'+width+'.txt'),'utf8'),'drop-fixture');
        await browser.getByRole('button',{name:'new-dir-'+width+'/',exact:true}).click();
        await browser.getByRole('button',{name:'新建文件',exact:true}).click();
        await browser.getByRole('textbox',{name:'名称',exact:true}).fill('child.txt');
        await browser.getByRole('button',{name:'确定',exact:true}).click();
        await browser.getByText('已新建',{exact:true}).waitFor();
        await browser.getByRole('button',{name:'上一级',exact:true}).click();
        await browser.getByRole('button',{name:'重命名 new-dir-'+width,exact:true}).click();
        await browser.getByRole('dialog',{name:'重命名'}).getByRole('textbox',{name:'新名称',exact:true}).fill('renamed-dir-'+width);
        await browser.getByRole('button',{name:'确定',exact:true}).click();
        await browser.getByText('已重命名',{exact:true}).waitFor();
        assert.equal(await readFile(join(fileFixture,'renamed-dir-'+width,'child.txt'),'utf8'),'');
        await browser.getByRole('button',{name:'删除 renamed-dir-'+width,exact:true}).click();
        await browser.getByRole('dialog',{name:'删除确认'}).getByRole('button',{name:'删除',exact:true}).click();
        await browser.getByText('已删除',{exact:true}).waitFor();
        await assert.rejects(readFile(join(fileFixture,'renamed-dir-'+width,'child.txt')),{code:'ENOENT'});
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
      if(name.trim()==='面板设置' && width===1280){
        await page.getByRole('button',{name:'下移 服务浏览'}).click();
        await page.waitForFunction(()=>[...document.querySelectorAll('.module-nav button')].map(n=>n.textContent.trim()).slice(0,4).join(',')==='系统概览,终端,服务浏览,文件管理');
        await page.reload();
        await page.locator('.module-nav button').first().waitFor();
        assert.deepEqual((await page.locator('.module-nav button').allTextContents()).map(x=>x.trim()).slice(0,4),
          ['系统概览','终端','服务浏览','文件管理'],'saved module order survives reload');
        await navigate('面板设置');
        await page.getByRole('button',{name:'上移 服务浏览'}).click();
        await page.waitForFunction(()=>[...document.querySelectorAll('.module-nav button')].map(n=>n.textContent.trim()).slice(0,4).join(',')==='系统概览,服务浏览,终端,文件管理');
      }
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
  // Worker shutdown can race with the final private-state unlink; tolerate
  // transient ENOTEMPTY while keeping persistent cleanup failures visible.
  await rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:125});
}
