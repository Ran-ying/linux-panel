// Known V2Fly protocol/address/transport choices for the visual form.
// Include the current value as an option when it is custom or from a newer V2Ray release.
// The original JSON is never rewritten just because a choice is displayed.
const choices={
  inboundProtocol:['vmess','vless','socks','http','shadowsocks','dokodemo-door','trojan','vlite'],
  outboundProtocol:['freedom','blackhole','vmess','vless','socks','http','shadowsocks','trojan','dns','loopback','wireguard','vlite'],
  listen:['127.0.0.1','0.0.0.0','::1','::'],
  network:['tcp','ws','kcp','http','grpc','quic','domainsocket','httpupgrade'],
  security:['none','tls','utls']
};
const labels={
  '127.0.0.1':'127.0.0.1 · 仅本机 IPv4',
  '0.0.0.0':'0.0.0.0 · 所有 IPv4 接口',
  '::1':'::1 · 仅本机 IPv6',
  '::':':: · 所有 IPv6 接口',
  ws:'ws · WebSocket',
  kcp:'kcp · mKCP',
  http:'http · HTTP',
  grpc:'grpc · gRPC',
  quic:'quic · QUIC',
  domainsocket:'domainsocket · Unix Socket',
  httpupgrade:'httpupgrade · HTTP Upgrade',
  tls:'tls · TLS',
  utls:'utls · uTLS',
  none:'none · 无加密'
};
export function v2raySelectChoices(kind,current){
  if(!Object.hasOwn(choices,kind))throw Error('未知的 V2Ray 选项类型');
  const values=['',...choices[kind]];
  // Do not silently change/drop uncommon current values.
  if(typeof current==='string'&&current&&!values.includes(current))values.push(current);
  return values.map(value=>({
    value,label:value===''?'未设置（保留默认）':labels[value]??value
  }));
}

/**
 * Route targets come from the CURRENT unsaved visual/JSON draft, including
 * legacy detours. Keep unfamiliar values selected so changing views never
 * silently rewrites a custom, stale, or future-version tag.
 */
export function v2rayRoutingTagChoices(config,direction,current=''){
  if(direction!=='inbound'&&direction!=='outbound')throw Error('未知的路由标签类型');
  const sources=direction==='inbound'?['inbounds','inboundDetour']:['outbounds','outboundDetour'];
  const tags=new Set();
  for(const key of sources){
    if(!Array.isArray(config?.[key]))continue;
    for(const entry of config[key]){
      if(typeof entry?.tag==='string'&&entry.tag)tags.add(entry.tag);
    }
  }
  if(typeof current==='string'&&current)tags.add(current);
  return [{value:'',label:'请选择标签'},...[...tags].map(tag=>({value:tag,label:tag}))];
}
