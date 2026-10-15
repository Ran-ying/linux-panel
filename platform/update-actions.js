/**
 * Platform-owned update Actions: the Web and MCP adapters invoke precisely the
 * same validated implementation. This does not grant access to the root broker.
 */
export function registerUpdateActions(registry, controller) {
  registry.register('panel', {
    id: 'panel.update.status',
    title: '面板更新状态',
    description: '查看当前待确认更新以及独立执行器的最后结果。',
    explain: '从平台状态库读取审批记录和 root 执行器只读结果；不会运行 Git/npm 或更改系统。',
    kind: 'read',
    permission: 'panel:read',
    exposure: { web: true, mcp: true },
    inputSchema: {type:'object',properties:{},additionalProperties:false},
    outputSchema: {type:'object',properties:{
      brokerEnabled:{type:'boolean'},
      pending:{type:['object','null'],properties:{
        id:{type:'string'},from:{type:'string'},target:{type:'string'},
        createdAt:{type:'string'},expiresAt:{type:'string'},approved:{type:'boolean'}
      },required:['id','from','target','createdAt','expiresAt','approved'],additionalProperties:false},
      lastResult:{type:['object','null'],properties:{
        id:{type:'string'},sha:{type:'string'},status:{type:'string'},at:{type:'string'}
      },required:['id','sha','status','at'],additionalProperties:false}
    },required:['brokerEnabled','pending','lastResult'],additionalProperties:false},
    createPlan:async()=>[{type:'local-state',description:'读取面板更新申请和只读更新状态，不执行任何更新'}],
    execute:async()=>controller.status()
  });
  registry.register('panel', {
    id: 'panel.update.check',
    title: '检查面板更新',
    description: '只读比较当前 Git SHA 与 origin/main；私有仓库可填写候选完整 SHA，最终仍由独立 Broker 验证。',
    explain: '此 Action 不修改磁盘或状态。提供的 SHA 尚未经过可信远程验证，不能视为可部署证明。',
    kind: 'read',
    permission: 'panel:read',
    exposure: {web:true,mcp:false},
    inputSchema:{type:'object',additionalProperties:false,properties:{
      targetSha:{type:'string',pattern:'^[a-f0-9]{40}$'}
    }},
    outputSchema:{type:'object',properties:{
      status:{type:'string',enum:['up_to_date','update_available']},
      currentSha:{type:'string',pattern:'^[a-f0-9]{40}$'},
      targetSha:{type:'string',pattern:'^[a-f0-9]{40}$'},
      source:{type:'string',enum:['origin_main','supplied_sha']}
    },required:['status','currentSha','targetSha','source'],additionalProperties:false},
    createPlan:async()=>[{type:'git-read',description:'读取本地 HEAD 和主分支 SHA，不修改仓库'}],
    execute:async input=>controller.check(input)
  });
  registry.register('panel', {
    id: 'panel.update.request',
    title: '申请更新 Linux Panel',
    description: '申请将 Linux Panel 更新到受信任的 origin/main 指定提交；必须由管理员在 Web 中另外确认。私有仓库可填写最新完整 Git SHA。',
    explain: '这是非执行性写 Action：只创建有时效的更新申请，不直接拉取代码、重启服务或运行 root 命令。MCP 另需 panel:update Scope 及更新开关。',
    kind: 'write',
    executionPolicy: 'proposal-only',
    permission: 'panel:update',
    exposure: {web:true,mcp:true},
    inputSchema:{type:'object',additionalProperties:false,properties:{
      targetSha:{type:'string',pattern:'^[a-f0-9]{40}$'}
    }},
    outputSchema:{type:'object',properties:{
      status:{type:'string',enum:['up_to_date','approval_required']},
      sha:{type:'string'},id:{type:'string'},from:{type:'string'},
      target:{type:'string'},expiresAt:{type:'string'},instructions:{type:'string'}
    },required:['status'],additionalProperties:false},
    createPlan:async()=>[{type:'approval-proposal',description:'创建有时效的候选 SHA 申请；实际部署必须由可信 Broker 验证 origin/main 并经过管理员批准'}],
    execute:async(input,context)=>{
      if(typeof context.userId!=='string'||!context.userId) {
        throw Object.assign(new Error('Unauthorized update proposal'),{statusCode:403});
      }
      return controller.request({userId:context.userId,clientId:context.clientId??'web',targetSha:input.targetSha});
    }
  });
  registry.register('panel', {
    id:'panel.update.execute',
    title:'直接排队执行 Linux Panel 受限更新',
    description:'独立 OAuth panel:update:execute 授权后，将受信任的 origin/main 精确提交交给受限 Broker；不需要每次重新 Web 审批。',
    explain:'仅调度固定 Broker；不能执行 shell、选择任意仓库或跳过根执行器的 Git/构建/回滚检查。执行队列不代表部署成功。',
    kind:'write',executionPolicy:'broker-enqueue',
    permission:'panel:update:execute',
    exposure:{web:false,mcp:true},
    inputSchema:{type:'object',additionalProperties:false,properties:{
      targetSha:{type:'string',pattern:'^[a-f0-9]{40}$'}
    }},
    outputSchema:{type:'object',properties:{
      status:{type:'string',enum:['up_to_date','queued']},
      sha:{type:'string'},id:{type:'string'},from:{type:'string'},
      target:{type:'string'},expiresAt:{type:'string'}
    },required:['status'],additionalProperties:false},
    createPlan:async()=>[{type:'broker-queue',description:'经实时独立 OAuth 高权限授权后只提交固定 Git SHA 给 Broker；根执行器继续独立校验并允许回滚'}],
    execute:async(input,context)=>{
      if(context.channel!=='mcp'||context.directUpdateAuthorized!==true ||
         typeof context.userId!=='string'||!context.userId ||
         typeof context.clientId!=='string'||!context.clientId) {
        throw Object.assign(new Error('Trusted direct update MCP authorization required'),{statusCode:403});
      }
      return controller.executeDirect({userId:context.userId,clientId:context.clientId,
        targetSha:input.targetSha,authorizeEnqueue:context.authorizeEnqueue});
    }
  });
}
