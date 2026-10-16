// One fixed systemd unit repair; callers cannot supply a path, unit or command.
export const NGINX_UNIT_CONTRACT={
 title:'修复 Nginx 校验环境',
 description:'按已审核模板修复固定 root 执行器的地址族权限；不允许自定义命令或 systemd 单元。',
 inputSchema:{type:'object',additionalProperties:false,properties:{
   mode:{type:'string',enum:['status','stage','restart']},
   confirmation:{type:'string',const:'APPLY_REVIEWED_NGINX_UNIT'}
 },required:['mode','confirmation']},
 outputSchema:{type:'object',additionalProperties:false,properties:{
   status:{type:'string',maxLength:300},ready:{type:'boolean'},restartScheduled:{type:'boolean'}
 },required:['status','ready','restartScheduled']}
};
