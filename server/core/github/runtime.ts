import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {CoordinationCache} from './cache.ts';
import {GhApi} from './transport.ts';
import {GitHubCoordination} from './coordination.ts';
export function createGitHubRuntime(inMemory=false){
 if(inMemory){const cache=new CoordinationCache(':memory:');return {cache,service:new GitHubCoordination(new GhApi(),cache),pairingKey:randomBytes(32).toString('hex'),keyPath:'in-memory test session'};}
 const directory=path.resolve(process.env.UD_GITHUB_STATE_DIR??path.join(process.env.LOCALAPPDATA??process.env.XDG_STATE_HOME??process.cwd(),'UpsideDown','github-coordination'));
 if(!fs.existsSync(directory)){fs.mkdirSync(directory,{recursive:true,mode:0o700});if(process.platform==='win32'){const account=process.env.USERDOMAIN+'\\'+process.env.USERNAME;execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',account+':(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});}}
 const keyPath=path.join(directory,'dashboard.key');if(!fs.existsSync(keyPath))fs.writeFileSync(keyPath,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
 const pairingKey=fs.readFileSync(keyPath,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(pairingKey))throw new Error('Invalid protected GitHub dashboard key file');
 const cache=new CoordinationCache(path.join(directory,'github-cache.db'));return {cache,service:new GitHubCoordination(new GhApi(),cache),pairingKey,keyPath};
}
