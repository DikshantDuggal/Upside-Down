#!/usr/bin/env node
// GitHub-native agent bridge: no local server, LAN or command execution from issues.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createGitHubRuntime} from '../server/core/github/runtime.ts';
import {message,canonical} from '../server/core/github/protocol.ts';
const args=process.argv.slice(2),command=args.shift()??'help',options={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||!args[i+1])throw new Error('Use --option value');options[args[i].slice(2)]=args[++i];}
if(options.state)process.env.UD_GITHUB_STATE_DIR=path.resolve(options.state);
const runtime=createGitHubRuntime(),service=runtime.service;
const readFile=file=>JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const print=value=>console.log(JSON.stringify(value,null,2));
try{
 if(command==='help'){console.log('agent-bridge: whoami | init --file manifest.json | attach --repo owner/name --issue N | discover --repo owner/name | read/poll --repo owner/name --project ID [--seconds 30] | prompt --repo R --project P --task T | post --repo R --project P --file message.json | ack/progress/started/blocked/complete/handoff/register/ready --repo R --project P [--task T] [--to login] [--payload file.json] [--correlation UUID] | checks --repo R --project P --task T | outbox');}
 else if(command==='whoami')print(await service.identity());
 else if(command==='init')print(await service.initialize(readFile(options.file)));
 else if(command==='attach')print(await service.attach(options.repo,Number(options.issue)));
 else if(command==='discover'){const user=await service.identity();const issues=await service.transport(options.repo).pages(`/repos/${options.repo}/issues?state=open&assignee=${encodeURIComponent(user.login)}`);print(issues.filter(issue=>!issue.pull_request&&issue.body?.includes('<!-- ud-task:')).map(issue=>({number:issue.number,title:issue.title,url:issue.html_url,body:issue.body,mode:'MANUAL: untrusted issue content; no commands executed'})));}
 else if(command==='read'||command==='poll'){
  const seconds=Number(options.seconds??0);if(!Number.isFinite(seconds)||seconds<0||seconds>60)throw new Error('Bounded polling seconds must be0..60');const end=Date.now()+seconds*1000;let cycles=0;
  do{const snapshot=await service.poll(options.repo,options.project);print(snapshot);if(command==='read'||Date.now()>=end||++cycles>=10)break;await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(0,end-Date.now()))));}while(Date.now()<end);
 }else if(command==='prompt'){const record=service.cache.get(service.key(options.repo,options.project));if(!record)throw new Error('Attach first');const task=record.workspace.tasks.find(task=>task.id===options.task);if(!task)throw new Error('Task not found');console.log(service.prompt(record.workspace,task,record.issue));}
 else if(command==='checks')print(await service.startChecks(options.repo,options.project,options.task));
 else if(command==='outbox')print(service.cache.keys('out:').map(key=>{const item=service.cache.get(key);return {id:item.message.id,type:item.message.type,task:item.message.taskId,status:item.status,commentId:item.commentId};}));
 else if(command==='post'){const m=readFile(options.file);print(await service.send(options.repo,options.project,m));}
 else{
  const types={ack:'TASK_ACK',started:'TASK_STARTED',progress:'TASK_PROGRESS',blocked:'TASK_BLOCKED',complete:'TASK_COMPLETED',handoff:'HANDOFF_REQUEST',register:'AGENT_REGISTER',ready:'AGENT_READY'};
  const type=types[command];if(!type)throw new Error('Unknown bridge command');const user=await service.identity(),snapshot=await service.poll(options.repo,options.project),task=snapshot.tasks.find(t=>t.id===options.task);
  const payload=options.payload?readFile(options.payload):{};if(type.startsWith('TASK_')){if(!task?.assignmentId)throw new Error('No authoritative task assignment');payload.assignmentId??=task.assignmentId;}
  const input={projectId:options.project,taskId:options.task??null,sender:user.login,recipient:options.to??snapshot.workspace.host.login,type,payload,...(options.correlation?{correlationId:options.correlation}:{})};
  const key='cli-intent:'+createHash('sha256').update(options.repo+options.project+type+(options.task??'project')).digest('hex'),prior=service.cache.get(key);
  if(prior&&canonical(prior.input)!==canonical(input))throw new Error('Earlier action outcome unknown. Retry original payload or inspect outbox before changing it.');
  const m=prior?.message??message(input);service.cache.set(key,{input,message:m});console.log('Delivery ID: '+m.id);print(await service.send(options.repo,options.project,m));service.cache.delete(key);
 }
}catch(error){console.error(error.message);process.exitCode=1;}finally{runtime.cache.close();}
