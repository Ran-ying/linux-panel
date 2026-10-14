import { randomUUID } from 'node:crypto';
import { addAudit } from './state-store.js';

// The HTTP listener belongs to Linux Panel, never to a particular proxy.
export const DEFAULT_LISTENER = Object.freeze({host:'127.0.0.1',port:4188});
const HOSTS = new Set(['127.0.0.1','0.0.0.0']);
const TTL_MS=15*60*1000;
const bad=(message, statusCode=400)=>Object.assign(new Error(message),{statusCode});

export function validateListener(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).some(k=>!['host','port'].includes(k)) ||
      !HOSTS.has(value.host) ||
      !Number.isInteger(value.port) || value.port<1024 || value.port>65535)
    throw bad('Listener must have host 127.0.0.1 or 0.0.0.0 and port 1024..65535');
  return {host:value.host,port:value.port};
}

export function listenerDefaults(env=process.env) {
  const host=env.PANEL_LISTEN_HOST || '127.0.0.1';
  const text=env.PANEL_LISTEN_PORT || env.PORT || '4188';
  if (!/^[0-9]{1,5}$/.test(String(text))) throw bad('Invalid PANEL_LISTEN_PORT/PORT');
  return validateListener({host,port:Number(text)});
}

export function resolveListener(state, env=process.env) {
  return validateListener(state?.listener ?? listenerDefaults(env));
}

export function resolvePublicOrigin(listener, configured='') {
  if (configured) return configured;
  if(listener.host!=='127.0.0.1')
    throw new Error('PANEL_PUBLIC_ORIGIN=https://... required for public/non-loopback listeners');
  return `http://127.0.0.1:${listener.port}`;
}

export function createListenerController({store,auth,active,publicOrigin}) {
  const running=validateListener(active);
  function pendingOf(state) {
    const request=state.listenerRequest;
    return request && Date.parse(request.expiresAt)>Date.now()
      ? {id:request.id,host:request.host,port:request.port,
        createdAt:request.createdAt,expiresAt:request.expiresAt} : null;
  }
  return {
    async status() {
      const state=await store.snapshot();
      const configured=resolveListener(state);
      return {
        active:running,configured,pending:pendingOf(state),
        restartRequired:configured.host!==running.host||configured.port!==running.port,
        publicOrigin
      };
    },
    async request({userId,host,port}) {
      const next=validateListener({host,port});
      // Configuring all interfaces does NOT serve TLS. An explicit externally
      // HTTPS-terminated origin is required.
      if(next.host==='0.0.0.0' && !publicOrigin.startsWith('https://'))
        throw bad('Wildcard listener requires an HTTPS PANEL_PUBLIC_ORIGIN and external TLS termination');
      if(!userId)throw bad('Authenticated Web administrator required',403);
      const now=Date.now();
      const request={id:randomUUID(),...next,userId,
        createdAt:new Date(now).toISOString(),expiresAt:new Date(now+TTL_MS).toISOString()};
      return store.mutate(state=>{
        if(pendingOf(state))throw bad('A listener change already awaits approval',409);
        state.listenerRequest=request;
        addAudit(state,'panel.listener.request',userId,next.host+':'+next.port);
        return {status:'approval_required',id:request.id,host:next.host,
          port:next.port,expiresAt:request.expiresAt};
      });
    },
    async approve({identity,id,password,code}) {
      if(typeof id!=='string'||!id)throw bad('Invalid listener request');
      await auth.verifyStepUp(identity,password,code);
      return store.mutate(state=>{
        const request=state.listenerRequest;
        if(!request || request.id!==id || request.userId!==identity.user.id ||
           Date.parse(request.expiresAt)<=Date.now())
          throw bad('Listener request missing, expired or not owned by user',409);
        const next=validateListener({host:request.host,port:request.port});
        if(next.host==='0.0.0.0' && !publicOrigin.startsWith('https://'))
          throw bad('Wildcard listener requires an HTTPS public origin');
        state.listener=next;
        delete state.listenerRequest;
        addAudit(state,'panel.listener.approved',identity.user.id,next.host+':'+next.port);
        return {status:'restart_required',configured:next,active:running};
      });
    },
    async cancel({identity,id}) {
      return store.mutate(state=>{
        const request=state.listenerRequest;
        if(!request || request.id!==id || request.userId!==identity.user.id)
          throw bad('No matching listener request',409);
        delete state.listenerRequest;
        addAudit(state,'panel.listener.cancelled',identity.user.id);
        return {status:'cancelled'};
      });
    }
  };
}

export function registerListenerActions(registry,controller) {
  const endpointSchema={type:'object',additionalProperties:false,required:['host','port'],
    properties:{host:{type:'string',enum:['127.0.0.1','0.0.0.0']},
      port:{type:'integer',minimum:1024,maximum:65535}}};
  registry.register('panel',{
    id:'panel.listener.status',title:'HTTP 监听配置',
    description:'查看当前监听地址/端口、下次启动配置和待审批更改。',
    explain:'只读获取面板自身 TCP HTTP 监听状态；与 Nginx 或其他代理无关。',
    kind:'read',permission:'panel:read',exposure:{web:true,mcp:false},
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['active','configured','pending','restartRequired','publicOrigin'],
      properties:{active:endpointSchema,configured:endpointSchema,
        pending:{type:['object','null']},restartRequired:{type:'boolean'},publicOrigin:{type:'string'}}},
    execute:()=>controller.status()
  });
  registry.register('panel',{
    id:'panel.listener.request',title:'申请修改面板监听地址与端口',
    description:'仅提交监听配置变更申请；需在 Web 输入密码（可选 TOTP）确认，重启面板后才生效。对外开放前必须单独配置 TLS/防火墙。',
    explain:'不会执行系统命令、重启服务或编辑反向代理。变更仅在审批后保存在私有状态中。',
    kind:'write',permission:'panel:write',executionPolicy:'proposal-only',
    exposure:{web:true,mcp:false},
    inputSchema:endpointSchema,
    outputSchema:{type:'object',additionalProperties:false,required:['status','id','host','port','expiresAt'],
      properties:{status:{type:'string',enum:['approval_required']},id:{type:'string'},
        host:{type:'string'},port:{type:'integer'},expiresAt:{type:'string'}}},
    createPlan:async(input)=>[{type:'proposal',description:
      '申请将监听改为 '+input.host+':'+input.port+'；Web 密码确认后存储，下次显式重启服务生效'}],
    execute:(input,context)=>controller.request({userId:context.userId,...input})
  });
}
