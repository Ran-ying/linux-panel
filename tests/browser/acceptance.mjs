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
    let nginxRunning=true,nginxAutostart=true;
    const nginxToggleActions=[],nginxServiceActions=[],nginxRenewActions=[];
    let nginxCertificateReads=0,nginxPrivateReads=0;
    const tlsSaves=[];let tlsRevision='a'.repeat(64);
    const publicFixture='-----BEGIN PUBLIC KEY-----\nPUBLIC FIXTURE\n-----END PUBLIC KEY-----\n';
    const privateFixture='-----BEGIN PRIVATE KEY-----\nPRIVATE FIXTURE\n-----END PRIVATE KEY-----\n';
    let currentCert='-----BEGIN CERTIFICATE-----\nCERTIFICATE FIXTURE\n-----END CERTIFICATE-----\n';
    let currentKey=privateFixture;
    const certFixture={name:'fixture.test',domains:['fixture.test','www.fixture.test'],
      issuer:'CN=Fixture CA',validFrom:'2026-09-01T00:00:00.000Z',
      validTo:'2026-12-01T00:00:00.000Z',daysRemaining:45,status:'valid',
      certificatePath:'/etc/letsencrypt/live/fixture.test/cert.pem'};
    const revision=()=>String(++nginxVersions).padStart(64,'0');
    await page.route('**/api/actions/nginx.*/execute',async route=>{
      const id=new URL(route.request().url()).pathname.split('/')[3];
      const input=route.request().postDataJSON()?.input??{};
      let data,status=200;
      const target=nginxSites.find(site=>site.name===input.name);
      if(id==='nginx.certbotList'){
        data={installed:true,timerActive:true,timerEnabled:true,count:1,certificates:[{
          name:'fixture.test',domains:['fixture.test'],authenticator:'nginx',
          validTo:'2026-12-01T00:00:00.000Z',daysRemaining:45,status:'valid'}],warnings:[]};
      }else if(id==='nginx.certbotRenew'){
        nginxRenewActions.push(input.name);
        data={ok:true,status:'Certbot 已检查续期',output:'',reloaded:true};
      }else if(id==='nginx.siteTls'){
        nginxCertificateReads++;
        data={name:input.name,pairs:input.name==='unrelated-site'?[]:[{
          certificatePath:'/etc/letsencrypt/live/fixture.test/fullchain.pem',
          privateKeyPath:'/etc/letsencrypt/live/fixture.test/privkey.pem',
          publicPem:publicFixture,certificatePem:currentCert,revision:tlsRevision,
          privateKeyConfigured:true,status:'已配置'
        }],warnings:[]};
      }else if(id==='nginx.siteTlsKey'){
        nginxPrivateReads++;
        data={name:input.name,index:input.index,privatePem:currentKey};
      }else if(id==='nginx.saveTls'){
        tlsSaves.push(input);
        if(input.updateCertificate)currentCert=input.certificatePem;
        if(input.updatePrivateKey)currentKey=input.privatePem;
        tlsRevision='b'.repeat(64);
        data={name:input.name,index:input.index,ok:true,status:'证书已保存并重新加载',revision:tlsRevision,reloaded:true};
      }else if(id==='nginx.status')data={installed:true,version:'nginx/1.24.0',
        active:nginxRunning,enabled:nginxAutostart,state:nginxRunning?'active':'inactive',
        subState:nginxRunning?'running':'dead',configOk:nginxSyntaxGood};
      else if(id==='nginx.service'){
        nginxServiceActions.push(input.operation);
        if(['start','restart','reload'].includes(input.operation) && !nginxSyntaxGood)
          data={ok:false,status:'配置检查失败，未执行服务操作',output:'fixture bad'};
        else{
          if(input.operation==='start'||input.operation==='restart')nginxRunning=true;
          if(input.operation==='stop')nginxRunning=false;
          if(input.operation==='enable')nginxAutostart=true;
          if(input.operation==='disable')nginxAutostart=false;
          data={ok:true,status:'Nginx 服务操作成功',output:'fixture service'};
        }
       }else if(id==='nginx.certificates'){
        nginxCertificateReads++;
        data={provider:'Certbot / Let’s Encrypt',installed:true,count:2,
          certificates:[certFixture,{...certFixture,name:'unrelated.test',
            domains:['unrelated.test'],certificatePath:'/etc/letsencrypt/live/unrelated.test/cert.pem'}],
          warnings:[]};
      }
      else if(id==='nginx.renew'){
        nginxRenewActions.push(input.name);
        data={ok:true,status:'Certbot 续期检查完成，Nginx 已重载',output:'fixture renewal',reloaded:true};
      }else if(id==='nginx.sites')data={source:'fixture',count:nginxSites.length,
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
            serverNames:input.name==='unrelated-site'?'no-match.example.test':'fixture.test, www.fixture.test',
            listens:'80',file:'/etc/nginx/sites-available/'+input.name,
            editable:true,content:input.content,revision:revision()});}
        }else if(!target||target.revision!==input.revision){status=409;data={error:'版本冲突'};}
        else if(input.operation==='remove')nginxSites=nginxSites.filter(s=>s!==target);
        else{
          if(input.operation==='edit'){
             target.content=input.content;
             target.serverNames=[...new Set([...input.content.matchAll(/server_name\s+([^;]+);/g)]
               .flatMap(m=>m[1].trim().split(/\s+/).filter(Boolean)))].join(', ');
           }
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
    // Synthetic V2Ray server: browser coverage without changing the CI host.
    let v2rayInstalled=true,v2rayRunning=true,v2rayEnabled=true,v2rayRevision=0;
    let v2rayFailStatusOnce=false;
    let v2rayConfig=JSON.stringify({inbounds:[{tag:'socks',listen:'192.0.2.55',
      port:10080,protocol:'socks',streamSettings:{network:'ws',security:'tls'},
      settings:{clients:[{id:'client-uuid-visible',level:1}]}}],outbounds:[{tag:'direct',protocol:'freedom'}],
      inboundDetour:[{tag:'legacy-in',protocol:'socks',listen:'127.0.0.1',port:12080}],
      outboundDetour:[{tag:'legacy-out',protocol:'freedom',settings:{}}],
      dns:{servers:['1.1.1.1']},routing:{rules:[]},customUnknown:{value:true}},null,2);
    const v2rayCalls=[];
    const v2rayDigest=()=>String(v2rayRevision).padStart(64,'b');
    await page.route('**/api/actions/v2ray.*/execute',async route=>{
      const id=new URL(route.request().url()).pathname.split('/')[3];
      const input=route.request().postDataJSON()?.input??{};
      v2rayCalls.push({id,operation:input.operation??null});
      let status=200,result;
      if(id==='v2ray.status'&&v2rayFailStatusOnce){
        v2rayFailStatusOnce=false;status=503;result={error:'Temporary status outage'};
      }else if(id==='v2ray.status')result={installed:v2rayInstalled,version:v2rayInstalled?'V2Ray 5.47.0':'',
        service:v2rayRunning?'running':'stopped',enabled:v2rayEnabled,binary:v2rayInstalled?'/usr/local/bin/v2ray':'',
        configPath:'/usr/local/etc/v2ray/config.json',configExists:v2rayInstalled,
        inbounds:v2rayInstalled?1:0,outbounds:v2rayInstalled?1:0,features:['inbounds','outbounds','routing','dns'],
        message:v2rayInstalled?'V2Ray 已安装':'未安装'};
      else if(id==='v2ray.read')result={content:v2rayConfig,revision:v2rayDigest(),
        configPath:'/usr/local/etc/v2ray/config.json'};
      else if(id==='v2ray.test')result={ok:true,message:'配置检查通过',output:'V2Ray 5.47.0 test passed'};
      else if(id==='v2ray.save'){
        if(input.revision!==v2rayDigest()){status=409;result={error:'配置版本冲突'};}
        else{v2rayConfig=input.content;v2rayRevision++;
          result={ok:true,message:'保存成功',output:'V2Ray test passed',revision:v2rayDigest(),restarted:v2rayRunning};}
      }else if(id==='v2ray.service'){
        if(input.operation==='stop')v2rayRunning=false;
        if(input.operation==='start'||input.operation==='restart')v2rayRunning=true;
        if(input.operation==='enable')v2rayEnabled=true;
        if(input.operation==='disable')v2rayEnabled=false;
        result={ok:true,message:'服务操作成功',output:''};
      }else if(id==='v2ray.install'){
        v2rayInstalled=true;v2rayRunning=true;v2rayEnabled=true;
        result={ok:true,message:'已安装',output:'SHA-256 已确认'};
      }else{status=404;result={error:'No V2Ray fixture handler'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(
        status===200?{action:id,result}:result)});
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
    assert.ok(!names.some(name=>name.trim()==='Certbot 证书管理'),'Certbot now lives inside Nginx Website module');
    assert.equal(names.filter(name=>name.trim()==='定时任务').length,1,'there is exactly one scheduled-tasks navigation module');
    assert.ok(!names.some(name=>name.trim()==='系统现有定时任务'||name.trim()==='Linux Panel 托管的定时任务'),
      'two scheduler sections must not appear as separate sidebar modules');
    let referenceControls;
    const appearance=locator=>locator.evaluate(node=>{
      const style=getComputedStyle(node),rect=node.getBoundingClientRect();
      return {height:Math.round(rect.height*100)/100,borderRadius:style.borderTopLeftRadius,
        fontSize:style.fontSize,fontWeight:style.fontWeight,fontFamily:style.fontFamily,
        paddingTop:style.paddingTop,paddingLeft:style.paddingLeft,lineHeight:style.lineHeight,
        color:style.color,background:style.backgroundColor,borderColor:style.borderTopColor,
        gap:style.gap};
    });
    for(const name of [...names,'面板设置']){
      await navigate(name.trim());
      await page.locator('.module-content').waitFor();
      // Audit shared chevron geometry for all selects mounted by every module.
      if([390,1280].includes(width)){
        const selects=await page.locator('select:not([multiple]):not([size])').evaluateAll(nodes=>
          nodes.map(node=>{
            const css=getComputedStyle(node);
            return {appearance:css.appearance,right:css.backgroundPosition,
              image:css.backgroundImage,padding:css.paddingRight};
          }));
        for(const select of selects){
          assert.equal(select.appearance,'none',name+': native select appearance');
          assert.match(select.right,/14px/,name+': chevron right inset');
          assert.match(select.image,/data:image\/svg\+xml/,name+': chevron icon');
          assert.equal(select.padding,'34px',name+': text clearing');
        }
      }
      if(name.trim()==='系统概览'){
        const refresh=page.locator('.action-card .result-controls button.action-refresh').first();
        const switchButton=page.locator('.action-card .view-switch button').first();
        const capsule=page.locator('.action-card .view-switch').first();
        await refresh.waitFor();await switchButton.waitFor();
        referenceControls={
          primary:await appearance(refresh),
          neutral:await appearance(switchButton),
          capsule:await appearance(capsule)
        };
      }
      if([390,1280].includes(width) && ['文件管理','定时任务','Nginx 网站'].includes(name.trim())){
        assert.ok(referenceControls,'system overview must establish the canonical button design first');
        const moduleRoot=page.locator(name.trim()==='文件管理'?'.file-browser':
          name.trim().includes('定时任务')?'.scheduled-tasks':'.managed-configs');
        await moduleRoot.waitFor();
        const standalone=true;
        const group=moduleRoot.locator('.panel-control-capsule').first();
        const controls=name.trim()==='Nginx 网站'
          ?page.locator('.module-header-actions')
          :name.trim()==='定时任务'
            ?moduleRoot.locator('.managed-task-group .task-heading-actions'):moduleRoot;
        const primary=controls.locator('.panel-control-primary').first();
        const neutral=standalone?controls.locator('button:not(.panel-control-primary)').first()
          :group.locator('button:not(.panel-control-primary)').first();
        if(!standalone)await group.waitFor();
        await neutral.waitFor();
        const hasPrimary=await primary.count()>0;
        if(hasPrimary)await primary.waitFor();
        const actualPrimary=hasPrimary?await appearance(primary):null,actualNeutral=await appearance(neutral),
          actualGroup=standalone?null:await appearance(group);
        const shared=['height','borderRadius','fontSize','fontWeight','fontFamily','paddingTop','paddingLeft','lineHeight'];
        for(const key of shared){
          if(hasPrimary)assert.equal(actualPrimary[key],referenceControls.primary[key],
            name+': primary '+key+' must match system overview refresh');
          assert.equal(actualNeutral[key],referenceControls.neutral[key],
            name+': capsule option '+key+' must match system overview');
        }
        if(hasPrimary)for(const key of ['background','color','borderColor']){
          assert.equal(actualPrimary[key],referenceControls.primary[key],
            name+': primary '+key+' must match system overview refresh');
        }
        if(standalone){
          assert.equal(await controls.locator('.panel-control-capsule').count(),0,
            name+': unrelated action commands must not look like selectable segmented controls');
        }else{
          for(const key of ['borderRadius','paddingTop','paddingLeft','background','borderColor','gap']){
            assert.equal(actualGroup[key],referenceControls.capsule[key],
              name+': grouped capsule '+key+' must match system overview');
          }
        }
        const commandRoot=name.trim()==='Nginx 网站'?controls:moduleRoot;
        const buttons=await commandRoot.locator(
          'button:not(.file-entry):not(.config-site-selector):not(.file-permissions-button)'
        ).evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>{
          const style=getComputedStyle(n),rect=n.getBoundingClientRect();
          return {name:n.textContent.trim(),height:rect.height,radius:style.borderTopLeftRadius,
            fontSize:style.fontSize};
        }));
        assert.ok(buttons.length>0 && buttons.every(b=>
          Math.abs(b.height-32)<.1 && b.radius==='999px' &&
          b.fontSize===referenceControls.primary.fontSize),
          name+': all command buttons must share the compact 32px pill appearance');
      }
      if(name.trim()==='Nginx 网站' && [390,1280].includes(width)){
        const certbot=page.locator('.certbot-manager');
        const certAction=page.locator('.action-card:has(.certbot-manager)');
        const siteAction=page.locator('.action-card:has(.managed-configs)');
        assert.equal(await siteAction.locator('.certbot-manager').count(),0,
          'Certbot is a peer Action, not a child of Nginx website manager');
        assert.equal(await certAction.count(),1);
        const siblingPositions=await Promise.all([siteAction,certAction].map(el=>el.evaluate(node=>({
          top:node.getBoundingClientRect().top,left:node.getBoundingClientRect().left}))));
        assert.ok(siblingPositions[1].top>siblingPositions[0].top);
        assert.ok(Math.abs(siblingPositions[1].left-siblingPositions[0].left)<2);
        const area=certAction;
        assert.equal(await area.locator('.certbot-record').count(),1);
        const borderCheck=await area.locator('.certbot-record').evaluate(node=>{
          const css=getComputedStyle(node);
          return {border:css.borderLeftWidth,radius:css.borderTopLeftRadius};
        });
        assert.equal(borderCheck.border,'0px','certificate rows have no nested card frames');
        assert.equal(borderCheck.radius,'0px');
        await certbot.getByText('1 份续期配置',{exact:false}).waitFor();
        await certbot.getByText('验证方式 nginx').waitFor();
        const button=certbot.getByRole('button',{name:'续期证书 fixture.test'});
        await button.click();
        const dialog=page.getByRole('dialog',{name:'确认 Certbot 续期'});
        await dialog.waitFor();
        assert.deepEqual(nginxRenewActions,[],'confirmation required before Certbot renewal');
        await dialog.getByRole('button',{name:'取消'}).click();
        await dialog.waitFor({state:'hidden'});
        await button.click();
        await dialog.getByRole('button',{name:'确认续期'}).click();
        await dialog.waitFor({state:'hidden'});
        assert.deepEqual(nginxRenewActions,['fixture.test']);
      }

      if(name.trim()==='定时任务' && [390,1280].includes(width)){
        const schedule=page.locator('.scheduled-tasks');
        await schedule.getByRole('heading',{name:'Linux Panel 托管的定时任务'}).waitFor();
        const managed=schedule.locator('.managed-task-group');
        const system=schedule.locator('.system-task-group');
        await system.getByRole('heading',{name:'系统现有定时任务'}).waitFor();
        assert.equal(await schedule.getByRole('tab').count(),0,'the two sections are not tabs');
        assert.deepEqual(await schedule.locator(':scope > .task-group > .task-group-heading > h3').allTextContents(),
          ['Linux Panel 托管的定时任务','系统现有定时任务'],
          'managed section must be above existing system schedules');
        assert.equal(await schedule.locator(':scope > .task-group').count(),2,
          'there must be exactly two permanently visible sections');
        const layout=await schedule.locator(':scope > .task-group').evaluateAll(nodes=>nodes.map(node=>{
          const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
          return {top:rect.top,bottom:rect.bottom,borderRadius:style.borderTopLeftRadius,
            background:style.backgroundColor,borderTop:style.borderTopStyle,
            borderWidth:style.borderTopWidth,padding:style.paddingLeft};
        }));
        assert.ok(layout[0].bottom<=layout[1].top,'managed section must be completely above system section');
        assert.ok(layout.every(row=>parseFloat(row.borderRadius)>0
          && row.borderTop==='solid' && row.borderWidth==='1px'
          && row.background!=='rgba(0, 0, 0, 0)' && parseFloat(row.padding)>0),
          'both independent sections must each have their own rounded outer card');
        assert.ok(layout[1].top-layout[0].bottom>=12,
          'two independent cards must have a visible gap, not just a divider');
        assert.equal(await schedule.locator('.task-group .task-group').count(),0,
          'neither task card may contain an extra nested task card');
        for(const [group,label,expected] of [
          [managed,'Linux Panel 托管的定时任务',['新建任务','刷新数据']],
          [system,'系统现有定时任务',['刷新数据']]
        ]){
          const heading=group.locator(':scope > .task-group-heading');
          const actions=heading.locator(':scope > .task-heading-actions');
          assert.deepEqual(await actions.getByRole('button').allTextContents(),expected,
            label+': controls belong in the section header');
          assert.equal(await group.locator('.panel-control-capsule').count(),0,
            label+': independent commands are not segmented capsules');
          const geometry=await heading.evaluate(node=>{
            const a=node.querySelector('.task-heading-actions').getBoundingClientRect();
            const group=node.parentElement.getBoundingClientRect();
            const title=node.querySelector('h3').getBoundingClientRect();
            return {rightGap:group.right-a.right,titleTop:title.top,controlsTop:a.top,
              actionsTop:a.top,actionsBottom:a.bottom,groupTop:group.top,
              headingBottom:node.getBoundingClientRect().bottom};
          });
          assert.ok(geometry.rightGap>=8 && geometry.rightGap<=40,
            label+': controls are right-aligned within their own rounded card');
          assert.ok(geometry.actionsTop<geometry.headingBottom+1,
            label+': actions must be within the heading row');
          if(width===1280)assert.ok(Math.abs(geometry.titleTop-geometry.controlsTop)<16,
            label+': desktop actions should share the title line');
        }
        const chrome=await schedule.locator('xpath=ancestor::section[contains(@class,"action-card")]').evaluate(node=>{
          const style=getComputedStyle(node);
          return {minimal:node.classList.contains('minimal-action'),
            flat:node.classList.contains('flat-action'),
            radius:style.borderTopLeftRadius,background:style.backgroundColor,
            border:style.borderTopStyle,borderWidth:style.borderTopWidth,padding:style.paddingLeft};
        });
        assert.ok(chrome.minimal && chrome.flat && chrome.radius==='0px'
          && chrome.border==='none' && chrome.background==='rgba(0, 0, 0, 0)'
          && chrome.padding==='0px',
          'the ActionCard wrapper must be invisible; the two task groups themselves are the outer rounded cards');
        assert.equal(await schedule.locator(':scope > .task-group').count(),2,
          'the two standalone rounded cards must be direct children of the scheduled tasks surface');
        assert.equal(await managed.getByRole('button',{name:'新建任务'}).count(),1);
        assert.equal(await system.getByRole('button',{name:'新建任务'}).count(),0);
        const systemTable=system.locator('.system-task-table');
        const visibleRows=systemTable.locator('tbody tr');
        const source=systemTable.getByRole('combobox',{name:'按来源筛选'});
        const owner=systemTable.getByRole('combobox',{name:'按执行用户筛选'});
        const status=systemTable.getByRole('combobox',{name:'按任务状态筛选'});
        assert.equal(await visibleRows.count(),3);
        assert.deepEqual(await owner.locator('option').allTextContents(),
          ['全部用户','alice','root','systemd']);
        // These header dropdowns and the search input are outside task-form.
        const checkCronFilters=async theme=>{
          await page.locator('html').evaluate((node,name)=>{node.dataset.theme=name;},theme);
          const controls=await system.locator(
            '.system-filters input, .task-filter-heading select'
          ).evaluateAll(nodes=>{
            const probe=document.createElement('span');
            probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none';
            probe.style.backgroundColor='var(--input-bg)';
            probe.style.border='1px solid var(--input-border)';
            probe.style.color='var(--text-primary)';
            document.body.appendChild(probe);
            const palette=getComputedStyle(probe);
            const expected={bg:palette.backgroundColor,border:palette.borderTopColor,color:palette.color};
            const values=nodes.map(node=>{
              const css=getComputedStyle(node),rect=node.getBoundingClientRect();
              return {tag:node.tagName,background:css.backgroundColor,
                border:css.borderTopColor,borderWidth:css.borderTopWidth,
                borderStyle:css.borderTopStyle,color:css.color,
                radius:css.borderTopLeftRadius,fontSize:css.fontSize,
                weight:css.fontWeight,height:rect.height,paddingRight:css.paddingRight,
                image:css.backgroundImage};
            });
            probe.remove();
            return {expected,values};
          });
          assert.equal(controls.values.length,4,theme+': three selects and one search input');
          assert.equal(controls.values.filter(x=>x.tag==='SELECT').length,3);
          for(const control of controls.values){
            assert.ok(Math.abs(control.height-38)<.2,theme+': field height '+JSON.stringify(control));
            assert.equal(control.radius,'8px',theme+': field radius');
            assert.equal(control.borderStyle,'solid',theme+': solid input border');
            assert.equal(control.borderWidth,'1px',theme+': input border width');
            assert.equal(control.fontSize,'16px',theme+': regular field text size');
            assert.equal(control.weight,'400',theme+': do not inherit bold heading');
            assert.equal(control.background,controls.expected.bg,theme+': themed background');
            assert.equal(control.border,controls.expected.border,theme+': themed border color');
            assert.equal(control.color,controls.expected.color,theme+': themed text color');
            if(control.tag==='SELECT'){
              assert.ok(parseFloat(control.paddingRight)>=30,theme+': chevron text clearance');
              assert.ok(control.image.includes('svg'),theme+': shared chevron graphic');
            }
          }
        };
        const oldTheme=await page.locator('html').getAttribute('data-theme');
        try{
          await checkCronFilters('light');
          await checkCronFilters('dark');
        }finally{
          await page.locator('html').evaluate((node,name)=>{
            if(name===null)node.removeAttribute('data-theme');
            else node.dataset.theme=name;
          },oldTheme);
        }
        const search=system.getByRole('textbox',{name:'搜索系统任务'});
        const callsBeforeFilters=cronListCalls;
        await search.fill('certbot');
        assert.equal(await visibleRows.count(),1,'search must filter client-side');
        await search.clear();
        assert.equal(await visibleRows.count(),3);
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
        await source.selectOption('all');
        await owner.selectOption('all');
        await status.selectOption('all');
        assert.equal(await visibleRows.count(),3);
        assert.equal(cronListCalls,callsBeforeFilters,'all dropdown filtering must remain client-side');
        // Managed CRUD must not hide or replace the system inventory section.
        await managed.getByRole('button',{name:'新建任务'}).click();
        const form=page.getByRole('dialog',{name:'新建定时任务'});
        await form.getByRole('textbox',{name:'任务名称'}).fill('Fixture nightly');
        await form.getByRole('textbox',{name:'Cron 表达式'}).fill('0 2 * * *');
        await form.getByRole('textbox',{name:'执行命令'}).fill('/usr/bin/true');
        await form.getByRole('button',{name:'保存'}).click();
        await managed.getByText('Fixture nightly').waitFor();
        assert.equal(await visibleRows.count(),3);
        await managed.getByRole('button',{name:'停用 Fixture nightly'}).click();
        await managed.getByRole('cell',{name:'已停用',exact:true}).waitFor();
        await managed.getByRole('button',{name:'删除 Fixture nightly'}).click();
        await page.getByRole('dialog',{name:'删除任务'}).getByRole('button',{name:'删除'}).click();
        await managed.getByText('暂无由 Linux Panel 管理的定时任务').waitFor();
        assert.equal(await visibleRows.count(),3);
        await page.screenshot({path:join(output,'cron-stacked-flat-'+width+'.png'),fullPage:true});
      }
      if(name.trim()==='Nginx 网站' && [390,1280].includes(width)){
        const cards=page.locator('.module-content .action-flow > .action-card');
        assert.equal(await cards.count(),2,'SSL is only within selected website details');
        const statusCard=cards.first();
        assert.ok((await statusCard.getAttribute('class')).includes('flat-action'));
        const flatStyle=await statusCard.evaluate(node=>{const css=getComputedStyle(node);
          return {border:css.borderTopWidth,radius:css.borderTopLeftRadius,background:css.backgroundColor};
        });
        assert.equal(flatStyle.border,'0px');
        assert.equal(flatStyle.radius,'0px');
        assert.equal(flatStyle.background,'rgba(0, 0, 0, 0)');
        assert.deepEqual((await cards.locator(':scope > .card-heading h3').allTextContents())
          .map(x=>x.trim()),['Nginx 网站管理']);
        const statusPanel=page.getByRole('region',{name:'Nginx 状态管理面板'});
        await statusPanel.waitFor();
        assert.equal(await statusPanel.getByRole('heading',{name:'Nginx 状态管理'}).count(),1);
        assert.ok((await statusPanel.innerText()).includes('nginx/1.24.0'));
        assert.equal(await page.locator('.nginx-certificates').count(),0);
        assert.equal(nginxCertificateReads,0,'certificate inventory must load lazily only on site detail');
        const serviceButtons=statusPanel.locator('.nginx-service-buttons button');
        assert.deepEqual((await serviceButtons.allTextContents()).map(x=>x.trim()),
          ['停止','重启','重载','关闭开机自启','检查配置']);
        const headingRow=statusPanel.locator('.nginx-service-heading');
        const refreshStatus=headingRow.getByRole('button',{name:'刷新状态'});
        assert.equal(await refreshStatus.count(),1,
          'Refresh Status belongs to the Nginx status header');
        assert.equal(await statusPanel.getByRole('button',{name:'刷新状态'}).count(),1);
        assert.equal(await statusPanel.locator('.nginx-service-toolbar').count(),0,
          'old bottom toolbar must be removed');
        const titlePositions=await headingRow.evaluate(node=>{
          const title=node.querySelector('h3').getBoundingClientRect();
          const refresh=node.querySelector('button').getBoundingClientRect();
          const header=node.getBoundingClientRect();
          return {titleRight:title.right,titleTop:title.top,
            refreshLeft:refresh.left,refreshRight:refresh.right,
            refreshTop:refresh.top,headerRight:header.right};
        });
        assert.ok(titlePositions.refreshLeft>=titlePositions.titleRight-2,
          'Refresh Status is to the right of the heading');
        assert.ok(titlePositions.headerRight-titlePositions.refreshRight<=2,
          'Refresh Status is right-aligned within its header');
        assert.ok(Math.abs(titlePositions.titleTop-titlePositions.refreshTop)<=16,
          'status heading and refresh button should share one row at this width');
        const buttonAppearance=async locator=>locator.evaluate(node=>{
          const css=getComputedStyle(node);
          return {height:node.getBoundingClientRect().height,fontSize:css.fontSize,
            fontWeight:css.fontWeight,lineHeight:css.lineHeight,padding:css.padding,
            radius:css.borderTopLeftRadius,border:css.borderTopWidth,
            borderColor:css.borderTopColor,background:css.backgroundColor,color:css.color};
        });
        const serviceStyle=await buttonAppearance(serviceButtons.first());
        const refreshStyle=await buttonAppearance(refreshStatus);
        assert.deepEqual(refreshStyle,serviceStyle,
          'Refresh Status and the service operation buttons must share one design');
        assert.equal(serviceStyle.height,32,'use the website button 32px height');
        assert.equal(serviceStyle.radius,'999px','use website pill-shaped buttons');
        await refreshStatus.click();
        await statusPanel.getByText('nginx/1.24.0').waitFor();
        await statusPanel.getByRole('button',{name:'重载',exact:true}).click();
        const serviceModal=page.getByRole('dialog',{name:'确认 Nginx 服务操作'});
        await serviceModal.waitFor();
        assert.deepEqual(nginxServiceActions,[],'service operations must require confirmation');
        await serviceModal.getByRole('button',{name:'取消'}).click();
        await serviceModal.waitFor({state:'hidden'});
        assert.deepEqual(nginxServiceActions,[]);
        await statusPanel.getByRole('button',{name:'重载',exact:true}).click();
        await serviceModal.getByRole('button',{name:'确认操作'}).click();
        await serviceModal.waitFor({state:'hidden'});
        assert.deepEqual(nginxServiceActions,['reload']);
        await statusPanel.getByRole('button',{name:'停止',exact:true}).click();
        await serviceModal.getByRole('button',{name:'确认操作'}).click();
        await serviceModal.waitFor({state:'hidden'});
        assert.deepEqual(nginxServiceActions,['reload','stop']);
        await statusPanel.getByRole('button',{name:'启动',exact:true}).waitFor();
        assert.equal(await statusPanel.getByRole('button',{name:'停止',exact:true}).count(),0);
        await statusPanel.getByRole('button',{name:'启动',exact:true}).click();
        await serviceModal.getByRole('button',{name:'确认操作'}).click();
        await serviceModal.waitFor({state:'hidden'});
        assert.deepEqual(nginxServiceActions,['reload','stop','start']);
        const manager=page.locator('.managed-configs');
        assert.equal(await manager.locator('.config-detail-panel').count(),0,
          'the website details pane must be absent before selecting a website');
        assert.equal(await manager.locator('.config-site-list').count(),0,
          'an empty site list should not render an empty row table');
        assert.equal(await manager.locator('.config-table,.config-location').count(),0,
          'old multi-column layout and sites-available indicator must be removed');
        assert.ok(!((await manager.innerText()).includes('状态复选框：勾选为启用')),
          'the old instructional paragraph must be removed');
        const moduleTitle=page.locator('.module-content > .module-intro');
        assert.equal(await moduleTitle.locator('.module-header-actions').count(),0,
          'command buttons must not be beside the module-level Nginx heading');
        const actionCard=page.locator('.action-card:has(.managed-configs)');
        const header=actionCard.locator(':scope > .card-heading');
        const headerButtons=header.locator('.module-header-actions');
        assert.equal(await header.getByRole('heading').count(),1);
        const title=(await header.getByRole('heading').innerText()).trim();
        assert.ok(title.includes('Nginx'),'actions must share the website manager heading row');
        assert.deepEqual(await headerButtons.getByRole('button').allTextContents(),
          ['新建网站','刷新数据','检查 Nginx 配置']);
        const websiteButtonStyle=await buttonAppearance(
          headerButtons.getByRole('button',{name:'刷新数据'}));
        assert.deepEqual(serviceStyle,websiteButtonStyle,
          'Nginx status controls must match the website manager button appearance exactly');
        const headerPositions=await header.evaluate(node=>{
          const heading=node.querySelector('h3').getBoundingClientRect();
          const actions=node.querySelector('.module-header-actions').getBoundingClientRect();
          return {headingTop:heading.top,headingRight:heading.right,
            actionsTop:actions.top,actionsLeft:actions.left,actionsWidth:actions.width};
        });
        if(width===1280){
          assert.ok(Math.abs(headerPositions.headingTop-headerPositions.actionsTop)<16,
            'Nginx actions must be in the same header row');
          assert.ok(headerPositions.actionsLeft>headerPositions.headingRight,
            'Nginx actions must align to the right of the website manager heading');
        }
        assert.equal(await manager.locator('.config-toolbar').count(),0,
          'action buttons should live beside the website manager heading, not within the list');
        const outerStyles=await actionCard.evaluate(node=>{
          const cs=getComputedStyle(node);
          return {border:cs.borderTopWidth,radius:cs.borderTopLeftRadius,background:cs.backgroundColor};
        });
        assert.equal(outerStyles.border,'1px',
          'the website manager must retain its own outer card border');
        assert.ok(parseFloat(outerStyles.radius)>=12,
          'the website manager must retain its own rounded outer card');
        const moduleRadius=await moduleTitle.evaluate(node=>getComputedStyle(node).borderTopLeftRadius);
        assert.equal(outerStyles.radius,moduleRadius,
          'website manager outer radius must match the shared module card design');
        assert.equal(await manager.evaluate(node=>getComputedStyle(node).borderTopWidth),'0px',
          'managed-configs nested section must be unframed');
        const siteListStyle=await manager.locator('.config-list-panel').evaluate(node=>{
          const cs=getComputedStyle(node);return {border:cs.borderTopWidth,radius:cs.borderTopLeftRadius};
        });
        assert.equal(siteListStyle.border,'1px','the website list itself needs a border');
        assert.equal(siteListStyle.radius,'12px','the website list itself must be rounded');
        await headerButtons.getByRole('button',{name:'新建网站'}).click();
        const editor=page.getByRole('dialog',{name:'新建网站配置'});
        await editor.getByRole('textbox',{name:'配置文件名'}).fill('fixture-site');
        await editor.getByRole('textbox',{name:'Nginx 配置内容'})
          .fill('server { listen 80; server_name fixture.test www.fixture.test; }');
        await editor.getByRole('button',{name:'保存配置'}).click();
        const website=manager.getByRole('button',{name:'查看网站 fixture-site'});
        const enabled=manager.getByRole('checkbox',{name:'启用状态：fixture-site'});
        await enabled.waitFor();
        const firstRow=manager.locator('.config-site-row').first();
        const firstRowOrder=await firstRow.locator(':scope > input,:scope > button')
          .evaluateAll(nodes=>nodes.map(node=>node.tagName));
        assert.deepEqual(firstRowOrder,['INPUT','BUTTON'],'the checkbox must precede the website name');
        const checkboxInset=await firstRow.evaluate(node=>{
          const outer=node.closest('.config-list-panel').getBoundingClientRect();
          const checkbox=node.querySelector('.config-status-checkbox').getBoundingClientRect();
          return checkbox.left-outer.left;
        });
        assert.ok(checkboxInset>=10,
          'Nginx site status checkbox must have visible left padding inside the list border');
        const listWidth=await manager.locator('.config-list-panel').evaluate(
          node=>node.getBoundingClientRect().width);
        if(width===1280)assert.ok(listWidth<=280,
          'the desktop website list column should be narrow');
        else assert.ok(listWidth<=width,
          'mobile list should fill available viewport instead of overflowing');
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
        const detailCards=details.locator(':scope > .config-detail-card');
        assert.equal(await detailCards.count(),3,
          'site detail should contain exactly three independent rounded rectangles');
        assert.deepEqual(await detailCards.evaluateAll(cards=>cards.map(card=>card.getAttribute('aria-label'))),
          ['网站基本信息','Nginx 配置','网站 SSL 证书管理'],
          'site information first, read-only Nginx configuration second, SSL third');
        const detailCardStyles=await detailCards.evaluateAll(cards=>cards.map(card=>{
          const style=getComputedStyle(card);
          const rect=card.getBoundingClientRect();
          return {border:style.borderTopWidth,radius:parseFloat(style.borderTopLeftRadius),
            background:style.backgroundColor,width:rect.width,top:rect.top,bottom:rect.bottom};
        }));
        for(const card of detailCardStyles){
          assert.equal(card.border,'1px','every site detail card must have its own border');
          assert.ok(card.radius>=12,'each card must be rounded');
          assert.notEqual(card.background,'rgba(0, 0, 0, 0)','each card owns a background');
          assert.ok(card.width>120&&card.width<=width,'each detail card must fit viewport');
        }
        assert.ok(detailCardStyles[0].bottom<detailCardStyles[1].top,
          'site info and Nginx config rectangles must be visually separated');
        assert.ok(detailCardStyles[1].bottom<detailCardStyles[2].top,
          'Nginx config and SSL rectangles must be visually separated');
        assert.equal(await details.evaluate(n=>getComputedStyle(n).borderLeftWidth),'0px',
          'site detail parent should no longer use a shared left border');
        const siteInfo=detailCards.nth(0);
        assert.equal((await siteInfo.locator('h3').innerText()).trim(),'fixture-site');
        assert.equal(await siteInfo.getByRole('button',{name:'收起'}).count(),0,
          'remove the redundant Collapse button from selected website details');
        assert.equal(await siteInfo.getByRole('button',{name:'编辑 fixture-site'}).count(),0);
        const detailHeader=siteInfo.locator('.config-detail-heading');
        assert.equal(await detailHeader.getByRole('button',{name:'删除 fixture-site'}).count(),0,
          'website title must no longer contain a pill-style Delete control');
        const facts=siteInfo.locator('.config-site-facts');
        assert.deepEqual(await facts.locator(':scope > *').evaluateAll(elements=>
          elements.map(el=>el.classList.contains('config-site-state-row')
            ? el.querySelector('.config-site-state').textContent.trim()
            : el.textContent.trim().slice(0,4))),
          ['域名','fixt','状态','已停用'],
          'domain and status must occupy two label/value rows in the same grid');
        const factLayout=await facts.evaluate(el=>{
          const children=[...el.children].map(c=>c.getBoundingClientRect());
          return {top:children.map(r=>r.top),left:children.map(r=>r.left)};
        });
        assert.ok(Math.abs(factLayout.top[0]-factLayout.top[1])<6);
        assert.ok(Math.abs(factLayout.top[2]-factLayout.top[3])<6);
        assert.ok(factLayout.top[2]>factLayout.top[0]);
        assert.ok(factLayout.left[1]>factLayout.left[0],
          'values occupy second column next to labels');
        assert.deepEqual(await facts.locator('.config-site-domain-row .config-domain').allTextContents(),
          ['fixture.test','www.fixture.test']);
        assert.ok((await siteInfo.innerText()).includes('已停用'));
        const statusActions=siteInfo.locator('.config-site-state-actions');
        assert.deepEqual(await statusActions.locator('button').allTextContents(),['启用','删除'],
          'a stopped website must offer text links for Enable and Delete beside its status');
        const siteTypography=await facts.evaluate(node=>{
          const style=el=>getComputedStyle(el);
          const label=node.querySelector('.config-site-label');
          const value=node.querySelector('.config-site-domain-row .config-domain');
          const actions=[...node.querySelectorAll('.config-site-text-action')];
          const layout=node.querySelector('.config-site-domain-row');
          const removal=layout.querySelector('button');
          const status=node.querySelector('.config-site-state-row');
          return {
            labelWeight:style(label).fontWeight,valueWeight:style(value).fontWeight,
            labelFont:style(label).fontSize,valueFont:style(value).fontSize,
            actions:actions.map(el=>({
              weight:style(el).fontWeight,size:style(el).fontSize,
              color:style(el).color,border:style(el).borderTopWidth,
              radius:style(el).borderTopLeftRadius,
              background:style(el).backgroundColor,
              decoration:style(el).textDecorationLine
            })),
            valueColor:style(value).color,
            removalRight:removal.getBoundingClientRect().right,
            statusRight:status.getBoundingClientRect().right
          };
        });
        assert.equal(siteTypography.labelWeight,'600');
        assert.equal(siteTypography.valueWeight,'400');
        assert.equal(siteTypography.labelFont,siteTypography.valueFont);
        assert.ok(siteTypography.actions.length>=4);
        for(const action of siteTypography.actions){
          assert.equal(action.weight,'400');
          assert.equal(action.size,siteTypography.valueFont);
          assert.equal(action.color,siteTypography.valueColor);
          assert.equal(action.border,'0px');
          assert.equal(action.radius,'0px');
          assert.equal(action.background,'rgba(0, 0, 0, 0)');
          assert.ok(action.decoration.includes('underline'));
        }
        assert.ok(Math.abs(siteTypography.removalRight-siteTypography.statusRight)<2,
          'domain Remove must be flush right like website status actions');
        await statusActions.getByRole('button',{name:'启用 fixture-site'}).click();
        const inlineEnableConfirm=page.getByRole('dialog',{name:'启用网站'});
        await inlineEnableConfirm.waitFor();
        assert.deepEqual(nginxToggleActions,[],'status text action must not write before confirmation');
        await inlineEnableConfirm.getByRole('button',{name:'取消'}).click();
        await inlineEnableConfirm.waitFor({state:'hidden'});
        const nginxConfig=detailCards.nth(1);
        assert.equal(await nginxConfig.getByRole('button',{name:'编辑 fixture-site'}).count(),1,
          'Edit now belongs to the Nginx configuration card');
        await nginxConfig.locator('pre.config-nginx-preview code')
          .getByText('server { listen 80; server_name fixture.test www.fixture.test; }').waitFor();
        const configPreviewStyle=await nginxConfig.locator('pre.config-nginx-preview').evaluate(el=>{
          const cs=getComputedStyle(el);
          return {overflowX:cs.overflowX,background:cs.backgroundColor};
        });
        assert.ok(['auto','scroll'].includes(configPreviewStyle.overflowX),
          'long Nginx configs need horizontal scrolling rather than viewport overflow');
        assert.notEqual(configPreviewStyle.background,'rgba(0, 0, 0, 0)');
        const certPanel=manager.getByRole('region',{name:'SSL 证书管理：fixture-site'});
        const certEditor=certPanel.getByRole('textbox',{name:'CERTIFICATE 1'});
        const keyEditor=certPanel.getByRole('textbox',{name:'PRIVATE KEY 1'});
        await certEditor.waitFor();
        await keyEditor.waitFor();
        await page.waitForFunction(()=>document.querySelector('textarea[aria-label="PRIVATE KEY 1"]')?.value.includes('PRIVATE FIXTURE'));
        assert.equal(await certEditor.inputValue(),currentCert,'show full CERTIFICATE, not PUBLIC KEY');
        assert.equal(await keyEditor.inputValue(),currentKey,'normally display private key without Reveal click');
        assert.equal(nginxPrivateReads,1,'automatically read private key for authenticated Web detail');
        const certShell=detailCards.nth(2);
        const sslOuter=await certShell.evaluate(node=>{
          const css=getComputedStyle(node);
          return {border:css.borderTopWidth,radius:parseFloat(css.borderTopLeftRadius)};
        });
        assert.equal(sslOuter.border,'1px');assert.ok(sslOuter.radius>=12);
        const inner=await certShell.locator('.nginx-certificates').evaluate(node=>{
          const css=getComputedStyle(node);
          return {border:css.borderTopWidth,padding:css.padding,
            background:css.backgroundColor,shadow:css.boxShadow};
        });
        assert.equal(inner.border,'0px');assert.equal(inner.padding,'0px');
        assert.equal(inner.background,'rgba(0, 0, 0, 0)');assert.equal(inner.shadow,'none');
        const sides=certPanel.locator('.nginx-tls-column');
        assert.equal(await sides.count(),2);
        const grid=await certPanel.locator('.nginx-tls-columns').evaluate(node=>{
          const css=getComputedStyle(node),a=node.children[0].getBoundingClientRect(),
            b=node.children[1].getBoundingClientRect();
          return {gap:css.columnGap,firstWidth:a.width,secondWidth:b.width,
            firstRight:a.right,secondLeft:b.left,firstTop:a.top,secondTop:b.top};
        });
        assert.equal(grid.gap,'0px');
        assert.ok(Math.abs(grid.firstWidth-grid.secondWidth)<=1);
        assert.ok(Math.abs(grid.firstRight-grid.secondLeft)<=1);
        assert.ok(Math.abs(grid.firstTop-grid.secondTop)<=1);
        assert.equal(await sides.nth(0).locator('.nginx-tls-path').innerText(),
          '/etc/letsencrypt/live/fixture.test/fullchain.pem');
        assert.equal(await sides.nth(1).locator('.nginx-tls-path').innerText(),
          '/etc/letsencrypt/live/fixture.test/privkey.pem');
        assert.equal(await certPanel.getByRole('button',{name:'保存',exact:true}).count(),2);
        const draftCertificate=currentCert+'\n';
        await certEditor.fill(draftCertificate);
        assert.equal(tlsSaves.length,0,'typing must not write before Save');
        await sides.nth(0).getByRole('button',{name:'保存'}).click();
        await certPanel.getByText('证书已保存并重新加载').waitFor();
        assert.equal(tlsSaves.length,1);
        assert.equal(tlsSaves[0].updateCertificate,true);
        assert.equal(tlsSaves[0].updatePrivateKey,false);
        assert.equal(tlsSaves[0].revision,'a'.repeat(64));
        assert.equal(await certEditor.inputValue(),draftCertificate);
        const draftKey=currentKey+'\n';
        await keyEditor.fill(draftKey);
        await sides.nth(1).getByRole('button',{name:'保存'}).click();
        await certPanel.getByText('证书已保存并重新加载').waitFor();
        assert.equal(tlsSaves.length,2);
        assert.equal(tlsSaves[1].updateCertificate,false);
        assert.equal(tlsSaves[1].updatePrivateKey,true);
        assert.equal(tlsSaves[1].revision,'b'.repeat(64));
        await certPanel.getByRole('button',{name:'刷新证书'}).click();
        await page.waitForFunction(()=>document.querySelector('textarea[aria-label="PRIVATE KEY 1"]')?.value.includes('PRIVATE FIXTURE'));
        assert.equal(await keyEditor.inputValue(),draftKey);
        const addDomain=siteInfo.getByRole('button',{name:'添加域名'});
        await addDomain.click();
        const domainInput=siteInfo.getByRole('textbox',{name:'新域名'});
        await domainInput.fill('added.fixture.test');
        assert.equal(nginxSites[0].serverNames,'fixture.test, www.fixture.test',
          'adding a domain should never write before explicit Save');
        await siteInfo.getByRole('button',{name:'取消'}).click();
        assert.equal(nginxSites[0].serverNames,'fixture.test, www.fixture.test',
          'canceling domain addition does not change config');
        await addDomain.click();
        await domainInput.fill('bad; include /etc/passwd;');
        await siteInfo.getByRole('button',{name:'保存域名'}).click();
        await siteInfo.getByRole('alert').getByText('合法域名').waitFor();
        assert.ok(!(nginxSites[0].content.includes('include /etc/passwd')),
          'unsafe input must never write to site');
        await domainInput.fill('added.fixture.test');
        await siteInfo.getByRole('button',{name:'保存域名'}).click();
        await facts.getByText('added.fixture.test').waitFor();
        assert.ok(nginxSites[0].content.includes('server_name fixture.test www.fixture.test added.fixture.test;'));
        assert.equal(await siteInfo.getByRole('button',{name:'添加域名'}).count(),1);
        const removeAdded=siteInfo.getByRole('button',{name:'删除域名 added.fixture.test'});
        await removeAdded.click();
        const removeDomainDialog=page.getByRole('dialog',{name:'确认移除域名'});
        await removeDomainDialog.waitFor();
        assert.ok(nginxSites[0].content.includes('added.fixture.test'),
          'opening domain removal confirmation cannot write');
        await removeDomainDialog.getByRole('button',{name:'取消'}).click();
        await removeDomainDialog.waitFor({state:'hidden'});
        assert.ok(nginxSites[0].content.includes('added.fixture.test'));
        await removeAdded.click();
        await removeDomainDialog.getByRole('button',{name:'确认移除'}).click();
        await removeDomainDialog.waitFor({state:'hidden'});
        await facts.getByText('added.fixture.test').waitFor({state:'detached'});
        assert.equal(nginxSites[0].serverNames,'fixture.test, www.fixture.test');
        assert.ok(!nginxSites[0].content.includes('added.fixture.test'));
        await nginxConfig.locator('pre.config-nginx-preview code')
          .getByText('server { listen 80; server_name fixture.test www.fixture.test; }').waitFor();
        const inlineEditButton=nginxConfig.getByRole('button',{name:'编辑 fixture-site'});
        await inlineEditButton.click();
        assert.equal(await page.getByRole('dialog',{name:'编辑网站配置'}).count(),0,
          'website editing should no longer open a standalone modal');
        const inlineEditor=nginxConfig.getByRole('textbox',{name:'Nginx 配置内容'});
        await inlineEditor.waitFor();
        assert.equal(await inlineEditor.inputValue(),
          'server { listen 80; server_name fixture.test www.fixture.test; }');
        assert.equal(await nginxConfig.locator('pre.config-nginx-preview').count(),0,
          'edit mode replaces the preview with a textarea in the same card');
        const originalConfig=nginxSites.find(site=>site.name==='fixture-site').content;
        await inlineEditor.fill('server { listen 7000; server_name fixture.test www.fixture.test; }');
        assert.equal(nginxSites.find(site=>site.name==='fixture-site').content,originalConfig,
          'typing in the inline editor must not write to server');
        await nginxConfig.getByRole('button',{name:'取消',exact:true}).click();
        assert.equal(await inlineEditor.count(),0,'Cancel leaves inline edit mode');
        assert.equal(nginxSites.find(site=>site.name==='fixture-site').content,originalConfig);
        await nginxConfig.locator('pre.config-nginx-preview code')
          .getByText(originalConfig).waitFor();
        await inlineEditButton.click();
        await inlineEditor.fill('server { listen 8080; server_name fixture.test www.fixture.test; }');
        assert.equal(await siteInfo.getByRole('button',{name:'编辑 fixture-site'}).count(),0);
        await nginxConfig.getByRole('button',{name:'保存配置'}).click();
        await nginxConfig.locator('pre.config-nginx-preview code')
          .getByText('server { listen 8080; server_name fixture.test www.fixture.test; }').waitFor();
        assert.equal(nginxSites.find(site=>site.name==='fixture-site').content,
          'server { listen 8080; server_name fixture.test www.fixture.test; }');
        assert.equal(await detailCards.count(),3,
          'inline editing must preserve all three detail rectangles');
        // Simulated concurrent edit: a stale revision must be refused while
        // keeping the user's pending textarea content intact for recovery.
        await inlineEditButton.click();
        await inlineEditor.fill('server { listen 9000; server_name fixture.test www.fixture.test; }');
        nginxSites.find(site=>site.name==='fixture-site').revision=revision();
        await nginxConfig.getByRole('button',{name:'保存配置'}).click();
        await nginxConfig.getByRole('alert').getByText('版本冲突').waitFor();
        assert.equal(await inlineEditor.inputValue(),
          'server { listen 9000; server_name fixture.test www.fixture.test; }',
          'failed Save must retain the unsaved inline draft');
        assert.equal(nginxSites.find(site=>site.name==='fixture-site').content,
          'server { listen 8080; server_name fixture.test www.fixture.test; }',
          'stale save must not change actual config');
        await nginxConfig.getByRole('button',{name:'取消'}).click();
        await headerButtons.getByRole('button',{name:'刷新数据'}).click();
        await nginxConfig.locator('pre.config-nginx-preview code')
          .getByText('server { listen 8080; server_name fixture.test www.fixture.test; }').waitFor();
        await website.click();
        await details.waitFor({state:'detached'});
        assert.equal(await website.getAttribute('aria-pressed'),'false');
        assert.equal(await manager.getByRole('button',{name:'编辑 fixture-site'}).count(),0);
        await website.click();
        await details.waitFor();
        assert.equal(await details.locator(':scope > .config-detail-card').count(),3,
          'reopening site details restores all three rounded rectangles');
        await nginxConfig.locator('pre.config-nginx-preview code')
          .getByText('server { listen 8080; server_name fixture.test www.fixture.test; }').waitFor();
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
        assert.deepEqual(await statusActions.locator('button').allTextContents(),['停用','删除'],
          'status action must switch to Stop for an enabled website');
        await statusActions.getByRole('button',{name:'停用 fixture-site'}).click();
        const inlineDisableConfirm=page.getByRole('dialog',{name:'停用网站'});
        await inlineDisableConfirm.waitFor();
        assert.deepEqual(nginxToggleActions,['enable'],
          'status Stop also requires confirmation, without an implicit write');
        await inlineDisableConfirm.getByRole('button',{name:'取消'}).click();
        await inlineDisableConfirm.waitFor({state:'hidden'});
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
        await headerButtons.getByRole('button',{name:'刷新数据'}).click();
        await details.waitFor();
        assert.equal(await website.getAttribute('aria-pressed'),'true',
          'refresh should not lose the selected website');
        await headerButtons.getByRole('button',{name:'检查 Nginx 配置'}).click();
        await manager.getByText('配置检查通过',{exact:true}).waitFor();
        await details.getByRole('button',{name:'删除 fixture-site'}).click();
        await page.getByRole('dialog',{name:'删除网站配置'})
          .getByRole('button',{name:'确认操作'}).click();
        await manager.getByText('没有找到站点配置文件').waitFor();
        assert.equal(await details.count(),0,'removing the selected site must close the details pane');
        assert.equal(await manager.locator('.nginx-certificates').count(),0);
        await headerButtons.getByRole('button',{name:'新建网站'}).click();
        await editor.getByRole('textbox',{name:'配置文件名'}).fill('unrelated-site');
        await editor.getByRole('textbox',{name:'Nginx 配置内容'})
          .fill('server { listen 80; server_name no-match.example.test; }');
        await editor.getByRole('button',{name:'保存配置'}).click();
        await manager.getByRole('button',{name:'查看网站 unrelated-site'}).click();
        const unmatched=manager.getByRole('region',{name:'SSL 证书管理：unrelated-site'});
        await unmatched.getByText('当前站点文件未直接声明 SSL 证书路径。').waitFor();
        assert.equal(await unmatched.getByRole('button',{name:/续期证书/}).count(),0);
        assert.equal(await manager.locator('.config-detail-panel > .config-detail-card').count(),3,
          'unmatched sites still show information, configuration and SSL panels');
        await manager.getByRole('region',{name:'Nginx 配置'})
          .getByText('server { listen 80; server_name no-match.example.test; }').waitFor();
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
        assert.equal(await browser.locator('.file-toolbar.panel-control-capsule').count(),0,
          'file creation/upload are standalone commands, not a grouped segmented capsule');
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
        const textMetadata=await browser.getByRole('button',{name:'修改权限和属主 note.txt',exact:true})
          .evaluate(node=>{const css=getComputedStyle(node),time=getComputedStyle(
            node.closest('tr').querySelector('.file-date'));
            return {border:css.borderTopWidth,background:css.backgroundColor,
              timeBackground:time.backgroundColor,round:css.borderTopLeftRadius};
          });
        assert.equal(textMetadata.border,'0px','permissions display must not have a button border');
        assert.equal(textMetadata.background,textMetadata.timeBackground,
          'permissions should use the same transparent text appearance as modified time');
        assert.equal(textMetadata.round,'0px','permissions should not be a pill');
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
          const css=getComputedStyle(select),pseudo=getComputedStyle(select.closest('label'),'::after');
          return {appearance:css.appearance,position:css.backgroundPosition,
            image:css.backgroundImage,padding:css.paddingRight,pseudoContent:pseudo.content};
        });
        assert.equal(selectArrow.appearance,'none');
        assert.match(selectArrow.position,/14px/,'chevron right inset should match its vertical margin');
        assert.match(selectArrow.image,/data:image\/svg\+xml/);
        assert.equal(selectArrow.padding,'34px','select text needs room before the arrow');
        assert.ok(!selectArrow.pseudoContent||selectArrow.pseudoContent==='none',
          'file dialogs should not draw a duplicate select chevron');
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
        const createFileDialog=browser.getByRole('dialog',{name:'新建文件',exact:true});
        await createFileDialog.waitFor();
        assert.equal(await browser.locator('.file-entry-form').count(),0,
          'new file input must not appear inline under the toolbar');
        await createFileDialog.getByRole('button',{name:'取消'}).click();
        await createFileDialog.waitFor({state:'detached'});
        await assert.rejects(readFile(join(fileFixture,'cancelled-'+width+'.txt')),{code:'ENOENT'});
        await browser.getByRole('button',{name:'新建文件',exact:true}).click();
        await createFileDialog.getByRole('textbox',{name:'名称',exact:true}).fill('created-'+width+'.txt');
        await createFileDialog.getByRole('button',{name:'确定',exact:true}).click();
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
        const createDirDialog=browser.getByRole('dialog',{name:'新建文件夹',exact:true});
        await createDirDialog.waitFor();
        await createDirDialog.getByRole('textbox',{name:'名称',exact:true}).fill('new-dir-'+width);
        await createDirDialog.getByRole('button',{name:'确定',exact:true}).click();
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
        await browser.getByRole('dialog',{name:'新建文件',exact:true}).getByRole('textbox',{name:'名称',exact:true}).fill('child.txt');
        await browser.getByRole('dialog',{name:'新建文件',exact:true}).getByRole('button',{name:'确定',exact:true}).click();
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
      if(name.trim()==='V2Ray' && [390,1280].includes(width)){
        const panel=page.locator('.v2ray-manager');
        await panel.waitFor();
        await panel.getByText('V2Ray 5.47.0').waitFor();
        const summary=panel.locator(':scope > .v2ray-summary');
        const cards=summary.locator(':scope > .v2ray-status-card');
        const serviceCard=cards.nth(1),autostartCard=cards.nth(2);
        const configLine=panel.locator(':scope > .v2ray-config-line');
        assert.equal(await cards.count(),4);
        assert.deepEqual(await cards.locator(':scope > span').allTextContents(),
          ['内核','服务','开机启动','入站 / 出站']);
        assert.deepEqual(await cards.locator(':scope > strong').allTextContents(),
          ['V2Ray 5.47.0','运行中','已启用','1 / 1']);
        assert.deepEqual((await serviceCard.getByRole('button').allTextContents()).map(s=>s.trim()),
          ['启动','停止','重启'],'service card owns its start/stop/restart actions');
        assert.equal(await autostartCard.getByRole('button',{name:'关闭开机自启'}).count(),1,
          'auto-start control belongs inside its own state card');
        assert.equal((await configLine.locator('.v2ray-config-path').innerText()).trim(),
          '配置文件：/usr/local/etc/v2ray/config.json');
        assert.deepEqual((await configLine.getByRole('button').allTextContents()).map(s=>s.trim()),
          ['刷新状态与配置'],'the refresh button belongs to the config path row');
        assert.equal(await panel.locator('.v2ray-service-toolbar,.v2ray-tabbar,.v2ray-rows,.v2ray-section-picker').count(),0,
          'no duplicate service toolbar, capability overview or old tab/selector UI');
        const nav=panel.getByRole('navigation',{name:'V2Ray 配置目录'});
        await nav.waitFor();
        const geometry=await panel.evaluate(node=>{
          const summary=node.querySelector('.v2ray-summary');
          const path=node.querySelector('.v2ray-config-line');
          const nav=node.querySelector('.v2ray-config-nav'),editor=node.querySelector('.v2ray-editor-content');
          const shape=n=>{
            const css=getComputedStyle(n),r=n.getBoundingClientRect();
            return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,border:css.borderTopWidth,
              radius:css.borderTopLeftRadius,padding:css.paddingLeft,background:css.backgroundColor};
          };
          const outer=getComputedStyle(node.closest('.action-card'));
          return {summary:shape(summary),path:shape(path),
            cards:[...summary.children].map(shape),
            pathButton:shape(path.querySelector('button')),
            nav:nav&&shape(nav),editor:editor&&shape(editor),
            outer:{radius:outer.borderTopLeftRadius,border:outer.borderTopWidth,
              padding:outer.paddingLeft,background:outer.backgroundColor}};
        });
        assert.ok(geometry.summary.bottom<=geometry.path.top,
          'the config path and right aligned refresh must follow all four cards');
        assert.ok(geometry.cards.every(r=>r.border==='1px'&&parseFloat(r.radius)>=12
          && parseFloat(r.padding)>0&&r.background!=='rgba(0, 0, 0, 0)'),
          'each metric must keep its own rounded status card');
        assert.ok(geometry.outer.radius==='0px'&&geometry.outer.border==='0px'
          && geometry.outer.padding==='0px'&&geometry.outer.background==='rgba(0, 0, 0, 0)',
          'the common V2Ray ActionCard must remain unboxed');
        assert.ok(geometry.pathButton.right<=geometry.path.right+1
          && geometry.path.right-geometry.pathButton.right<2,
          'refresh aligns with the far right edge of the config path row');
        if(width===1280)assert.ok(geometry.cards.every(r=>r.top===geometry.cards[0].top),
          'desktop shows four status cards in one row');
        assert.ok(geometry.nav.right<=geometry.editor.left+1,
          'JSON editor must be to the right of the vertical section list');
        assert.equal(await panel.getByRole('tab').count(),0,'remove capability overview and all editing tabs');
        const first=nav.locator('.v2ray-config-item').first();
        assert.equal((await first.innerText()).trim(),'完整内容（JSON 根对象）',
          'full configuration is the first entry in the left vertical list');
        assert.equal(await first.getAttribute('aria-pressed'),'true');
        const navLabels=(await nav.locator('.v2ray-config-item').allTextContents()).map(v=>v.trim());
        const expectedSectionKeys=['inbounds','outbounds','routing','dns','inboundDetour','outboundDetour'];
        assert.equal(navLabels.length,expectedSectionKeys.length+1);
        for(let k=0;k<expectedSectionKeys.length;k++){
          assert.ok(navLabels[k+1].endsWith('（'+expectedSectionKeys[k]+'）'),
            'sidebar entry must annotate a present root config key: '+expectedSectionKeys[k]);
        }
        const addFieldButton=nav.getByRole('button',{name:'添加字段',exact:true});
        assert.equal(await addFieldButton.count(),1);
        const sidebarGeometry=await nav.evaluate(root=>{
          const add=root.querySelector('.v2ray-field-add-button').getBoundingClientRect();
          const fullCard=root.querySelector('.v2ray-config-full-card');
          const fieldsCard=root.querySelector('.v2ray-config-fields-card');
          const full=fullCard.getBoundingClientRect(),fields=fieldsCard.getBoundingClientRect();
          const shape=node=>{
            const css=getComputedStyle(node);
            return {bg:css.backgroundColor,border:css.borderTopWidth,
              radius:parseFloat(css.borderTopLeftRadius),overflowY:css.overflowY};
          };
          return {addBelow:add.bottom,fullAbove:full.top,fullBelow:full.bottom,
            configAbove:fields.top,nav:shape(root),fullCard:shape(fullCard),fieldsCard:shape(fieldsCard)};
        });
        assert.ok(sidebarGeometry.addBelow<=sidebarGeometry.fullAbove,
          'standalone Add field button must be above the Full config entry');
        assert.ok(sidebarGeometry.configAbove-sidebarGeometry.fullBelow>=10,
          'Full config needs a visual gap before the fields container');
        assert.equal(sidebarGeometry.nav.bg,'rgba(0, 0, 0, 0)',
          'the navigation itself must have no shared gray background');
        for(const key of ['fullCard','fieldsCard']){
          assert.equal(sidebarGeometry[key].border,'1px',
            key+' must use its own visible rounded container border');
          assert.ok(sidebarGeometry[key].radius>=10,
            key+' must have rounded rectangle corners');
          assert.notEqual(sidebarGeometry[key].bg,'rgba(0, 0, 0, 0)',
            key+' must own its background independently of the nav');
        }
        assert.equal(sidebarGeometry.fieldsCard.overflowY,'auto',
          'only the configured-fields container should scroll');
        assert.notEqual(sidebarGeometry.fullCard.overflowY,'auto',
          'Full config card must not become an independently scrolling pane');
        const scrollProof=await nav.evaluate(root=>{
          const list=root.querySelector('.v2ray-config-fields-card');
          const full=root.querySelector('.v2ray-config-full-card');
          const add=root.querySelector('.v2ray-field-add-button');
          const baseline={fullTop:full.getBoundingClientRect().top,
            addTop:add.getBoundingClientRect().top,navTop:root.getBoundingClientRect().top};
          root.style.maxHeight='178px';
          list.scrollTop=120;
          const result={listScrollTop:list.scrollTop,listCanScroll:list.scrollHeight>list.clientHeight,
            navScrollTop:root.scrollTop,fullTop:full.getBoundingClientRect().top,
            addTop:add.getBoundingClientRect().top,navTop:root.getBoundingClientRect().top,
            baseline};
          list.scrollTop=0;
          root.style.maxHeight='';
          return result;
        });
        assert.ok(scrollProof.listCanScroll && scrollProof.listScrollTop>=30,
          'the configured-fields card must scroll independently when space is constrained');
        assert.equal(scrollProof.navScrollTop,0,
          'the complete sidebar must not scroll as one unit');
        assert.equal(scrollProof.fullTop,scrollProof.baseline.fullTop,
          'Full config card stays in place while fields scroll');
        assert.equal(scrollProof.addTop,scrollProof.baseline.addTop,
          'Add field stays in place while fields scroll');
        assert.equal(await panel.getByRole('button',{name:'安装 V2Ray 5.47.0'}).count(),0,
          'installation stays hidden when V2Ray is present');
        const editor=panel.getByRole('textbox',{name:'完整 V2Ray JSON 配置'});
        await editor.waitFor();
        assert.ok((await editor.inputValue()).includes('customUnknown'),
          'the full JSON must preserve unknown fields');
        // A missing section only appears after explicit confirmation and is
        // initialized in the correct type; cancel or draft-only edits never save.
        await addFieldButton.click();
        const addDialog=panel.getByRole('dialog',{name:'添加配置字段'});
        await addDialog.waitFor();
        const fieldSelect=addDialog.getByRole('combobox',{name:'选择尚未配置的字段'});
        const availableKeys=await fieldSelect.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
        assert.ok(availableKeys.includes('policy')&&availableKeys.includes('transport'));
        assert.ok(!availableKeys.includes('inbounds')&&!availableKeys.includes('outbounds'));
        await fieldSelect.selectOption('policy');
        await addDialog.getByRole('button',{name:'取消'}).click();
        await addDialog.waitFor({state:'hidden'});
        assert.equal(await nav.getByRole('button',{name:'策略（policy）'}).count(),0,
          'cancel must not add the selected section');
        await addFieldButton.click();
        await fieldSelect.selectOption('policy');
        await addDialog.getByRole('button',{name:'添加',exact:true}).click();
        await addDialog.waitFor({state:'hidden'});
        assert.equal(await nav.getByRole('button',{name:'策略（policy）'}).count(),1);
        assert.equal(await panel.getByRole('textbox',{name:'当前配置部分 JSON'}).inputValue(),'{}',
          'new general config section defaults to an object');
        await nav.getByRole('button',{name:'完整内容'}).click();
        const addedDraft=JSON.parse(await editor.inputValue());
        assert.deepEqual(addedDraft.policy,{});
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,0);
        delete addedDraft.policy;
        await editor.fill(JSON.stringify(addedDraft,null,2));
        assert.equal(await nav.getByRole('button',{name:'策略（policy）'}).count(),0,
          'removed raw JSON key must disappear from the left navigation');
        assert.equal(await addFieldButton.isDisabled(),false);
        const newConfig=JSON.parse(await editor.inputValue());
        newConfig.log={loglevel:'info'};
        await editor.fill(JSON.stringify(newConfig,null,2));
        await panel.getByRole('button',{name:'校验配置'}).click();
        await panel.getByText('配置检查通过',{exact:true}).waitFor();
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,0,'testing must not save');
        await panel.getByRole('button',{name:'保存并应用'}).click();
        await panel.getByText('保存成功',{exact:true}).waitFor();
        assert.equal(JSON.parse(v2rayConfig).customUnknown.value,true);
        assert.equal(JSON.parse(v2rayConfig).log.loglevel,'info');
        // Regression: a transient panel status failure after a successful Save
        // must not strand the editor on the previous SHA-256 revision. Both
        // this save and the next save must succeed without manually refreshing.
        const followup=JSON.parse(await editor.inputValue());
        followup.log.temporaryMarker='second-save';
        await editor.fill(JSON.stringify(followup,null,2));
        v2rayFailStatusOnce=true;
        await panel.getByRole('button',{name:'保存并应用'}).click();
        await panel.getByText(/保存成功；状态摘要刷新失败/).waitFor();
        assert.equal(JSON.parse(v2rayConfig).log.temporaryMarker,'second-save');
        const finalDraft=JSON.parse(await editor.inputValue());
        delete finalDraft.log.temporaryMarker;
        await editor.fill(JSON.stringify(finalDraft,null,2));
        await panel.getByRole('button',{name:'保存并应用'}).click();
        await panel.getByText('保存成功',{exact:true}).waitFor();
        assert.equal(JSON.parse(v2rayConfig).log.temporaryMarker,undefined);
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,3,
          'two consecutive Saves after a status outage use updated revisions');
        await nav.getByRole('button',{name:'DNS（dns）',exact:true}).click();
        const part=panel.getByRole('textbox',{name:'当前配置部分 JSON'});
        assert.ok((await part.inputValue()).includes('1.1.1.1'));
        // Invalid section content must block navigation; none may be silently discarded.
        await part.fill('{invalid');
        await nav.getByRole('button',{name:'完整内容'}).click();
        assert.equal(await part.count(),1,'invalid JSON must keep the current section visible');
        assert.equal(await nav.getByRole('button',{name:'DNS（dns）',exact:true}).getAttribute('aria-pressed'),'true');
        const dns={servers:['1.1.1.1','8.8.8.8']};
        await part.fill(JSON.stringify(dns,null,2));
        await nav.getByRole('button',{name:'完整内容'}).click();
        assert.equal(JSON.parse(await editor.inputValue()).dns.servers[1],'8.8.8.8',
          'section edits must carry into the full JSON without saving to the server');
        assert.equal(JSON.parse(await editor.inputValue()).customUnknown.value,true,
          'switching editors must preserve unknown configuration fields');
        assert.equal(await nav.getByRole('button',{name:'API（api）'}).count(),0,
          'unconfigured sections must not appear without explicit adding');
        assert.equal(Object.hasOwn(JSON.parse(await editor.inputValue()),'api'),false,
          'unconfigured keys remain absent when unrelated sections are visited');
        const header=panel.locator('.v2ray-editor-header');
        const viewToggle=header.locator('.v2ray-view-toggle');
        assert.deepEqual((await viewToggle.getByRole('button').allTextContents()).map(s=>s.trim()),
          ['可视化','JSON'],'two editor mode controls appear beside the top action toolbar');
        const headerPosition=await panel.evaluate(node=>{
          const h=node.querySelector('.v2ray-editor-header').getBoundingClientRect();
          const editor=node.querySelector('.v2ray-editor-content textarea').getBoundingClientRect();
          return {actionsBottom:h.bottom,editorTop:editor.top};
        });
        assert.ok(headerPosition.actionsBottom<=headerPosition.editorTop,
          'validate, save and discard buttons must appear above the editor');
        await nav.getByRole('button',{name:'入站连接（inbounds）',exact:true}).click();
        await panel.locator('.v2ray-visual-editor').waitFor();
        assert.equal(await viewToggle.getByRole('button',{name:'可视化'}).getAttribute('aria-pressed'),'true');
        const inboundVisual=panel.locator('.v2ray-visual-editor');
        assert.equal(await inboundVisual.locator('.v2ray-visual-group-heading').count(),1,
          'standard inbounds must not render inboundDetour connections');
        assert.ok((await inboundVisual.locator('.v2ray-visual-group-heading').innerText())
          .includes('入站连接（inbounds）'));
        assert.equal(await inboundVisual.getByText('legacy-in').count(),0,
          'legacy inbound entry must stay outside standard inbound editor');
        assert.equal(await inboundVisual.getByRole('textbox',{name:'标签（tag）'}).count(),0,
          'connection tag must be edited through the standalone rename dialog, not inline');
        const inboundEntry=inboundVisual.locator('.v2ray-visual-entry').first();
        const inboundHeading=inboundEntry.locator(':scope > .v2ray-visual-entry-heading');
        const inboundRename=inboundHeading.getByRole('button',{name:'重命名入站连接1'});
        assert.deepEqual((await inboundHeading.locator('.v2ray-visual-entry-actions button')
          .allTextContents()).map(s=>s.trim()),['重命名','移除']);
        const allInputLabels=await inboundVisual.locator('.v2ray-visual-fields > label').allTextContents();
        for(const original of ['protocol','listen','port','streamSettings.network',
          'streamSettings.security','id','email','alterId']){
          assert.ok(allInputLabels.some(t=>t.includes('（'+original+'）')),
            'inbound and nested field labels must annotate raw JSON key '+original);
        }
        assert.ok((await inboundVisual.locator('.v2ray-visual-entry-heading strong').allTextContents())
          .some(t=>t.includes('settings.clients')),
          'nested clients heading must identify their JSON path');
        const visualFont=await inboundVisual.getByRole('combobox',{name:'协议（protocol）'}).evaluate(select=>({
          title:getComputedStyle(select.closest('label')).fontWeight,
          value:getComputedStyle(select).fontWeight
        }));
        assert.equal(visualFont.title,'600','all visual section titles are bold');
        assert.equal(visualFont.value,'400','all visual section input values use regular type');
        const choices={
          protocol:inboundVisual.getByRole('combobox',{name:'协议（protocol）',exact:true}),
          listen:inboundVisual.getByRole('combobox',{name:'监听地址（listen）',exact:true}),
          network:inboundVisual.getByRole('combobox',{name:'传输网络（streamSettings.network）',exact:true}),
          security:inboundVisual.getByRole('combobox',{name:'传输安全（streamSettings.security）',exact:true})
        };
        assert.equal(await choices.protocol.inputValue(),'socks');
        assert.equal(await choices.listen.inputValue(),'192.0.2.55',
          'uncommon current bind addresses must remain an actual selected option');
        assert.equal(await choices.listen.locator('option[value="192.0.2.55"]').count(),1);
        assert.equal(await choices.network.inputValue(),'ws');
        assert.equal(await choices.security.inputValue(),'tls');
        const dropdownFont=await choices.security.evaluate(select=>({
          title:getComputedStyle(select.closest('label')).fontWeight,
          value:getComputedStyle(select).fontWeight
        }));
        assert.equal(dropdownFont.title,'600');
        assert.equal(dropdownFont.value,'400','select values must never inherit bold label weight');
        const clientId=inboundVisual.getByRole('textbox',{name:'客户端 1 · ID'});
        assert.equal(await clientId.getAttribute('type'),'text',
          'the client identifier must no longer be a password input');
        assert.equal(await clientId.inputValue(),'client-uuid-visible');
        await choices.protocol.selectOption('vmess');
        await choices.listen.selectOption('127.0.0.1');
        await choices.network.selectOption('tcp');
        await choices.security.selectOption('none');
        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        let selectJson=JSON.parse(await panel.getByRole('textbox',{name:'当前配置部分 JSON'}).inputValue())[0];
        assert.deepEqual([selectJson.protocol,selectJson.listen,selectJson.streamSettings.network,
          selectJson.streamSettings.security],['vmess','127.0.0.1','tcp','none'],
          'selector edits round trip to candidate JSON without implicit server writes');
        assert.equal(selectJson.settings.clients[0].id,'client-uuid-visible');
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,3);
        await viewToggle.getByRole('button',{name:'可视化'}).click();
        await inboundRename.click();
        const connectionRenameDialog=panel.getByRole('dialog',{name:'重命名连接'});
        await connectionRenameDialog.waitFor();
        const connectionTag=connectionRenameDialog.getByRole('textbox',{name:'连接标签（tag）'});
        assert.equal(await connectionTag.inputValue(),'socks');
        await connectionTag.fill('discard-me');
        await connectionRenameDialog.getByRole('button',{name:'取消'}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        assert.ok((await inboundHeading.innerText()).includes('连接 1 · socks'),
          'canceling a connection rename must not change tag');
        await inboundRename.click();
        await connectionTag.fill('local-visual');
        await connectionRenameDialog.getByRole('button',{name:'确认',exact:true}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        assert.ok((await inboundHeading.innerText()).includes('连接 1 · local-visual'),
          'confirming a connection rename updates its title in local draft only');
        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        let visualJson=panel.getByRole('textbox',{name:'当前配置部分 JSON'});
        await visualJson.waitFor();
        assert.equal(JSON.parse(await visualJson.inputValue())[0].tag,'local-visual',
          'visual change remains after switching to JSON');
        await visualJson.fill(JSON.stringify([{tag:'json-changed',protocol:'socks',port:10080}],null,2));
        await viewToggle.getByRole('button',{name:'可视化'}).click();
        assert.ok((await inboundHeading.innerText()).includes('连接 1 · json-changed'),
          'JSON edits must carry into the connection title');
        await inboundRename.click();
        assert.equal(await connectionTag.inputValue(),'json-changed',
          'connection rename dialog must read existing tag exactly');
        await connectionRenameDialog.getByRole('button',{name:'取消'}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        await nav.getByRole('button',{name:'旧版入站扩展（inboundDetour）',exact:true}).click();
        assert.equal(await inboundVisual.locator('.v2ray-visual-group-heading').count(),1,
          'legacy inbound has its own visual section');
        assert.ok((await inboundVisual.locator('.v2ray-visual-group-heading').innerText())
          .includes('旧版入站扩展（inboundDetour） · 1'));
        assert.ok((await inboundVisual.locator('.v2ray-visual-entry-heading').first().innerText())
          .includes('legacy-in'));
        const legacyInHeading=inboundVisual.locator('.v2ray-visual-entry-heading').first();
        assert.deepEqual((await legacyInHeading.locator('.v2ray-visual-entry-actions button')
          .allTextContents()).map(s=>s.trim()),['重命名','移除']);
        await legacyInHeading.getByRole('button',{name:'重命名旧版入站扩展1'}).click();
        assert.equal(await connectionTag.inputValue(),'legacy-in');
        await connectionTag.fill('legacy-in-changed');
        await connectionRenameDialog.getByRole('button',{name:'确认',exact:true}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        assert.equal(JSON.parse(await panel.getByRole('textbox',{name:'当前配置部分 JSON'}).inputValue())[0].tag,
          'legacy-in-changed','legacy inbound editing must write only inboundDetour JSON');
        await nav.getByRole('button',{name:'入站连接（inbounds）',exact:true}).click();
        assert.equal(await inboundVisual.locator('.v2ray-visual-group-heading').count(),1);
        assert.ok((await inboundVisual.locator('.v2ray-visual-entry-heading').first().innerText())
          .includes('连接 1 · json-changed'),
          'legacy inbound edit must not change ordinary inbounds');
        await nav.getByRole('button',{name:'出站连接（outbounds）',exact:true}).click();
        assert.equal(await inboundVisual.locator('.v2ray-visual-group-heading').count(),1,
          'outbounds and outboundDetour must have separate editors');
        assert.ok((await inboundVisual.locator('.v2ray-visual-group-heading').innerText())
          .includes('出站连接（outbounds） · 1'));
        assert.equal(await inboundVisual.getByText('legacy-out').count(),0,
          'ordinary outbound page must not show legacy outbound entry');
        const outboundHeading=inboundVisual.locator('.v2ray-visual-entry-heading').first();
        assert.deepEqual((await outboundHeading.locator('.v2ray-visual-entry-actions button')
          .allTextContents()).map(s=>s.trim()),['重命名','移除']);
        const outboundRename=outboundHeading.getByRole('button',{name:'重命名出站连接1'});
        await outboundRename.click();
        assert.equal(await connectionTag.inputValue(),'direct');
        await connectionTag.fill('');
        await connectionTag.press('Enter');
        await connectionRenameDialog.waitFor({state:'hidden'});
        assert.ok((await outboundHeading.innerText()).includes('连接 1 · freedom'),
          'clearing a connection tag deletes only tag and restores protocol title fallback');
        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        const noTagOutbound=JSON.parse(await panel.getByRole('textbox',{name:'当前配置部分 JSON'}).inputValue())[0];
        assert.equal(Object.hasOwn(noTagOutbound,'tag'),false,
          'empty rename must remove tag, not replace with empty literal');
        assert.equal(noTagOutbound.protocol,'freedom',
          'renaming must preserve outbound protocol');
        await viewToggle.getByRole('button',{name:'可视化'}).click();
        await outboundRename.click();
        assert.equal(await connectionTag.inputValue(),'',
          'dialog must be blank if the tag is missing; never use protocol fallback');
        await connectionTag.fill('direct');
        await connectionRenameDialog.getByRole('button',{name:'确认',exact:true}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        assert.ok((await outboundHeading.innerText()).includes('连接 1 · direct'));
        await nav.getByRole('button',{name:'旧版出站扩展（outboundDetour）',exact:true}).click();
        const legacyHeading=inboundVisual.locator('.v2ray-visual-group-heading');
        assert.equal(await legacyHeading.count(),1,
          'legacy outbound has one standalone group');
        assert.ok((await legacyHeading.innerText()).includes('旧版出站扩展（outboundDetour） · 1'));
        assert.ok((await inboundVisual.locator('.v2ray-visual-entry-heading').first().innerText())
          .includes('legacy-out'));
        const oldOutboundHeading=inboundVisual.locator('.v2ray-visual-entry-heading').first();
        assert.deepEqual((await oldOutboundHeading.locator('.v2ray-visual-entry-actions button')
          .allTextContents()).map(s=>s.trim()),['重命名','移除']);
        await oldOutboundHeading.getByRole('button',{name:'重命名旧版出站扩展1'}).click();
        assert.equal(await connectionTag.inputValue(),'legacy-out');
        await connectionTag.fill('old-out-temporary');
        await connectionRenameDialog.getByRole('button',{name:'确认',exact:true}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        assert.ok((await oldOutboundHeading.innerText()).includes('old-out-temporary'));
        await oldOutboundHeading.getByRole('button',{name:'重命名旧版出站扩展1'}).click();
        await connectionTag.fill('legacy-out');
        await connectionRenameDialog.getByRole('button',{name:'确认',exact:true}).click();
        await connectionRenameDialog.waitFor({state:'hidden'});
        await legacyHeading.getByRole('button',{name:'新增连接'}).click();
        await inboundVisual.getByText('旧版出站扩展（outboundDetour） · 2').waitFor();
        await inboundVisual.getByRole('button',{name:'移除旧版出站扩展2'}).click();
        await inboundVisual.getByText('旧版出站扩展（outboundDetour） · 1').waitFor();
        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        const legacyOut=JSON.parse(await panel.getByRole('textbox',{name:'当前配置部分 JSON'}).inputValue());
        assert.equal(legacyOut[0].tag,'legacy-out');
        await nav.getByRole('button',{name:'出站连接（outbounds）',exact:true}).click();
        assert.equal(await inboundVisual.locator('.v2ray-visual-entry-heading').count(),1,
          'adding/removing old outbound entries never affects modern outbounds');
        // Force a tall editor in the disposable browser fixture to prove both controls
        // are sticky during document scrolling, rather than merely styled as sticky.
        await panel.locator('.v2ray-editor-content').evaluate(node=>{node.style.minHeight='2100px';});
        await panel.evaluate(node=>{
          const grid=node.querySelector('.v2ray-editor-layout');
          const absolute=grid.getBoundingClientRect().top+scrollY;
          scrollTo(0,absolute+260);
        });
        await page.waitForFunction(()=>{
          const nav=document.querySelector('.v2ray-config-nav');
          const head=document.querySelector('.v2ray-editor-header');
          return nav&&head&&Math.abs(nav.getBoundingClientRect().top-parseFloat(getComputedStyle(nav).top))<3
            && Math.abs(head.getBoundingClientRect().top-parseFloat(getComputedStyle(head).top))<3;
        });
        const fixedBefore=await panel.evaluate(node=>{
          const nav=node.querySelector('.v2ray-config-nav'),head=node.querySelector('.v2ray-editor-header');
          return {nav:nav.getBoundingClientRect().top,head:head.getBoundingClientRect().top,
            navPosition:getComputedStyle(nav).position,headPosition:getComputedStyle(head).position,
            scrollY};
        });
        await page.evaluate(()=>scrollBy(0,160));
        const fixedAfter=await panel.evaluate(node=>({
          nav:node.querySelector('.v2ray-config-nav').getBoundingClientRect().top,
          head:node.querySelector('.v2ray-editor-header').getBoundingClientRect().top,
          scrollY
        }));
        assert.equal(fixedBefore.navPosition,'sticky');
        assert.equal(fixedBefore.headPosition,'sticky');
        assert.ok(fixedAfter.scrollY>fixedBefore.scrollY+100,
          'page content should actually scroll under sticky controls');
        assert.ok(Math.abs(fixedAfter.nav-fixedBefore.nav)<3
          && Math.abs(fixedAfter.head-fixedBefore.head)<3,
          'both sidebar list and all five toolbar controls must remain visible while scrolling');
        if(width===390){
          const h=await page.locator('.module-sidebar').evaluate(node=>node.getBoundingClientRect().bottom);
          assert.ok(fixedAfter.nav>=h+4&&fixedAfter.head>=h+4,
            'sticky V2Ray controls must stay below the fixed mobile header');
        }
        await panel.locator('.v2ray-editor-content').evaluate(node=>{node.style.minHeight='';});
        await page.evaluate(()=>scrollTo(0,0));
        await nav.getByRole('button',{name:'路由规则（routing）',exact:true}).click();
        assert.equal(await viewToggle.getByRole('button',{name:'可视化'}).getAttribute('aria-pressed'),'true');
        await inboundVisual.getByRole('button',{name:'新增规则'}).click();
        const routeEntry=inboundVisual.locator('.v2ray-visual-entry').first();
        const heading=routeEntry.locator('.v2ray-visual-entry-heading').first();
        const rename=heading.getByRole('button',{name:'重命名路由规则 1'});
        const remove=heading.getByRole('button',{name:'移除路由规则1'});
        assert.equal(await rename.count(),1,'rename button must exist for each routing rule');
        const buttonOrder=await heading.locator('.v2ray-visual-entry-actions button').allTextContents();
        assert.deepEqual(buttonOrder.map(text=>text.trim()),['重命名','移除'],
          'rename must appear to the left of remove');
        assert.equal(await remove.count(),1);

        await rename.click();
        const renameDialog=panel.getByRole('dialog',{name:'重命名路由规则'});
        const tagInput=renameDialog.getByRole('textbox',{name:'规则标签（tag）'});
        await renameDialog.waitFor();
        assert.equal(await tagInput.inputValue(),'',
          'new rules without a tag MUST show an empty rename input, not outboundTag');
        await tagInput.fill('not-applied');
        await renameDialog.getByRole('button',{name:'取消'}).click();
        await renameDialog.waitFor({state:'hidden'});
        assert.ok((await heading.innerText()).includes('规则 1 · 未命名'),
          'cancel must not change title or create tag');

        await rename.click();
        assert.equal(await tagInput.inputValue(),'');
        await tagInput.fill('custom-route');
        await renameDialog.getByRole('button',{name:'确认',exact:true}).click();
        await renameDialog.waitFor({state:'hidden'});
        assert.ok((await heading.innerText()).includes('规则 1 · custom-route'));
        await rename.click();
        assert.equal(await tagInput.inputValue(),'custom-route',
          'existing route tag should prefill the dialog exactly');
        await tagInput.fill('');
        await tagInput.press('Enter');
        await renameDialog.waitFor({state:'hidden'});
        assert.ok((await heading.innerText()).includes('规则 1 · 未命名'),
          'clearing rule tag should restore outboundTag fallback');
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,3,
          'renaming must only change local draft before explicit Save');
        const fieldCaptions=await routeEntry.locator(
          '.v2ray-routing-fields > label, .v2ray-routing-tags > span'
        ).allTextContents();
        for(const annotated of ['类型（type）','入站标签（inboundTag）',
          '目标出站标签（outboundTag）']){
          assert.ok(fieldCaptions.some(s=>s.includes(annotated)),
            'routing field must identify the original JSON property: '+annotated);
        }
        assert.ok((await routeEntry.getByRole('combobox',{name:'选择条件 1'}).locator('option').allTextContents())
          .some(label=>label.includes('IP 条件（ip）')),
          'optional condition choice labels must annotate the original key');
        const routeFields=routeEntry.locator(':scope > .v2ray-visual-fields');
        assert.equal(await routeFields.evaluate(node=>getComputedStyle(node).alignItems),'start',
          'routing grid top-aligns each field instead of bottom-aligning against tall inbound tags');
        assert.equal(await routeFields.locator(':scope > *').last().getAttribute('class'),
          'v2ray-routing-add-condition','Add condition row must be the last rule element');
        assert.equal(await routeFields.locator(':scope > label').count(),2,
          'new rule must show only type and outbound labels plus the inbound tag editor');
        assert.equal(await routeFields.locator(':scope > .v2ray-routing-tags').count(),1);
        assert.equal(await routeFields.locator('.v2ray-routing-ip-field').count(),0,
          'empty optional IP criteria must be hidden by default');
        assert.equal(await routeEntry.getByRole('textbox',{name:'域名条件'}).count(),0);
        const conditionSelect=routeEntry.getByRole('combobox',{name:'选择条件 1'});
        const optionsBefore=await conditionSelect.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
        assert.deepEqual(optionsBefore,
          ['','balancerTag','port','network','source','domain','protocol','ip'],
          'Add condition must offer all supported optional fields');
        const outboundSelect=routeEntry.getByRole('combobox',{name:'目标出站标签'});
        await outboundSelect.selectOption('direct');
        assert.deepEqual(await outboundSelect.locator('option').evaluateAll(options=>options.map(o=>o.value)),
          ['','direct','legacy-out'],'route destinations must include ordinary and legacy outbound tags');
        await routeEntry.getByRole('button',{name:'添加入站标签'}).click();
        const inboundSelect=routeEntry.getByRole('combobox',{name:'入站标签 1'});
        await inboundSelect.selectOption('json-changed');
        assert.ok((await inboundSelect.locator('option').evaluateAll(options=>options.map(o=>o.value))).includes('json-changed'));
        const routeTypography=await routeFields.evaluate(grid=>{
          const titleNodes=[grid.querySelector(':scope > label:first-child > span'),
            grid.querySelector(':scope > .v2ray-routing-tags > span:first-child'),
            [...grid.children].find(el=>el.classList.contains('v2ray-route-base-field')&&
              el.textContent.includes('outboundTag'))?.querySelector('span')];
          const valueNodes=[grid.querySelector(':scope > label:first-child input'),
            grid.querySelector(':scope > .v2ray-routing-tags select'),
            [...grid.children].find(el=>el.classList.contains('v2ray-route-base-field')&&
              el.textContent.includes('outboundTag'))?.querySelector('select')];
          return {titles:titleNodes.map(el=>getComputedStyle(el).fontWeight),
            values:valueNodes.map(el=>getComputedStyle(el).fontWeight)};
        });
        assert.deepEqual(routeTypography.titles,['600','600','600'],
          'type, inbound and outbound labels must all have matching bold weight');
        assert.deepEqual(routeTypography.values,['400','400','400'],
          'type, inbound and outbound field values must all use regular weight');
        const baseFieldGeometry=await routeFields.evaluate(grid=>{
          const type=grid.querySelector(':scope > label:first-child');
          const inbound=grid.querySelector(':scope > .v2ray-routing-tags');
          const outbound=[...grid.children].find(node=>node.tagName==='LABEL'&&node.textContent.includes('目标出站标签'));
          const controls=[type.querySelector('input'),inbound.querySelector('select'),outbound.querySelector('select')];
          const labels=[type,inbound,outbound];
          return {heights:controls.map(node=>node.getBoundingClientRect().height),
            fieldTops:labels.map(node=>node.getBoundingClientRect().top),
            fieldLefts:labels.map(node=>node.getBoundingClientRect().left),
            fontSizes:labels.map(node=>getComputedStyle(node).fontSize),
            firstControlOffsets:controls.map((node,i)=>Math.round((node.getBoundingClientRect().top-
              labels[i].getBoundingClientRect().top)*10)/10)};
        });
        assert.ok(baseFieldGeometry.heights.every(h=>Math.abs(h-38)<1),
          'type, inbound and outbound tag controls must have one 38px visual height');
        assert.equal(new Set(baseFieldGeometry.fontSizes).size,1,
          'base routing labels must use the same font size');
        assert.ok(Math.max(...baseFieldGeometry.firstControlOffsets)-
          Math.min(...baseFieldGeometry.firstControlOffsets)<2,
          'all three controls start at the same offset beneath their labels');
        if(width===1280 && new Set(baseFieldGeometry.fieldLefts).size===3)
          assert.ok(Math.max(...baseFieldGeometry.fieldTops)-Math.min(...baseFieldGeometry.fieldTops)<2,
            'when the three base fields share a desktop row, their tops must align');
        const addRow=routeFields.locator(':scope > .v2ray-routing-add-condition');
        const addControlHeights=await addRow.evaluate(row=>
          [...row.querySelectorAll('select,button')].map(el=>el.getBoundingClientRect().height));
        assert.ok(addControlHeights.every(h=>Math.abs(h-38)<1),
          'condition picker and add button must share an exact 38px height');
        const routeChevron=await outboundSelect.evaluate(select=>{
          const css=getComputedStyle(select);
          return {appearance:css.appearance,position:css.backgroundPosition,
            image:css.backgroundImage,padding:css.paddingRight};
        });
        assert.equal(routeChevron.appearance,'none');
        assert.match(routeChevron.position,/14px/);
        assert.match(routeChevron.image,/data:image\/svg\+xml/);
        assert.equal(routeChevron.padding,'34px');

        await conditionSelect.selectOption('ip');
        await routeEntry.getByRole('button',{name:'添加条件',exact:true}).click();
        assert.ok(!(await conditionSelect.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('ip'),
          'opened conditions must not appear a second time in the choice list');
        const ipField=routeEntry.locator('.v2ray-routing-ip-field');
        await ipField.waitFor();
        const startingHeight=await ipField.locator('textarea').evaluate(el=>el.getBoundingClientRect().height);
        await ipField.locator('textarea').fill('geoip:private\n10.0.0.0/8\n192.168.0.0/16\n2001:db8::/32');
        const expandedHeight=await ipField.locator('textarea').evaluate(el=>({
          height:el.getBoundingClientRect().height,scroll:el.scrollHeight,client:el.clientHeight
        }));
        assert.ok(expandedHeight.height>startingHeight+24,
          'IP condition textarea must automatically grow with multiple lines');
        assert.ok(expandedHeight.scroll<=expandedHeight.client+2,
          'IP condition textarea must not require an inner scrollbar');
        await ipField.locator('textarea').press('Tab');

        await conditionSelect.selectOption('domain');
        await routeEntry.getByRole('button',{name:'添加条件',exact:true}).click();
        await routeEntry.getByRole('textbox',{name:'域名条件'}).fill('domain:one.test\ndomain:two.test');
        await routeEntry.getByRole('textbox',{name:'域名条件'}).press('Tab');
        const ipGeometry=await ipField.evaluate(label=>{
          const grid=label.parentElement;
          const fieldRect=label.getBoundingClientRect();
          const gridRect=grid.getBoundingClientRect();
          const textbox=label.querySelector('textarea').getBoundingClientRect();
          return {
            isLastCondition:grid.children[grid.children.length-2]===label,
            lastElementClass:grid.lastElementChild.className,
            gridColumn:getComputedStyle(label).gridColumn,
            left:fieldRect.left,right:fieldRect.right,
            gridLeft:gridRect.left,gridRight:gridRect.right,
            textareaWidth:textbox.width,fieldWidth:fieldRect.width
          };
        });
        assert.equal(ipGeometry.isLastCondition,true,
          'IP remains the final condition immediately before bottom action controls');
        assert.equal(ipGeometry.lastElementClass,'v2ray-routing-add-condition',
          'the condition picker and add button stay at the very bottom of the rule');
        assert.equal(ipGeometry.gridColumn,'1 / -1','IP criteria must span all grid columns');
        assert.ok(Math.abs(ipGeometry.left-ipGeometry.gridLeft)<2 &&
          Math.abs(ipGeometry.right-ipGeometry.gridRight)<2,
          'IP criteria must fill the available routing editor width');
        assert.ok(Math.abs(ipGeometry.textareaWidth-ipGeometry.fieldWidth)<2,
          'IP condition textarea must occupy 100% of its field');

        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        visualJson=panel.getByRole('textbox',{name:'当前配置部分 JSON'});
        const routingCandidate=JSON.parse(await visualJson.inputValue());
        assert.deepEqual(routingCandidate.rules[0].domain,['domain:one.test','domain:two.test'],
          'visual routing must produce a real JSON rules array');
        assert.deepEqual(routingCandidate.rules[0].ip,
          ['geoip:private','10.0.0.0/8','192.168.0.0/16','2001:db8::/32']);
        assert.deepEqual(routingCandidate.rules[0].inboundTag,['json-changed']);
        assert.equal(routingCandidate.rules[0].outboundTag,'direct');
        assert.equal(Object.hasOwn(routingCandidate.rules[0],'tag'),false,
          'clearing route tag in the separate dialog should delete only the tag key');
        assert.deepEqual(Object.keys(routingCandidate.rules[0]).sort(),
          ['type','inboundTag','outboundTag','ip','domain'].sort(),
          'Add condition should not initialize unused fields');

        // Existing JSON may have blank optional properties: hide but never erase them.
        // Preserve current multi-tags and orphaned/custom names between editor modes.
        routingCandidate.rules[0].port='';
        routingCandidate.rules[0].source=[];
        routingCandidate.rules[0].network='   ';
        routingCandidate.rules[0].vendorUnknown={secret:'unchanged'};
        routingCandidate.rules[0].inboundTag.push('legacy-custom');
        routingCandidate.rules[0].outboundTag='deleted-custom';
        await visualJson.fill(JSON.stringify(routingCandidate,null,2));
        await viewToggle.getByRole('button',{name:'可视化'}).click();
        assert.equal(await routeEntry.getByRole('combobox',{name:'入站标签 2'}).inputValue(),'legacy-custom');
        assert.equal(await routeEntry.getByRole('combobox',{name:'目标出站标签'}).inputValue(),'deleted-custom');
        for(const name of ['端口条件','网络条件','来源 IP']){
          assert.equal(await routeEntry.getByRole('textbox',{name,exact:true}).count(),0,
            'blank existing condition must not be visible: '+name);
        }
        assert.ok((await conditionSelect.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('port'),
          'blank existing port condition must be addable');
        await routeEntry.getByRole('button',{name:'移除入站标签 1'}).click();
        await viewToggle.getByRole('button',{name:'JSON'}).click();
        visualJson=panel.getByRole('textbox',{name:'当前配置部分 JSON'});
        const retainedRoute=JSON.parse(await visualJson.inputValue());
        assert.deepEqual(retainedRoute.rules[0].inboundTag,['legacy-custom']);
        assert.equal(retainedRoute.rules[0].outboundTag,'deleted-custom');
        assert.equal(retainedRoute.rules[0].port,'','hidden blank keys must survive visual edits');
        assert.deepEqual(retainedRoute.rules[0].source,[]);
        assert.equal(retainedRoute.rules[0].network,'   ');
        assert.deepEqual(retainedRoute.rules[0].vendorUnknown,{secret:'unchanged'});
        await nav.getByRole('button',{name:'完整内容'}).click();
        assert.equal(JSON.parse(await editor.inputValue()).customUnknown.value,true,
          'visual editor updates must not discard unrelated full-config settings');
        assert.equal(await viewToggle.getByRole('button',{name:'可视化'}).isDisabled(),true,
          'the full raw configuration must remain a JSON-only editor');
        // Presence-based navigation: a present null legacy field must stay listed
        // as raw JSON, while truly absent legacy keys vanish from the sidebar.
        const noLegacyConfig=JSON.parse(await editor.inputValue());
        noLegacyConfig.inboundDetour=null;
        await editor.fill(JSON.stringify(noLegacyConfig,null,2));
        await nav.getByRole('button',{name:'旧版入站扩展（inboundDetour）',exact:true}).click();
        assert.equal(await viewToggle.getByRole('button',{name:'可视化'}).isDisabled(),true,
          'legacy null is not an editable array');
        assert.equal((await part.inputValue()).trim(),'null',
          'present null legacy field must not silently display a new []');
        await nav.getByRole('button',{name:'完整内容'}).click();
        const removedLegacy=JSON.parse(await editor.inputValue());
        delete removedLegacy.inboundDetour;
        delete removedLegacy.outboundDetour;
        await editor.fill(JSON.stringify(removedLegacy,null,2));
        assert.equal(await nav.getByRole('button',{name:'旧版入站扩展（inboundDetour）'}).count(),0,
          'missing inboundDetour must not get a sidebar item');
        assert.equal(await nav.getByRole('button',{name:'旧版出站扩展（outboundDetour）'}).count(),0,
          'missing outboundDetour must not get a sidebar item');
        assert.equal(await nav.getByRole('button',{name:'入站连接（inbounds）'}).count(),1);
        assert.equal(await nav.getByRole('button',{name:'出站连接（outbounds）'}).count(),1);
        assert.ok(!Object.hasOwn(JSON.parse(await editor.inputValue()),'inboundDetour'));
        assert.ok(!Object.hasOwn(JSON.parse(await editor.inputValue()),'outboundDetour'));
        await addFieldButton.click();
        await fieldSelect.selectOption('inboundDetour');
        await addDialog.getByRole('button',{name:'添加',exact:true}).click();
        await addDialog.waitFor({state:'hidden'});
        assert.equal(await nav.getByRole('button',{name:'旧版入站扩展（inboundDetour）'}).count(),1,
          'explicit adding of a missing legacy field restores its isolated navigation entry');
        await viewToggle.getByRole('button',{name:'JSON',exact:true}).click();
        assert.equal((await panel.getByRole('textbox',{name:'当前配置部分 JSON'}).inputValue()).trim(),'[]',
          'added legacy section must initialize as JSON array');
        await nav.getByRole('button',{name:'完整内容'}).click();
        const afterAdd=JSON.parse(await editor.inputValue());
        assert.deepEqual(afterAdd.inboundDetour,[]);
        delete afterAdd.inboundDetour;
        await editor.fill(JSON.stringify(afterAdd,null,2));
        assert.equal(await nav.getByRole('button',{name:'旧版入站扩展（inboundDetour）'}).count(),0);
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,3,
          'visual edits must remain local unless the operator clicks Save');
        // Simulate a second actor changing the revision while the user is
        // editing. Conflict handling must never silently overwrite or discard.
        const userDraft=await editor.inputValue();
        const externalConfig=JSON.parse(v2rayConfig);
        externalConfig.log.externalUpdate=true;
        v2rayConfig=JSON.stringify(externalConfig,null,2);
        v2rayRevision++;
        const latestConfig=v2rayConfig;
        await panel.getByRole('button',{name:'保存并应用'}).click();
        await panel.getByRole('alert').filter({hasText:'本地修改仍保留'}).waitFor();
        assert.equal(await editor.inputValue(),userDraft,
          'a 409 must retain the entire pending local draft');
        assert.equal(v2rayConfig,latestConfig,
          'the backend must not overwrite externally changed configuration');
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.save').length,4,
          'one explicit save attempt must be refused on stale revision');
        await serviceCard.getByRole('button',{name:'停止',exact:true}).click();
        const confirm=panel.getByRole('dialog',{name:'确认 V2Ray 服务操作'});
        await confirm.waitFor();
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.service').length,0,'service action waits for confirmation');
        await confirm.getByRole('button',{name:'取消'}).click();
        await confirm.waitFor({state:'hidden'});
        assert.equal(v2rayRunning,true);
        await serviceCard.getByRole('button',{name:'停止',exact:true}).click();
        await confirm.getByRole('button',{name:'确认操作'}).click();
        await confirm.waitFor({state:'hidden'});
        assert.equal(v2rayRunning,false);
        v2rayInstalled=false;v2rayRunning=false;
        await configLine.getByRole('button',{name:'刷新状态与配置'}).click();
        await panel.getByRole('button',{name:'安装 V2Ray 5.47.0'}).waitFor();
        await panel.getByRole('button',{name:'安装 V2Ray 5.47.0'}).click();
        const install=panel.getByRole('dialog',{name:'安装 V2Ray'});
        await install.waitFor();
        await install.getByRole('button',{name:'取消'}).click();
        await install.waitFor({state:'hidden'});
        assert.equal(v2rayCalls.filter(x=>x.id==='v2ray.install').length,0,
          'cancel must never install V2Ray');
        await page.screenshot({path:join(output,'v2ray-panel-'+width+'.png'),fullPage:true});
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
      if(width<=730) {
        const mobileHeader=await page.locator('.module-sidebar').evaluate(node=>{
          const r=node.getBoundingClientRect(),style=getComputedStyle(node);
          return {left:r.left,right:r.right,top:r.top,width:r.width,
            radius:style.borderTopLeftRadius,borderLeft:style.borderLeftWidth,
            borderRight:style.borderRightWidth,borderTop:style.borderTopWidth,
            color:style.backgroundColor,viewport:innerWidth};
        });
        assert.ok(mobileHeader.left>=14 && mobileHeader.viewport-mobileHeader.right>=14,
          width+': the mobile information header must have left/right outer gutters');
        assert.ok(mobileHeader.top>=15,
          width+': the mobile information header must have an upper gutter');
        assert.ok(parseFloat(mobileHeader.radius)>=12 &&
          [mobileHeader.borderLeft,mobileHeader.borderRight,mobileHeader.borderTop].every(x=>x==='1px'),
          width+': the mobile information header must have its rounded outer border');
        await page.waitForFunction(()=>{
        const header=document.querySelector('.module-sidebar').getBoundingClientRect();
        return Math.abs(document.querySelector('.module-content').getBoundingClientRect().top-header.bottom-24)<1;
      }).catch(async cause=>{
        console.log('HEADER GAP',width,name,await page.evaluate(()=>({scrollY,side:document.querySelector('.module-sidebar').getBoundingClientRect().toJSON(),content:document.querySelector('.module-content').getBoundingClientRect().toJSON(),slot:document.querySelector('.sidebar-slot').getBoundingClientRect().toJSON()})));
        await page.screenshot({path:join(output,'header-gap-failure.png'),fullPage:true});
        throw cause;
      });
      }
      const frames=await page.locator('.module-content').evaluate(content=>{
        const sidebar=document.querySelector('.module-sidebar');
        const side=sidebar.getBoundingClientRect(), box=content.getBoundingClientRect();
        const nodes=[...content.querySelectorAll(':scope > .module-intro,:scope > .action-card,:scope > .settings-section,:scope > .action-flow > .action-card,:scope > .action-flow > .terminal-console')];
        const rects=nodes.map(n=>n.getBoundingClientRect());
        return {centerError:innerWidth>730?Math.abs(box.right+side.left-innerWidth):Math.abs(box.left+box.right-innerWidth),width:box.width, gutter:innerWidth>730?box.left-side.right:box.top-side.bottom,
          radius:getComputedStyle(sidebar).borderTopLeftRadius,
          cards:nodes.map(n=>{const s=getComputedStyle(n);return {radius:s.borderTopLeftRadius,flat:n.classList.contains('flat-action')||n.classList.contains('unboxed-manager'),
            borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]};}),
          gaps:rects.slice(1).map((r,i)=>r.top-rects[i].bottom)};
      });
      assert.ok(frames.width<=914.5,'content must fit the narrower 1200px overall shell');
      assert.ok(frames.centerError<1,width+' sidebar and content must be centered together');
      assert.ok(Math.abs(frames.gutter-24)<1,width+' sidebar-to-content gap must be 24px');
      assert.ok(frames.cards.length>0,'module title/card frame missing');
      assert.ok(frames.cards.every(c=>c.flat
          ? c.radius==='0px'&&c.borders.every(b=>b==='0px')
          : (width<=730?parseFloat(c.radius)>0:c.radius===frames.radius)&&c.borders.every(b=>b==='1px')),
        width+' '+name+' cards must follow declared rounded or flat chrome');
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
      assert.ok(placement.tabLeft>=0 && placement.tabLeft<=2 &&
        placement.tabRight>=0 && placement.tabRight<=2 && placement.tabTop>=8,
        'phone tabs should sit just inside the rounded header card border');
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
    assert.ok(layout.radius>=12,'mobile and desktop sidebar cards must stay rounded');
    assert.equal(layout.sideBorder,'1px');
    assert.ok(Math.abs(layout.top-16)<1,'sidebar must preserve its top gutter');
    assert.ok(Math.abs(layout.left-(viewport.width<=730?16:Math.max(0,(viewport.width-1200)/2)+16))<1,
      'mobile sidebar keeps 16px left gutter; desktop follows the shell');
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
