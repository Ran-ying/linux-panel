import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { addAudit } from './state-store.js';

const exec = promisify(execFile);
const invalid = message => Object.assign(new Error(message), {statusCode:400});

export async function runTerminalCommand(command, {timeoutSeconds=5}={}) {
  if (process.getuid?.() === 0)
    throw Object.assign(new Error('终端命令必须以面板普通用户运行，不能使用 root'), {statusCode:503});
  const {stdout,stderr} = await exec('timeout',
    ['--kill-after=1s',String(timeoutSeconds)+'s','/bin/sh','-c',command], {
      maxBuffer:128*1024,
      env:{...process.env,PATH:dirname(process.execPath)+':'+(process.env.PATH ?? '/usr/bin:/bin')}
    });
  return {stdout,stderr,exitCode:0};
}

export class ActionCommands {
  constructor(store, {run=runTerminalCommand}={}) { this.store=store; this.runCommand=run; }
  supports(action) {
    return process.platform==='linux' && action?.kind==='read' &&
      !!action.terminal?.fields && typeof action.terminal.decode==='function';
  }
  async config(action) {
    if (!this.supports(action)) return {editable:false,fields:[]};
    const all=(await this.store.snapshot()).actionCommands ?? {};
    const saved=all[action.id] ?? {};
    const legacy=action.terminal.migrateFrom ?? {};
    const migratedValue=key=>{
      const candidates=legacy[key]===undefined?[]:Array.isArray(legacy[key])?legacy[key]:[legacy[key]];
      return candidates.map(source=>all[source.actionId]?.[source.key]).find(value=>value!==undefined && value!==null);
    };
    return {editable:true,fields:Object.entries(action.terminal.fields).map(([key,value])=>({
      key,value:saved[key] ?? migratedValue(key) ?? value,defaultValue:value
    }))};
  }
  async save(action, input, actor) {
    if (!this.supports(action)) throw invalid('此操作没有可编辑的终端命令');
    const keys=Object.keys(action.terminal.fields);
    if (!input || typeof input!=='object' || Array.isArray(input) ||
        Object.keys(input).length!==keys.length || Object.keys(input).some(key=>!keys.includes(key)) ||
        keys.some(key=>typeof input[key]!=='string' || !input[key].trim() ||
          input[key].length>2048 || input[key].includes('\0')))
      throw invalid('命令字段不匹配，或命令为空、超过 2048 字符');
    const next=Object.fromEntries(keys.map(key=>[key,input[key].trim()]));
    await this.store.mutate(state=>{
      state.actionCommands ??= {};
      state.actionCommands[action.id]=next;
      addAudit(state,'action.commands.updated',actor,action.id);
    });
    return this.config(action);
  }
  async preview(action) {
    const {fields}=await this.config(action);
    return fields.map(({key,value})=>({key,type:'shell',command:value}));
  }
  async execute(action) {
    return (await this.executeWithRaw(action)).result;
  }
  async executeWithRaw(action) {
    const {fields}=await this.config(action);
    const values={},durations={},raw={};
    for (const {key,value} of fields) {
      const start=performance.now();
      try {
        const output=await this.runCommand(value);
        raw[key]=typeof output==='string'?{stdout:output,stderr:'',exitCode:0}:output;
        values[key]=raw[key].stdout.trim();
      }
      catch (cause) {
        if (cause.statusCode===503) throw cause;
        throw Object.assign(new Error('命令执行失败：'+key+'（退出码 '+(cause.code ?? 'timeout')+'）'),{statusCode:502});
      }
      durations[key]=performance.now()-start;
    }
    try {
      const result=action.terminal.decode(values,{durations});
      const finite=value=>typeof value==='number'?Number.isFinite(value):
        value && typeof value==='object'?Object.values(value).every(finite):true;
      if(!finite(result)) throw new Error('Invalid numeric output');
      return {result,raw};
    }
    catch { throw Object.assign(new Error('命令输出格式不匹配，请检查保存的命令'),{statusCode:502}); }
  }
}
