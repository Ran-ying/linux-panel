import {callTelegram} from '../../platform/telegram-mcp-client.js';

const textOut={type:'object',additionalProperties:false,required:['text'],properties:{
  text:{type:'string'}
}};
const statusOut={type:'object',additionalProperties:false,required:['available','text'],properties:{
  available:{type:'boolean'},text:{type:'string'}
}};
const bot={type:'string',pattern:'^@[A-Za-z][A-Za-z0-9_]{4,31}$',maxLength:33};
const fields=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});

function ensureAllowed(chatId) {
  const allowed=(process.env.PANEL_TELEGRAM_ALLOWED_BOTS || '').split(',')
    .map(item=>item.trim().toLowerCase()).filter(Boolean);
  if(!allowed.includes(chatId.toLowerCase())) {
    throw Object.assign(new Error('Bot is not in PANEL_TELEGRAM_ALLOWED_BOTS'),{statusCode:403});
  }
}
function register(actions,moduleId,{name,title,description,kind='read',input,tool,project,execute}) {
  actions.register(moduleId,{
    id:'telegram.'+name,title,description,explain:'连接独立运行在 VPS 本地的 Telegram MCP；使用个人 Telegram 会话。请在独立服务中配置允许访问的机器人白名单。',
    kind,permission:kind==='read'?'telegram:read':'telegram:write',
    ...(kind==='write'?{executionPolicy:'telegram-interaction'}:{}),
    exposure:{web:true,mcp:true},inputSchema:input,outputSchema:name==='status'?statusOut:textOut,
    execute:execute??(async input=>{ensureAllowed(input.chat_id);return callTelegram(tool,project?project(input):input);})
  });
}
export async function setup({actions,moduleId}) {
  register(actions,moduleId,{
    name:'status',title:'Telegram 连接状态',description:'检查本机 Telegram 服务是否完成登录。',
    input:fields({}),execute:async()=>{
      try {const result=await callTelegram('get_me');return {available:true,text:result.text};}
      catch {return {available:false,text:'Telegram 服务未运行或账号尚未完成登录。'};}
    }
  });
  register(actions,moduleId,{
    name:'botInfo',title:'机器人资料',description:'获取指定 Telegram 机器人的资料。',
    tool:'get_chat',input:fields({chat_id:bot},['chat_id'])
  });
  register(actions,moduleId,{
    name:'messages',title:'机器人消息',description:'读取机器人最近消息，适合在发送或点击按钮后确认回复。',
    tool:'get_messages',input:fields({chat_id:bot,page:{type:'integer',minimum:1,maximum:20},
      page_size:{type:'integer',minimum:1,maximum:20}},['chat_id'])
  });
  register(actions,moduleId,{
    name:'buttons',title:'查看机器人按钮',description:'列出指定机器人消息的内联按钮及对应索引。',
    tool:'list_inline_buttons',input:fields({chat_id:bot,message_id:{type:'integer',minimum:1}},['chat_id'])
  });
  register(actions,moduleId,{
    name:'send',title:'发送机器人消息',description:'以个人 Telegram 账号给已允许的机器人发送纯文本命令或消息。',
    kind:'write',tool:'send_message',input:fields({
      chat_id:bot,message:{type:'string',minLength:1,maxLength:3500}
    },['chat_id','message'])
  });
  register(actions,moduleId,{
    name:'press',title:'点击机器人按钮',description:'点击已允许机器人某条消息中的内联按钮；必须指定按钮名称或索引。',
    kind:'write',tool:'press_inline_button',input:{
      type:'object',properties:{
        chat_id:bot,message_id:{type:'integer',minimum:1},
        button_text:{type:'string',minLength:1,maxLength:128},
        button_index:{type:'integer',minimum:0,maximum:99}
      },required:['chat_id'],additionalProperties:false,
      anyOf:[{required:['button_text']},{required:['button_index']}]
    }
  });
}
