export default [
  {actionId:'files.list',renderer:'files',loadOnEnter:true,refreshIntervalMs:0,
    operations:{read:'files.read',write:'files.write',upload:'files.upload'}},
  ...['read','write','upload'].map(operation=>({actionId:'files.'+operation,embedded:true,
    renderer:'metrics',fields:[{key:'path',label:'文件路径'}]}))
];
