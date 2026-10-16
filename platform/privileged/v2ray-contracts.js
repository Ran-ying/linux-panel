// Audited V2Fly V2Ray actions: no caller-controlled paths, binaries or commands.
const string=(maxLength=300)=>({type:'string',maxLength});
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const revision={type:'string',pattern:'^[a-f0-9]{64}$'};
const content={type:'string',minLength:2,maxLength:1048576};
const result=obj({ok:{type:'boolean'},message:string(300),output:string(4000)});
export const V2RAY_CONTRACTS={
  status:{title:'V2Ray 管理',description:'读取本机 V2Fly 内核、systemd 服务及配置摘要（不返回配置中的密钥）。',
    inputSchema:obj({}),outputSchema:obj({
      installed:{type:'boolean'},version:string(120),service:string(32),enabled:{type:'boolean'},
      binary:string(160),configPath:string(160),configExists:{type:'boolean'},
      inbounds:{type:'integer',minimum:0},outbounds:{type:'integer',minimum:0},
      features:{type:'array',items:string(36)},message:string(300)
    })},
  read:{title:'读取 V2Ray 配置',description:'读取本机完整 JSON 配置与 SHA-256 版本戳，供管理员编辑。',
    inputSchema:obj({}),outputSchema:obj({content,revision,configPath:string(160)})},
  test:{title:'校验 V2Ray 配置',description:'使用当前安装的 V2Ray 内核检验候选 JSON，不切换正在运行的配置。',
    inputSchema:obj({content}),outputSchema:result},
  save:{title:'保存 V2Ray 配置',description:'版本校验、原子写入、内核语法检查；运行中服务重启失败时恢复原配置。',
    inputSchema:obj({content,revision}),outputSchema:obj({
      ok:{type:'boolean'},message:string(300),output:string(4000),revision,restarted:{type:'boolean'}
    })},
  service:{title:'管理 V2Ray 服务',description:'仅操作固定 v2ray.service：启动、停止、重启、启用和停用开机自启。',
    inputSchema:obj({operation:{type:'string',enum:['start','stop','restart','enable','disable']}}),
    outputSchema:result},
  install:{title:'安装 V2Ray 5.x',description:'仅未安装时下载安装经过 SHA-256 固定校验的 V2Fly 5.47.0 官方发行包。',
    inputSchema:obj({confirm:{type:'boolean',const:true}}),outputSchema:result}
};
