import {NGINX_CONTRACTS} from '../../platform/privileged/nginx-contracts.js';
import {collectNginxSites,checkNginx} from '../../platform/privileged/nginx-operations.js';

export async function setup({actions,moduleId}){
  for(const [name,contract] of Object.entries(NGINX_CONTRACTS)){
    actions.register(moduleId,{
      ...contract,id:'nginx.'+name,kind:'read',permission:'nginx:read',
      exposure:{web:true,mcp:true},privileged:{channels:['web']},
      explain:name==='sites'
        ? '扫描 sites-available、sites-enabled 和 conf.d/*.conf；只读取配置内的 server_name/listen 摘要。站点启用状态依据文件链接，不能替代 nginx -T 的完整生效配置判断。'
        : '通过固定命令 /usr/sbin/nginx -t 校验；启用独立 root 执行器并安装此版本 handler 后 Web 使用 root 身份，MCP 仍使用普通身份且可能因证书权限失败。',
      execute:name==='sites'?()=>collectNginxSites():()=>checkNginx()
    });
  }
}
