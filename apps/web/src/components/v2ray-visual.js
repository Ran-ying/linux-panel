// Lossless, local-only V2Ray visual configuration operations.
// Never normalize unrelated config fields or send content outside the Web editor.
export const VISUAL_SECTIONS=new Set(['inbounds','outbounds','inboundDetour','outboundDetour','routing']);
const BLOCKED=new Set(['__proto__','constructor','prototype']);
const guardPath=path=>{
  if(!Array.isArray(path)||path.length>8||path.some(key=>typeof key!=='number'&&
    (typeof key!=='string'||BLOCKED.has(key))))throw Error('无效的配置路径');
};
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function visualBasePath(config,section){
  if(!VISUAL_SECTIONS.has(section))throw Error('当前分类不支持可视化');
  if(section!=='routing')return [section];
  const routing=config.routing;
  if(routing!==undefined&&!isObject(routing))throw Error('路由配置不是对象，请使用 JSON 编辑');
  if(isObject(routing?.settings)){
    return ['routing','settings','rules'];
  }
  if(routing?.settings!==undefined&&!isObject(routing.settings))
    throw Error('路由 settings 不是对象，请使用 JSON 编辑');
  return ['routing','rules'];
}
export function getPath(root,path){
  guardPath(path);
  return path.reduce((obj,key)=>obj?.[key],root);
}
export function visualEntries(config,section){
  const val=getPath(config,visualBasePath(config,section));
  if(val===undefined)return [];
  if(!Array.isArray(val))throw Error('此分类不是数组，请切换到 JSON 编辑');
  return val;
}
export function supportsVisual(config,section){
  if(!VISUAL_SECTIONS.has(section))return false;
  try{
    visualEntries(config,section);
    return true;
  }catch{return false;}
}
export function formatList(value){
  return Array.isArray(value)?value.join('\n'):value??'';
}

// Only explicitly supported routing conditions belong in the Add condition menu.
// Unknown properties remain in the draft untouched and editable in JSON mode.
export const ROUTING_OPTIONAL_CONDITIONS=Object.freeze([
  {key:'balancerTag',label:'平衡器标签（balancerTag）'},
  {key:'port',label:'端口条件（port）'},
  {key:'network',label:'网络条件（network）'},
  {key:'source',label:'来源 IP（source）'},
  {key:'domain',label:'域名条件（domain）'},
  {key:'protocol',label:'协议条件（protocol）'},
  {key:'ip',label:'IP 条件（ip）'}
].map(option=>Object.freeze(option)));
const routeKeys=new Set(ROUTING_OPTIONAL_CONDITIONS.map(option=>option.key));
function hasNonBlankValue(value){
  if(value===null||value===undefined)return false;
  if(typeof value==='string')return value.trim().length>0;
  if(Array.isArray(value))return value.some(hasNonBlankValue);
  if(typeof value==='object')return Object.values(value).some(hasNonBlankValue);
  return true; // 0 and false are real values, not blank strings.
}
export function routingConditionVisible(rule,key,expanded=[]){
  if(!routeKeys.has(key))return false;
  return hasNonBlankValue(rule?.[key]) || expanded.includes(key);
}
export function availableRoutingConditions(rule,expanded=[]){
  return ROUTING_OPTIONAL_CONDITIONS.filter(option=>!routingConditionVisible(rule,option.key,expanded));
}

function ensureParent(root,path){
  guardPath(path);
  let item=root;
  for(let i=0;i<path.length-1;i++){
    const key=path[i],next=path[i+1];
    if(item[key]===undefined)item[key]=typeof next==='number'?[]:{};
    if(!isObject(item[key])&&!Array.isArray(item[key]))
      throw Error('配置字段类型不支持可视化编辑，请使用 JSON');
    item=item[key];
  }
  return item;
}
function normalize(value,kind){
  if(kind==='number'){
    if(String(value).trim()==='')return undefined;
    const result=Number(value);
    if(!Number.isSafeInteger(result)||result<0||result>65535)throw Error('端口/数字必须为 0 至 65535 的整数');
    return result;
  }
  if(kind==='list'){
    const items=String(value).split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
    return items.length?items:undefined;
  }
  if(typeof value!=='string')throw Error('字段必须是文本');
  return value===''?undefined:value;
}
export function patchVisual(config,section,{action,path=[],value,kind='text',item}){
  const root=JSON.parse(JSON.stringify(config));
  const base=visualBasePath(root,section);
  const relative=[...base,...path];
  guardPath(relative);
  if(action==='set'){
    if(!path.length)throw Error('不能直接替换整个分类');
    const parent=ensureParent(root,relative),key=relative.at(-1);
    const next=normalize(value,kind);
    if(next===undefined)delete parent[key];else parent[key]=next;
  }else if(action==='add'){
    const parent=ensureParent(root,relative),key=relative.at(-1);
    if(parent[key]===undefined)parent[key]=[];
    if(!Array.isArray(parent[key]))throw Error('目标不是列表，请使用 JSON 编辑');
    parent[key].push(item===undefined?{}:JSON.parse(JSON.stringify(item)));
  }else if(action==='remove'){
    if(!path.length||typeof relative.at(-1)!=='number')throw Error('只能删除列表中的条目');
    const parent=getPath(root,relative.slice(0,-1)),idx=relative.at(-1);
    if(!Array.isArray(parent)||idx<0||idx>=parent.length)throw Error('条目不存在');
    parent.splice(idx,1);
  }else throw Error('不支持的可视化编辑操作');
  return root;
}
