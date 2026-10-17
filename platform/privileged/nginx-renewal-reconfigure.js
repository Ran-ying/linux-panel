import {readFile,lstat,copyFile,chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import Ajv from 'ajv';

const cmd=promisify(execFile);
const nameSchema={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
export const NGINX_RECONFIGURE_CONTRACT={
  title:'将 Certbot 续期改为 Nginx 验证',
  description:'仅对现有 standalone 证书使用 Certbot reconfigure --nginx 测试验证并更新续期方式。不会停止 Nginx。',
  inputSchema:{type:'object',required:['name'],additionalProperties:false,properties:{name:nameSchema}},
  outputSchema:{type:'object',required:['name','ok','before','after','status','output'],additionalProperties:false,properties:{
    name:nameSchema,ok:{type:'boolean'},before:{type:'string'},after:{type:'string'},
    status:{type:'string',maxLength:300},output:{type:'string',maxLength:3000}
  }}
};
const validate=new Ajv({strict:false}).compile(NGINX_RECONFIGURE_CONTRACT.inputSchema);
const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const authOf=s=>/^[ \t]*authenticator[ \t]*=[ \t]*(\S+)[ \t]*$/m.exec(s)?.[1]??'';
const hooksOf=s=>/^[ \t]*(?:pre_hook|post_hook|deploy_hook)[ \t]*=[ \t]*\S/m.test(s);
const clean=s=>String(s??'').replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'').slice(-2800);

export function createNginxRenewalReconfigure({root='/etc/letsencrypt/renewal',
  run=cmd,requireRoot=true,backup=true}={}){
  return {async reconfigure(input){
    if(!validate(input))throw failure('证书名称不合法');
    if(requireRoot && process.getuid?.()!==0)throw failure('需要 root-owned Certbot 执行器',503);
    const path=join(root,input.name+'.conf');
    let stats,config;
    try{stats=await lstat(path);if(!stats.isFile()||stats.isSymbolicLink())throw failure('证书续期配置不是普通文件',403);
      if(stats.size>32768)throw failure('证书续期配置过大',400);
      config=await readFile(path,'utf8');
    }catch(e){if(e.statusCode)throw e;throw failure('找不到可管理的证书续期配置',404);}
    const previous=authOf(config);
    if(!config.includes('[renewalparams]')||!previous)throw failure('续期配置格式不支持',400);
    if(previous==='nginx')return {name:input.name,ok:true,before:'nginx',after:'nginx',
      status:'已经使用 Nginx 验证，无需修改',output:''};
    if(previous!=='standalone')throw failure('只允许从 standalone 迁移至 Nginx 验证',409);
    if(hooksOf(config))throw failure('续期包含自定义 hooks，必须先人工审核',409);
    if(backup){
      const pathBackup=path+'.before-nginx.'+Date.now()+'-'+randomBytes(3).toString('hex')+'.bak';
      await copyFile(path,pathBackup);await chmod(pathBackup,0o600);
    }
    let failed='',exit=0;
    try{
      await run('/usr/bin/certbot',
        ['reconfigure','--cert-name',input.name,'--nginx','--non-interactive'],
        {timeout:180000,maxBuffer:128*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});
    }catch(e){exit=e.code??1;failed=clean(e.stderr||e.message);}
    // Certbot reconfigure tests staging ACME before committing the renewal
    // params; read the real saved config instead of trusting a zero exit code.
    let updated='';
    try{updated=await readFile(path,'utf8');}catch{}
    const after=authOf(updated);
    const ok=!exit && after==='nginx';
    return {name:input.name,ok,before:previous,after:after||'unknown',
      status:ok?'已通过 Certbot 验证并改为 Nginx 续期':
        '证书迁移未完成，原配置已保留备份（不会停止 Nginx）',
      output:ok?'':failed||'Certbot 未成功保存 Nginx 续期配置'};
  }};
}
