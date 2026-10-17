import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,readFile,rm,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNginxOperations} from '../platform/privileged/nginx-operations.js';
import {sslReferences} from '../platform/privileged/nginx-certbot-cleanup.js';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'nginx-certbot-prune-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const nginx=join(root,'nginx'),letsencrypt=join(root,'letsencrypt');
  const live=join(letsencrypt,'live'),archive=join(letsencrypt,'archive'),
    renewal=join(letsencrypt,'renewal');
  for(const dir of [join(nginx,'sites-available'),join(nginx,'sites-enabled'),
    join(nginx,'conf.d'),live,archive,renewal])await mkdir(dir,{recursive:true});
  const calls=[];
  const settings={failTest:false,failReload:false,failInventory:false,
    failDelete:false,extraEffective:''};
  const runner=async(command,args)=>{
    calls.push({command,args});
    if(command==='/usr/sbin/nginx'&&args[0]==='-T'){
      if(settings.failInventory)throw new Error('No effective inventory');
      // Effective loaded sites are separate from all sites-available. The
      // helper deliberately checks *both* sources.
      return {stdout:'nginx: effective test configuration;\n'+settings.extraEffective,
        stderr:''};
    }
    if(command==='/usr/sbin/nginx'&&args[0]==='-t'&&settings.failTest)
      throw Object.assign(new Error('invalid configuration'),{code:1});
    if(command==='/bin/systemctl'&&args[0]==='reload'&&settings.failReload)
      throw Object.assign(new Error('reload failed'),{code:1});
    if(command==='/usr/bin/certbot'&&args[0]==='delete'&&settings.failDelete)
      throw Object.assign(new Error('certbot failed'),{code:1});
    return {stdout:'',stderr:''};
  };
  const ops=createNginxOperations({root:nginx,requireRoot:false,
    runner,certificateRoot:live,renewalRoot:renewal});
  async function lineage(name){
    const actual=join(archive,name),links=join(live,name);
    await mkdir(actual,{recursive:true});await mkdir(links,{recursive:true});
    await writeFile(join(actual,'cert1.pem'),'fixture public certificate');
    await writeFile(join(actual,'fullchain1.pem'),'fixture fullchain certificate');
    await symlink('../../archive/'+name+'/cert1.pem',join(links,'cert.pem'));
    await symlink('../../archive/'+name+'/fullchain1.pem',join(links,'fullchain.pem'));
    await writeFile(join(renewal,name+'.conf'),'[renewalparams]\nauthenticator = nginx\n');
    return join(links,'fullchain.pem');
  }
  const config=(path)=>'server {\n  listen 443 ssl;\n  ssl_certificate '+path+';\n  ssl_certificate_key /tmp/test-placeholder.key;\n}\n';
  async function site(name,content,{enabled=false}={}){
    await writeFile(join(nginx,'sites-available',name),content);
    if(enabled)await symlink('../sites-available/'+name,join(nginx,'sites-enabled',name));
    return (await ops.read({name})).revision;
  }
  async function remove(name){
    const {revision}=await ops.read({name});
    return ops.apply({name,operation:'remove',revision});
  }
  const deletes=()=>calls.filter(c=>c.command==='/usr/bin/certbot'&&c.args[0]==='delete');
  return {root,nginx,live,archive,renewal,calls,settings,runner,ops,lineage,config,site,remove,deletes};
}

test('a sole Certbot certificate is deleted after site removal, nginx -t and successful reload',async t=>{
  const f=await fixture(t),cert=await f.lineage('unique.test');
  await f.site('website-one',f.config(cert),{enabled:true});
  const result=await f.remove('website-one');
  assert.equal(result.ok,true);
  assert.match(result.status,/自动删除 1 份/);
  assert.deepEqual(f.deletes()[0]?.args,
    ['delete','--cert-name','unique.test','--non-interactive','--quiet']);
  const actions=f.calls.map(c=>c.command+' '+c.args.join(' '));
  const deletion=actions.findIndex(x=>x.includes('/usr/bin/certbot delete'));
  assert.ok(actions.findIndex(x=>x.includes('/usr/sbin/nginx -t'))<deletion);
  assert.ok(actions.findIndex(x=>x.includes('/bin/systemctl reload'))<deletion);
  assert.equal((await readdir(join(f.nginx,'sites-available'))).length,0);
});
test('multiple unique certificates from a single website are each deleted once',async t=>{
  const f=await fixture(t);
  const a=await f.lineage('first.test'),b=await f.lineage('second.test');
  await f.site('one-site',f.config(a)+f.config(b));
  const result=await f.remove('one-site');
  assert.equal(result.ok,true);
  assert.match(result.status,/自动删除 2 份/);
  assert.deepEqual(f.deletes().map(c=>c.args[2]).sort(),['first.test','second.test']);
});
test('certificates shared with another Nginx website are preserved, even when the other website is disabled',async t=>{
  const f=await fixture(t),cert=await f.lineage('shared.test');
  await f.site('primary',f.config(cert),{enabled:true});
  await f.site('disabled-but-owning',f.config(cert));
  const result=await f.remove('primary');
  assert.equal(result.ok,true);
  assert.deepEqual(f.deletes(),[]);
  assert.equal((await readFile(join(f.renewal,'shared.test.conf'),'utf8')).includes('renewalparams'),true);
});
test('aliases resolving to the same Certbot archive certificate prevent deletion',async t=>{
  const f=await fixture(t),cert=await f.lineage('aliased.test');
  const alias=join(f.nginx,'cert-alias.pem');
  await symlink(cert,alias);
  await f.site('original',f.config(cert));
  await f.site('shared-alias',f.config(alias));
  await f.remove('original');
  assert.equal(f.deletes().length,0);
});
test('references in effective Nginx include output outside managed sites prevent deletion',async t=>{
  const f=await fixture(t),cert=await f.lineage('included.test');
  f.settings.extraEffective=f.config(cert);
  await f.site('primary',f.config(cert),{enabled:true});
  await f.remove('primary');
  assert.equal(f.deletes().length,0);
});
test('unreadable/ambiguous remaining configuration fails closed and keeps Certbot state',async t=>{
  for(const scenario of ['nginx -T unavailable','disabled include','variable directive','certbot delete fails']){
    await t.test(scenario,async sub=>{
      const f=await fixture(sub),cert=await f.lineage('safe.test');
      await f.site('primary',f.config(cert),{enabled:true});
      if(scenario==='nginx -T unavailable')f.settings.failInventory=true;
      if(scenario==='disabled include')await f.site('other','server {\ninclude /etc/nginx/conf.d/unknown.conf;\n}');
      if(scenario==='variable directive')f.settings.extraEffective='ssl_certificate $dynamic_path;\n';
      if(scenario==='certbot delete fails')f.settings.failDelete=true;
      const result=await f.remove('primary');
      assert.equal(result.ok,true);
      assert.equal(f.deletes().length,scenario==='certbot delete fails'?1:0);
      assert.match(result.status,/保留/);
      assert.equal((await lstat(join(f.renewal,'safe.test.conf'))).isFile(),true);
    });
  }
});
test('Nginx config or reload failure restores deleted site and never invokes Certbot delete',async t=>{
  for(const fail of ['failTest','failReload']){
    await t.test(fail,async sub=>{
      const f=await fixture(sub),cert=await f.lineage('preserve.test');
      await f.site('keep',f.config(cert),{enabled:true});
      f.settings[fail]=true;
      try{const result=await f.remove('keep');assert.equal(result.ok,false);}
      catch(e){assert.ok(e.statusCode===503||e.statusCode===500);}
      assert.equal(f.deletes().length,0);
      assert.equal((await readFile(join(f.nginx,'sites-available','keep'),'utf8')).includes(cert),true);
    });
  }
});
test('no certificate lineage or unregistered cert is removed merely because the website name matches',async t=>{
  const f=await fixture(t),cert=await f.lineage('identical.test');
  await rm(join(f.renewal,'identical.test.conf'));
  await f.site('identical.test',f.config(cert));
  const result=await f.remove('identical.test');
  assert.equal(result.ok,true);
  assert.deepEqual(f.deletes(),[]);
});
test('commented directives do not count, user paths are never accepted as direct Certbot arguments',()=>{
  const a=sslReferences('server { # ssl_certificate /etc/letsencrypt/live/nope/fullchain.pem;\n ssl_certificate "/etc/letsencrypt/live/ok.test/fullchain.pem"; }');
  assert.deepEqual(a.paths,['/etc/letsencrypt/live/ok.test/fullchain.pem']);
  assert.equal(a.uncertain,false);
  const b=sslReferences('ssl_certificate $name/fullchain.pem;');
  assert.deepEqual(b.paths,['$name/fullchain.pem']);
});
