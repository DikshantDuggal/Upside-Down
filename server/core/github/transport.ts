import {spawn} from 'node:child_process';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {CoordinationCache} from './cache.ts';
import {canonical,parse,serialize,type AgentMessage,type GitHubUser,type RemoteComment} from './protocol.ts';
export interface ApiResponse<T=any>{status:number;headers:Record<string,string>;data:T}
export interface GitHubApi {request<T=any>(method:string,endpoint:string,body?:unknown,etag?:string):Promise<ApiResponse<T>>}
export class GitHubError extends Error {status:number;retryAt?:number;constructor(message:string,status=0,retryAt?:number){super(message);this.status=status;this.retryAt=retryAt;}}
const redact=(s:string)=>s.replace(/(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]+|Bearer\s+\S+/gi,'[REDACTED]');
export class GhApi implements GitHubApi {
 async request<T=any>(method:string,endpoint:string,body?:unknown,etag?:string):Promise<ApiResponse<T>>{
  if(!/^\/(?:user(?:\/|$)|users\/|repos\/)/.test(endpoint)||endpoint.includes('://')||endpoint.includes('\\')||endpoint.includes('..'))throw new Error('Unsupported GitHub API endpoint');
  const args=['api','--hostname','github.com','--include','--method',method,'--header','Accept: application/vnd.github+json','--header','X-GitHub-Api-Version: 2022-11-28'];if(etag)args.push('--header','If-None-Match: '+etag);args.push(endpoint);if(body!==undefined)args.push('--input','-');
  const output=await new Promise<{out:string;error:string;code:number|null}>((resolve,reject)=>{const child=spawn('gh',args,{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});let out='',error='';const timer=setTimeout(()=>{child.kill();reject(new GitHubError('GitHub request timed out; a write may have succeeded'));},20000);child.stdout.on('data',chunk=>{out+=chunk;if(out.length>8*1024*1024){child.kill();reject(new GitHubError('GitHub response exceeded safe limit'));}});child.stderr.on('data',chunk=>{error=(error+chunk).slice(-4000);});child.on('error',()=>{clearTimeout(timer);reject(new GitHubError('GitHub CLI unavailable or authentication not configured'));});child.on('close',code=>{clearTimeout(timer);resolve({out,error,code});});child.stdin.on('error',()=>{});child.stdin.end(body===undefined?'':JSON.stringify(body));});
  const normalized=output.out.replace(/\r\n/g,'\n'),split=normalized.indexOf('\n\n'),head=split<0?'':normalized.slice(0,split),raw=split<0?normalized:normalized.slice(split+2);const status=Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]??0),headers:Record<string,string>={};for(const line of head.split('\n').slice(1)){const i=line.indexOf(':');if(i>0)headers[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}
  let data:any;try{data=raw.trim()?JSON.parse(raw):undefined;}catch{throw new GitHubError('GitHub returned malformed JSON',status);}
  if(status===304)return {status,headers,data:undefined as T};
  if(output.code!==0||status<200||status>=300){const retry=headers['retry-after'],reset=headers['x-ratelimit-reset'];throw new GitHubError(redact(status===401?'GitHub authentication expired':status===403||status===429?'GitHub permission/rate-limit failure':`GitHub request failed (${status||'network'}): ${data?.message??output.error.slice(0,200)}`),status,retry?Date.now()+Number(retry)*1000:reset?Number(reset)*1000:undefined);}
  return {status,headers,data};
 }
}
export interface ReceivedMessageBatch {comments:RemoteComment[];cursor:string}
export interface SendResult {comment:RemoteComment;reconciled:boolean}
export interface AgentTransport {send(message:AgentMessage,issue:number):Promise<SendResult>;receive(issue:number):Promise<ReceivedMessageBatch>;acknowledge(message:AgentMessage,issue:number):Promise<SendResult>;getStatus():Promise<{login:string;repository:string;authenticated:boolean}>}
export class GitHubTransport implements AgentTransport {
 readonly api:GitHubApi; readonly cache:CoordinationCache; readonly repo:string;
 constructor(api:GitHubApi,cache:CoordinationCache,repo:string){this.api=api;this.cache=cache;this.repo=repo;}
 async read<T=any>(endpoint:string):Promise<ApiResponse<T>>{for(let attempt=0;attempt<3;attempt++){const prior=this.cache.get<ApiResponse<T>>('http:'+endpoint);try{const result=await this.api.request<T>('GET',endpoint,undefined,prior?.headers.etag);if(result.status===304){if(!prior)throw new Error('Conditional response has no cached page');return prior;}this.cache.set('http:'+endpoint,result);return result;}catch(error){if(!(error instanceof GitHubError)||![0,408,429,500,502,503,504].includes(error.status)&&!(error.status===403&&error.retryAt)||attempt===2)throw error;const delay=Math.max(200*2**attempt,(error.retryAt??0)-Date.now());if(delay>3000)throw error;await new Promise(resolve=>setTimeout(resolve,delay));}}throw new Error('Read retry exhausted');}
 async pages<T=any>(endpoint:string,maxPages=20):Promise<T[]>{let page=1,result:T[]=[];while(page<=maxPages){const url=endpoint+(endpoint.includes('?')?'&':'?')+`per_page=100&page=${page}`;const response=await this.read<T[]>(url);if(!Array.isArray(response.data))throw new Error('GitHub collection invalid');result.push(...response.data);if(!response.headers.link?.includes('rel="next"'))return result;page++;}throw new Error('GitHub pagination bound exceeded; checkpoint preserved');}
 async getStatus(){const user=(await this.read<GitHubUser>('/user')).data;return {login:user.login,repository:this.repo,authenticated:true};}
 async receive(issue:number){const comments=(await this.pages<any>(`/repos/${this.repo}/issues/${issue}/comments`)).map(c=>({...c,issue})) as RemoteComment[];if(comments.some(c=>!Number.isSafeInteger(c.id)))throw new Error('Unsupported GitHub comment ID');return {comments,cursor:String(Math.max(0,...comments.map(c=>c.id)))};}
 async send(message:AgentMessage,issue:number):Promise<SendResult>{return this.cache.locked(`send:${this.repo}:${issue}:${message.id}`,async()=>{const user=(await this.read<GitHubUser>('/user')).data;if(user.login.toLowerCase()!==message.sender.toLowerCase())throw new Error('Message sender must be the authenticated GitHub account');
  const key=`out:${this.repo}:${issue}:${message.id}`,pending=this.cache.get<{message:AgentMessage;issue:number}>(key);if(pending&&canonical(pending.message)!==canonical(message))throw new Error('Message ID reused with different content');
  const existing=(await this.receive(issue)).comments.find(comment=>{try{return parse(comment.body)?.id===message.id&&comment.user.id===user.id;}catch{return false;}});
  if(existing){if(canonical(parse(existing.body))!==canonical(message))throw new Error('Existing remote ID has different content');this.cache.set(key,{message,issue,status:'posted',commentId:existing.id});return {comment:existing,reconciled:true};}
  this.cache.set(key,{message,issue,status:'unknown'}); // Written before request; no blind write retries.
  const result=await this.api.request<any>('POST',`/repos/${this.repo}/issues/${issue}/comments`,{body:serialize(message)});const comment={...result.data,issue} as RemoteComment;this.cache.set(key,{message,issue,status:'posted',commentId:comment.id});return {comment,reconciled:false};});}
 acknowledge(message:AgentMessage,issue:number){if(!['TASK_ACK','HANDOFF_ACK','CONTRACT_ACK'].includes(message.type))throw new Error('Not an acknowledgement message');return this.send(message,issue);}
}
export function verifyWebhook(raw:Buffer,signature:string,secret:string){if(!secret||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;const expected=Buffer.from('sha256='+createHmac('sha256',secret).update(raw).digest('hex'));const supplied=Buffer.from(signature);return expected.length===supplied.length&&timingSafeEqual(expected,supplied);}
