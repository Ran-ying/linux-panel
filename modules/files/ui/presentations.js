export default [
  {actionId:'files.list',renderer:'files',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{accounts:'files.accounts',read:'files.read',write:'files.write',upload:'files.upload',create:'files.create',rename:'files.rename',delete:'files.delete',chmod:'files.chmod',chown:'files.chown'}},
  {actionId:'files.accounts',embedded:true,renderer:'metrics',fields:[{key:'users',label:'用户'}]},
  ...['read','write','upload','create','rename','delete','chmod','chown'].map(operation=>({actionId:'files.'+operation,embedded:true,
    renderer:'metrics',fields:[{key:'path',label:'文件路径'}]}))
];
