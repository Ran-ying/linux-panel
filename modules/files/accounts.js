import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// getent includes NSS accounts (not only /etc/passwd or /etc/group).
async function entries(database){
  const {stdout}=await exec('/usr/bin/getent',[database],{
    timeout:4000,maxBuffer:2*1024*1024,
    env:{PATH:'/usr/bin:/bin',LANG:'C'}
  });
  const names=new Map();
  for(const line of stdout.split('\n')){
    const fields=line.split(':');
    if(fields.length<4 || !fields[0] || !/^\d+$/.test(fields[2]))continue;
    const id=Number(fields[2]);
    if(Number.isSafeInteger(id) && id>=0 && id<=4294967294 && !names.has(fields[0]))
      names.set(fields[0],{name:fields[0],id});
  }
  return [...names.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export async function listAccounts(){
  const [users,groups]=await Promise.all([entries('passwd'),entries('group')]);
  return {users,groups};
}
