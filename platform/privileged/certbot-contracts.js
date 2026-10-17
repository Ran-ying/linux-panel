const s=(n=255)=>({type:'string',maxLength:n});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const certName={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const row=object({name:certName,domains:{type:'array',items:s(255)},authenticator:s(64),
  validTo:s(64),daysRemaining:{type:'integer'},status:s(32)});
export const CERTBOT_CONTRACTS={
  list:{title:'Certbot 证书管理',description:'查看 Certbot 已登记的续期证书、验证方式、到期时间及系统定时器状态。',
    inputSchema:object({}),outputSchema:object({
      installed:{type:'boolean'},timerActive:{type:'boolean'},timerEnabled:{type:'boolean'},
      count:{type:'integer',minimum:0},certificates:{type:'array',items:row},
      warnings:{type:'array',items:s(240)}})},
  renew:{title:'Certbot 检查并续期',description:'经确认后检查单个已登记的 Certbot 证书是否需要续期。',
    inputSchema:object({name:certName}),outputSchema:object({ok:{type:'boolean'},status:s(240),output:s(4000),reloaded:{type:'boolean'}})}
};
