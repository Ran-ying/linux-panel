// Fixed read-only journalctl contract. Never accepts caller-supplied flags.
export const SERVICE_LOGS_CONTRACT={
  title:'systemd 服务日志',
  description:'按服务名称读取最近的 systemd journal 日志（可能包含敏感内容）。',
  inputSchema:{type:'object',required:['unit'],additionalProperties:false,properties:{
    unit:{type:'string',minLength:9,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9_.@-]{0,119}\\.service$'},
    lines:{type:'integer',minimum:1,maximum:200,default:80}
  }},
  outputSchema:{type:'object',required:['unit','source','lines','output','truncated'],additionalProperties:false,properties:{
    unit:{type:'string'},source:{type:'string',enum:['journalctl']},
    lines:{type:'integer',minimum:0},
    output:{type:'string',maxLength:50000},truncated:{type:'boolean'}
  }}
};
