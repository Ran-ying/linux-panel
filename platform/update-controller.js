import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { addAudit } from './state-store.js';

const execFile=promisify(execFileCallback);
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const SHA=/^[a-f0-9]{40}$/;
const ID=/^[a-f0-9]{32}$/;
const TTL=15*60*1000;

export function createUpdateController({store,root,auth,enabled=process.env.PANEL_UPDATER_ENABLED==='1',
    triggerPath=process.env.PANEL_UPDATE_TRIGGER ?? '/var/lib/linux-panel/update-trigger',
    resultPath=process.env.PANEL_UPDATE_RESULT ?? '/var/lib/linux-panel-update-status/result.json'}) {
  // Platform-controlled broker gate. MCP policy is enforced ONLY by the MCP
  // adapter; disabling MCP must never disable an administrator's Web updates.
  // An approved job is active until its exact root Broker result arrives;
  // expiry limits user approval windows, NOT deployment execution duration.
  // Otherwise a slow npm build could pass TTL and authorize a second job.
  const isBlocking=(pending,lastResult)=>Boolean(pending &&
    (pending.approved===true ? lastResult?.id!==pending.id : pending.expiresAt>Date.now()));
  const ensure=()=>{
    if(!enabled) throw error('Update broker is not enabled',404);
  };
  const revisions=async targetSha=>{
    if(targetSha !== undefined && !SHA.test(targetSha))
      throw error('Invalid target Git SHA');
    const opts={timeout:15000,maxBuffer:4096,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}};
    const from=(await execFile('git',['-C',root,'rev-parse','HEAD'],opts)).stdout.trim();
    const target=targetSha ?? (await execFile('git',
      ['-C',root,'ls-remote','--exit-code','origin','refs/heads/main'],opts))
      .stdout.trim().split(/\s+/)[0];
    if(!SHA.test(target)||!SHA.test(from))throw error('Invalid Git commit identity',502);
    return {from,target};
  };
  const check=async({targetSha}={})=>{
    // Safe read-only check even before the root Broker has been installed.
    const {from,target}=await revisions(targetSha);
    return {status:from===target?'up_to_date':'update_available',
      currentSha:from,targetSha:target,source:targetSha===undefined?'origin_main':'supplied_sha'};
  };
  const readResult=async()=>{
    try {
      const value=JSON.parse(await readFile(resultPath,'utf8'));
      if(!ID.test(value.id) || !SHA.test(value.sha) ||
          !['success','failed','rolled_back','no_change'].includes(value.status)) return null;
      return {id:value.id,sha:value.sha,status:value.status,at:value.at};
    } catch(e) {if(e.code==='ENOENT')return null;throw e;}
  };
  const status=async()=>{
    const state=await store.snapshot();
    const record=state.updateRequest;
    const lastResult=await readResult();
    // A completed broker result supersedes a previously approved proposal.
    // It must not appear to be queued forever or block subsequent updates.
    return {brokerEnabled:enabled,pending:record && isBlocking(record,lastResult)?
      {id:record.id,from:record.from,target:record.target,createdAt:record.createdAt,
        expiresAt:new Date(record.expiresAt).toISOString(),approved:record.approved===true}:null,
      lastResult};
  };
  const request=async({userId,clientId,targetSha})=>{
    ensure();
    const state=await store.snapshot();
    const lastResult=await readResult();
    const pending=state.updateRequest;
    if(pending?.expiresAt>Date.now() &&
        !(pending.approved===true && lastResult?.id===pending.id))
      throw error(pending.approved?'Approved update still pending execution':'Update already requested',409);
    // No shell, branch, URL or revision arguments accepted from an AI client.
    // Git remote must be provisioned and trusted separately by the operator.
    // For private repositories, a client can provide a SHA; only the
    // independent broker may subsequently trust it after remote verification.
    const {from,target}=await revisions(targetSha);
    if(target===from) return {status:'up_to_date',sha:from};
    const record={id:randomBytes(16).toString('hex'),from,target,createdAt:new Date().toISOString(),
      expiresAt:Date.now()+TTL,approved:false,userId,clientId};
    await store.mutate(state=>{
      if(state.updateRequest?.expiresAt>Date.now() &&
          !(state.updateRequest.approved===true && lastResult?.id===state.updateRequest.id))
        throw error('Already pending',409);
      state.updateRequest=record;
      addAudit(state,'panel.update.requested',userId,record.id);
    });
    return {status:'approval_required',id:record.id,from,target,
      expiresAt:new Date(record.expiresAt).toISOString(),
      instructions:'Approve this exact commit in Linux Panel Web settings. MCP cannot self-approve.'};
  };
  const approve=async({identity,id,password,code})=>{
    if(!ID.test(id??''))throw error('Invalid update request ID');
    const initial=await store.snapshot();
    ensure();
    const pending=initial.updateRequest;
    if(!pending || pending.id!==id || pending.userId!==identity.user.id ||
        pending.expiresAt<=Date.now() || pending.approved)throw error('Expired or unavailable update',409);
    await auth.verifyStepUp(identity,password,code);
    await store.mutate(state=>{
      const q=state.updateRequest;
      if(!q || q.id!==id || q.approved || q.expiresAt<=Date.now())throw error('Update request changed',409);
      q.approved=true;
      addAudit(state,'panel.update.approved',identity.user.id,q.id);
    });
    // Fixed text protocol. No user-controlled command, ref or remote URL.
    const marker=`id=${id}\nsha=${pending.target}\n`;
    try {await writeFile(triggerPath,marker,{flag:'wx',mode:0o600});}
    catch(cause) {
      await store.mutate(s=>{if(s.updateRequest?.id===id)s.updateRequest.approved=false;});
      if(cause.code==='EEXIST')throw error('Updater already busy',409);
      throw error('Update broker is not installed or cannot write trigger',503);
    }
    return {ok:true,id,target:pending.target,status:'queued'};
  };
  // Explicitly delegated MCP execution: already authorized by the transport
  // with a live *separate* panel:update:execute OAuth grant and Web policy.
  // This is not a generic shell or an alternate remote selector. The fixed
  // root Broker re-verifies that target equals pinned origin/main and is FF.
  const executeDirect=async({userId,clientId,targetSha})=>{
    ensure();
    if(typeof userId!=='string'||!userId||typeof clientId!=='string'||!clientId)
      throw error('Authenticated update client required',403);
    const state=await store.snapshot();
    const lastResult=await readResult();
    const previous=state.updateRequest;
    if(isBlocking(previous,lastResult))
      throw error('Update already queued or awaiting approval',409);
    const {from,target}=await revisions(targetSha);
    if(from===target) return {status:'up_to_date',sha:from};
    const item={id:randomBytes(16).toString('hex'),from,target,
      createdAt:new Date().toISOString(),expiresAt:Date.now()+TTL,
      approved:true,userId,clientId};
    await store.mutate(s=>{
      const q=s.updateRequest;
      if(isBlocking(q,lastResult))
        throw error('Concurrent update request',409);
      s.updateRequest=item;
      addAudit(s,'panel.update.direct_queued',userId,item.id);
    });
    // Create-only marker, identical fixed protocol to Web approval.
    // The worker ignores every other field supplied by an MCP client.
    try {
      await writeFile(triggerPath,`id=${item.id}\nsha=${target}\n`,{flag:'wx',mode:0o600});
    } catch(cause) {
      await store.mutate(s=>{
        if(s.updateRequest?.id===item.id)delete s.updateRequest;
        addAudit(s,'panel.update.direct_enqueue_failed',userId,item.id);
      });
      if(cause.code==='EEXIST')throw error('Update worker is already busy',409);
      throw error('Update broker trigger unavailable',503);
    }
    return {status:'queued',id:item.id,from,target,
      expiresAt:new Date(item.expiresAt).toISOString()};
  };
  const cancel=async({identity,id})=>{
    // Revocation must remain possible even if the operator disables the Broker.
    if(!ID.test(id??''))throw error('Invalid update request ID');
    await store.mutate(state=>{
      const q=state.updateRequest;
      if(!q || q.id!==id || q.userId!==identity.user.id ||
          q.approved || q.expiresAt<=Date.now())
        throw error('Update request cannot be cancelled',409);
      delete state.updateRequest;
      addAudit(state,'panel.update.cancelled',identity.user.id,id);
    });
    return {ok:true,id,status:'cancelled'};
  };
  return {request,status,check,approve,cancel,executeDirect};
}
