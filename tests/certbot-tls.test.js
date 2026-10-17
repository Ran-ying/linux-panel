import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createNginxTlsOperations} from '../platform/privileged/nginx-tls-operations.js';
import {createCertbotOperations} from '../platform/privileged/certbot-operations.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {dispatchPrivileged} from '../platform/privileged/server.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup as nginxSetup} from '../modules/nginx/index.js';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'panel-tls-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const ssl=join(root,'tls');
  await mkdir(ssl);await mkdir(join(root,'sites-available'));
  const cert=join(ssl,'fullchain.pem'),key=join(ssl,'privkey.pem');
  execFileSync('openssl',['req','-newkey','rsa:2048','-x509','-nodes','-days','1',
    '-subj','/CN=fixture.test','-keyout',key,'-out',cert],{stdio:'ignore'});
  const conf=join(root,'sites-available','fixture.test');
  await writeFile(conf,
    'server {\n server_name fixture.test;\n ssl_certificate '+cert+';\n ssl_certificate_key '+key+';\n}\n');
  return {root,ssl,cert,key,conf};
}
test('TLS viewer uses only Nginx declared references and requires explicit key call',async t=>{
  const f=await fixture(t);
  const ops=createNginxTlsOperations({root:f.root,requireRoot:false,roots:[f.ssl]});
  const result=await ops.siteTls({name:'fixture.test'});
  assert.equal(result.pairs.length,1);
  assert.equal(result.pairs[0].certificatePath,f.cert);
  assert.equal(result.pairs[0].privateKeyPath,f.key);
  assert.match(result.pairs[0].publicPem,/BEGIN PUBLIC KEY/);
  assert.match(result.pairs[0].certificatePem,/BEGIN CERTIFICATE/);
  assert.ok(!JSON.stringify(result).includes('BEGIN PRIVATE KEY'),'public inventory must not contain private PEM');
  const revealed=await ops.siteTlsKey({name:'fixture.test',index:0});
  assert.match(revealed.privatePem,/BEGIN PRIVATE KEY/);
  assert.equal(revealed.privatePem,await readFile(f.key,'utf8'));
  await assert.rejects(ops.siteTlsKey({name:'../passwd',index:0}),{statusCode:400});
  await assert.rejects(ops.siteTlsKey({name:'fixture.test',index:15}),{statusCode:400});
});
test('TLS viewer rejects paths outside allowed PEM roots without returning secrets',async t=>{
  const f=await fixture(t);
  await writeFile(f.conf,'server {\n ssl_certificate /etc/passwd;\n ssl_certificate_key /etc/shadow;\n}\n');
  const ops=createNginxTlsOperations({root:f.root,requireRoot:false,roots:[f.ssl]});
  const data=await ops.siteTls({name:'fixture.test'});
  assert.equal(data.pairs[0].publicPem,'');
  assert.equal(data.warnings.length,1);
  await assert.rejects(ops.siteTlsKey({name:'fixture.test',index:0}),{statusCode:403});
  await writeFile(f.conf,'server { ssl_certificate $dynamic; ssl_certificate_key /etc/shadow; }\n');
  assert.ok((await ops.siteTls({name:'fixture.test'})).warnings.length);
  await writeFile(f.conf,'server {\n ssl_certificate /etc/passwd;\n}\n');
  await assert.rejects(ops.siteTls({name:'fixture.test'}),{statusCode:422});
});
test('Certbot inventories only renewal profiles, never reads private key',async t=>{
  const f=await fixture(t);
  const renewal=join(f.root,'renewal');await mkdir(renewal);
  await writeFile(join(renewal,'fixture.test.conf'),'[renewalparams]\nauthenticator = nginx\n');
  const ops=createCertbotOperations({renewalDir:renewal,requireRoot:false,runner:async()=>({stdout:'active\n'}),
    nginxOps:{
      certificates:async()=>({installed:true,warnings:[],certificates:[{
        name:'fixture.test',domains:['fixture.test'],validTo:'2026-12-01T00:00:00Z',daysRemaining:45,status:'valid'
      }]}),
      renew:async({name})=>({ok:true,status:name,output:'',reloaded:true})
    }});
  const result=await ops.list();
  assert.equal(result.count,1);assert.equal(result.certificates[0].authenticator,'nginx');
  assert.ok(result.timerActive);
  assert.ok(!JSON.stringify(result).includes('BEGIN PRIVATE KEY'));
  assert.equal((await ops.renew({name:'fixture.test'})).ok,true);
  await assert.rejects(ops.renew({name:'missing.conf'}),{statusCode:404});
});
test('private TLS read and Certbot renewal remain Web-only in registry and root IPC',async()=>{
  const handlers=createPrivilegedHandlers({privileged:false});
  for(const id of ['nginx.siteTls','nginx.siteTlsKey','nginx.saveTls','nginx.certbotList','nginx.certbotRenew']){
    await assert.rejects(dispatchPrivileged({version:1,channel:'mcp',action:id,input:{}},handlers),{statusCode:403});
  }
  const registry=new ActionRegistry();
  await nginxSetup({actions:registry,moduleId:'nginx'});
  const privateAction=registry.get('nginx.siteTlsKey');
  assert.equal(privateAction.exposure.mcp,false);
  assert.equal(privateAction.kind,'write');
  const engine=new ActionEngine(registry);
  const request={name:'fixture.test',index:0};
  await assert.rejects(engine.run('nginx.siteTlsKey',request,'web',{}),{statusCode:403});
  await assert.rejects(engine.run('nginx.siteTlsKey',request,'mcp',
    {authenticated:true,channel:'mcp',userId:'owner'}),{statusCode:404});
});


test('PEM save uses CAS, paired validation and does not modify files before Nginx verification',async t=>{
  const f=await fixture(t);
  const seen=[];
  let nginxPass=true,reloadPass=true;
  const ops=createNginxTlsOperations({root:f.root,requireRoot:false,roots:[f.ssl],
    run:async(binary,args)=>{
      seen.push(binary+' '+args.join(' '));
      if(binary==='/usr/sbin/nginx'&&!nginxPass)throw new Error('private diagnostic');
      if(binary==='/bin/systemctl'&&args[0]==='reload'&&!reloadPass)throw new Error('private diagnostic');
      return {stdout:'active\n'};
    }});
  const before=(await ops.siteTls({name:'fixture.test'})).pairs[0];
  assert.match(before.revision,/^[a-f0-9]{64}$/);
  const key=(await ops.siteTlsKey({name:'fixture.test',index:0})).privatePem;
  const noop=await ops.saveTls({name:'fixture.test',index:0,revision:before.revision,
    certificatePem:before.certificatePem,privatePem:key,updateCertificate:true,updatePrivateKey:false});
  assert.equal(noop.ok,true);assert.equal(noop.reloaded,false);
  assert.equal(seen.length,0);
  await assert.rejects(ops.saveTls({name:'fixture.test',index:0,revision:'f'.repeat(64),
    certificatePem:before.certificatePem,privatePem:key,updateCertificate:true,updatePrivateKey:false}),{statusCode:409});
  await assert.rejects(ops.saveTls({name:'fixture.test',index:0,revision:before.revision,
    certificatePem:before.certificatePem,privatePem:'INVALID PRIVATE KEY',
    updateCertificate:false,updatePrivateKey:true}),{statusCode:422});
  assert.equal((await readFile(f.key,'utf8')),key,'invalid key never writes');
  const cert2=join(f.ssl,'fresh-cert.pem'),key2=join(f.ssl,'fresh-key.pem');
  execFileSync('openssl',['req','-newkey','rsa:2048','-x509','-nodes','-days','2',
    '-subj','/CN=fixture.test','-keyout',key2,'-out',cert2],{stdio:'ignore'});
  const certText=await readFile(cert2,'utf8'),keyText=await readFile(key2,'utf8');
  nginxPass=false;
  await assert.rejects(ops.saveTls({name:'fixture.test',index:0,revision:before.revision,
    certificatePem:certText,privatePem:keyText,updateCertificate:true,updatePrivateKey:true}),
    {statusCode:422});
  assert.equal(await readFile(f.cert,'utf8'),before.certificatePem,'failed Nginx test rolls back cert');
  assert.equal(await readFile(f.key,'utf8'),key,'failed Nginx test rolls back key');
  nginxPass=true;
  const result=await ops.saveTls({name:'fixture.test',index:0,revision:before.revision,
    certificatePem:certText,privatePem:keyText,updateCertificate:true,updatePrivateKey:true});
  assert.equal(result.ok,true);assert.equal(result.reloaded,true);
  assert.notEqual(result.revision,before.revision);
  assert.equal(await readFile(f.cert,'utf8'),certText);
  assert.equal(await readFile(f.key,'utf8'),keyText);
  await assert.rejects(ops.saveTls({name:'fixture.test',index:0,revision:before.revision,
    certificatePem:certText,privatePem:keyText,updateCertificate:true,updatePrivateKey:true}),{statusCode:409});
  assert.ok(seen.some(cmd=>cmd.startsWith('/usr/sbin/nginx -t')));
  assert.ok(seen.some(cmd=>cmd.startsWith('/bin/systemctl reload nginx.service')));
  // On a second rotation, reload failure must restore the previously saved pair.
  const revised=(await ops.siteTls({name:'fixture.test'})).pairs[0];
  reloadPass=false;
  await assert.rejects(ops.saveTls({name:'fixture.test',index:0,revision:revised.revision,
    certificatePem:before.certificatePem,privatePem:key,updateCertificate:true,updatePrivateKey:true}),{statusCode:422});
  assert.equal(await readFile(f.cert,'utf8'),certText);
  assert.equal(await readFile(f.key,'utf8'),keyText);
});
