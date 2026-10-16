import os from 'node:os';
import {readFile} from 'node:fs/promises';

export function parseDistribution(content,fallback='Linux') {
  const values={};
  for(const line of content.split('\n')){
    const match=/^(PRETTY_NAME|NAME|VERSION|VERSION_ID)=(.*)$/.exec(line.trim());
    if(!match)continue;
    const value=match[2].replace(/^(['"])(.*)\1$/,'$2');
    values[match[1]]=value.replace(/\\(["\\])/g,'$1');
  }
  return values.PRETTY_NAME || [values.NAME,values.VERSION || values.VERSION_ID].filter(Boolean).join(' ') || fallback;
}
async function readSystemInfo() {
  let distribution=[os.type(),os.release()].join(' ');
  if(process.platform==='linux'){
    let release;
    try{release=await readFile('/etc/os-release','utf8');}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      try{release=await readFile('/usr/lib/os-release','utf8');}
      catch(fallbackError){if(fallbackError.code!=='ENOENT')throw fallbackError;}
    }
    distribution=parseDistribution(release ?? '',distribution);
  }
  return {platform:os.platform(),distribution,release:os.release(),arch:os.arch(),
    uptimeSeconds:os.uptime(),nodeVersion:process.version};
}
export default {
  id:'system.info',title:'基本信息',
  description:'读取操作系统发行版和版本、内核版本、架构、运行时间与 Node.js 版本。',
  explain:'Linux 从 os-release 的 PRETTY_NAME 读取发行版及版本，内核版本单独由 uname -r 返回。主机名和内存不在此 Action 采集；可用并行度归属资源使用情况的 CPU。',
  kind:'read',permission:'system:read',exposure:{web:true,mcp:true},
  inputSchema:{type:'object',additionalProperties:false,properties:{}},
  outputSchema:{type:'object',additionalProperties:false,
    required:['platform','distribution','release','arch','uptimeSeconds','nodeVersion'],
    properties:{platform:{type:'string'},distribution:{type:'string'},release:{type:'string'},
      arch:{type:'string'},uptimeSeconds:{type:'number',minimum:0},nodeVersion:{type:'string'}}},
  terminal:{
    fields:{
      distribution:"if [ -r /etc/os-release ]; then . /etc/os-release; elif [ -r /usr/lib/os-release ]; then . /usr/lib/os-release; fi; printf '%s\\n' \"${PRETTY_NAME:-${NAME:-$(uname -s)} ${VERSION:-${VERSION_ID:-}}}\"",
      platform:"uname -s | tr '[:upper:]' '[:lower:]'",
      release:'uname -r',arch:'uname -m',
      uptimeSeconds:"cut -d ' ' -f 1 /proc/uptime",nodeVersion:'node --version'
    },
    decode:values=>({...values,uptimeSeconds:Number(values.uptimeSeconds)})
  },
  createPlan:async()=>[{type:'node-api',code:readSystemInfo.toString()}],
  execute:readSystemInfo
};
