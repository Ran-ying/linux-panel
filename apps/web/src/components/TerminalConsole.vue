<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props=defineProps({actionId:{type:String,required:true},csrf:{type:String,required:true}});
const emit=defineEmits(['unauthorized']);
const screen=ref(null),connected=ref(false),busy=ref(false),error=ref(''),line=ref('');
let term,fit,observer,sessionId,cursor=0,timer,inputTimer,disposed=false,pending='',sending=false;
async function request(path,method='GET',body){
  const reply=await fetch('/api/terminal/sessions'+path,{
    method,keepalive:method==='DELETE',headers:{...(method!=='GET'?{'X-Panel-CSRF':props.csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const data=await reply.json();
  if(reply.status===401)emit('unauthorized');
  if(!reply.ok)throw new Error(data.error || '终端请求失败');
  return data;
}
async function flush(){
  if(sending || !pending || !sessionId)return;
  sending=true;const data=pending.slice(0,4096);pending=pending.slice(4096);
  try{await request('/'+sessionId+'/input','POST',{data});}
  catch(cause){error.value=cause.message;pending='';}
  finally{sending=false;if(pending)void flush();}
}
function send(data){
  if(!connected.value)return;
  pending+=data;
  if(inputTimer)clearTimeout(inputTimer);
  inputTimer=setTimeout(()=>void flush(),25);
}
function sendLine(){send(line.value+'\r');line.value='';term?.focus();}
async function poll(){
  const id=sessionId;
  if(!id || disposed)return;
  try{
    const data=await request('/'+id+'/output?after='+cursor);
    if(disposed || id!==sessionId)return;
    if(data.lost)term.writeln('\r\n[较早输出已移出缓冲区]');
    for(const chunk of data.chunks){
      const bytes=Uint8Array.from(atob(chunk.data),c=>c.charCodeAt(0));
      await new Promise(resolve=>term.write(bytes,resolve));
    }
    cursor=data.cursor;
    if(data.closed){connected.value=false;sessionId=undefined;term.writeln('\r\n[终端已断开]');return;}
  }catch(cause){if(!disposed)error.value=cause.message;await disconnect();return;}
  if(!disposed && sessionId)timer=setTimeout(()=>void poll(),150);
}
async function connect(){
  if(busy.value || connected.value)return;
  busy.value=true;error.value='';
  try{
    fit.fit();
    const opened=await request('','POST',{actionId:props.actionId,cols:Math.max(20,Math.min(300,term.cols)),rows:Math.max(5,Math.min(100,term.rows))});
    if(disposed){void request('/'+opened.id,'DELETE').catch(()=>{});return;}
    sessionId=opened.id;cursor=0;term.reset();connected.value=true;term.focus();void poll();
  }catch(cause){error.value=cause.message;}
  finally{busy.value=false;}
}
async function disconnect(){
  clearTimeout(timer);clearTimeout(inputTimer);pending='';
  const id=sessionId;sessionId=undefined;connected.value=false;
  if(id)try{await request('/'+id,'DELETE');}catch(cause){if(!disposed)error.value=cause.message;}
}
onMounted(()=>{
  window.addEventListener('pagehide',disconnect);
  term=new Terminal({cursorBlink:true,screenReaderMode:true,fontSize:14,scrollback:3000,theme:{background:'#080b10',foreground:'#e5e7eb'}});
  fit=new FitAddon();term.loadAddon(fit);term.open(screen.value);fit.fit();
  term.writeln('点击“连接终端”开始。');
  term.onData(send);
  let cols=term.cols,rows=term.rows;
  observer=new ResizeObserver(()=>{
    fit.fit();
    if(connected.value && (term.cols!==cols || term.rows!==rows)){
      cols=term.cols;rows=term.rows;
      void request('/'+sessionId+'/resize','POST',{cols:Math.max(20,Math.min(300,cols)),rows:Math.max(5,Math.min(100,rows))})
        .catch(cause=>{error.value=cause.message;});
    }
  });observer.observe(screen.value);
});
onBeforeUnmount(()=>{
  disposed=true;window.removeEventListener('pagehide',disconnect);observer?.disconnect();void disconnect();term?.dispose();
});
</script>

<template>
  <section class="terminal-console" aria-label="交互终端">
    <div class="result-header">
      <strong>终端</strong>
      <div class="terminal-controls">
        <span class="muted small">{{ connected ? '已连接' : '未连接' }}</span>
        <button v-if="!connected" type="button" :disabled="busy" @click="connect">连接终端</button>
        <template v-else>
          <button type="button" @click="send('\u0003')">Ctrl+C</button>
          <button type="button" @click="disconnect">断开</button>
        </template>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div ref="screen" class="terminal-screen" aria-label="服务器终端"></div>
    <form v-if="connected" class="terminal-line" @submit.prevent="sendLine">
      <label class="sr-only" for="terminal-line">终端输入</label>
      <input id="terminal-line" v-model="line" autocomplete="off" spellcheck="false" placeholder="输入命令" />
      <button type="submit">发送</button>
    </form>
  </section>
</template>
