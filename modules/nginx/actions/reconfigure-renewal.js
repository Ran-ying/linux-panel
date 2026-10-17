import {NGINX_RECONFIGURE_CONTRACT} from '../../../platform/privileged/nginx-renewal-reconfigure.js';
export default {
  ...NGINX_RECONFIGURE_CONTRACT,id:'nginx.reconfigureRenewal',
  kind:'write',permission:'nginx:write',executionPolicy:'privileged',
  exposure:{web:false,mcp:true},privileged:{channels:['mcp']},
  explain:'该操作会向 ACME 测试环境验证当前证书并在成功后更新现有的 Certbot renewal 配置；不会停止或强制续期正式证书。',
  execute:async()=>{throw Object.assign(new Error('需要安装最新版固定 root 证书处理器'),{statusCode:503});}
};
