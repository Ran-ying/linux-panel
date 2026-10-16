export default [
  {actionId:'files.list',renderer:'files',chrome:'minimal',loadOnEnter:true,refreshIntervalMs:0,
    operations:{read:'files.read',write:'files.write',upload:'files.upload',create:'files.create',rename:'files.rename',delete:'files.delete'}},
  ...['read','write','upload','create','rename','delete'].map(operation=>({actionId:'files.'+operation,embedded:true,
    renderer:'metrics',fields:[{key:'path',label:'文件路径'}]}))
];
