import {Router,type Request,type Response,type NextFunction} from 'express';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {GitHubCoordination} from '../core/github/coordination.ts';
import {message,validateMessage,validateWorkspace,type Workspace} from '../core/github/protocol.ts';
import {GitHubError,verifyWebhook} from '../core/github/transport.ts';
export interface ProjectSource {getProject(id:string):any;getArchitecture(id:string):any;listTasks(id:string):any[]}
export function createGitHubRouter(service:GitHubCoordination,projects:ProjectSource,pairingKey:string,allowedOrigins:string[],webhookSecret?:string){
 const router=Router(),sessions=new Map<string,{csrf:string;expires:number}>(),attempts=new Map<string,{count:number;at:number}>();
 const same=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
 const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(error=>{const code=Number(error.status)||(error instanceof GitHubError?503:400);res.status(code>=400&&code<600?code:400).json({error:error.message||'GitHub coordination failed',retryAt:error.retryAt});});};
 router.post('/webhook',handle(async(req,res)=>{
  const raw=(req as any).githubRaw as Buffer|undefined,signature=req.header('x-hub-signature-256')??'',delivery=req.header('x-github-delivery')??'';
  if(!raw||!webhookSecret||!verifyWebhook(raw,signature,webhookSecret)){res.status(401).json({error:'Invalid or unconfigured GitHub webhook signature'});return;}
  if(!/^[A-Za-z0-9-]{1,100}$/.test(delivery)){res.status(400).json({error:'Invalid delivery ID'});return;}
  const hash=createHash('sha256').update(raw).digest('hex'),old=service.cache.get<string>('webhook:'+delivery);
  if(old&&old!==hash){res.status(409).json({error:'Delivery ID payload collision'});return;}
  if(old||service.cache.get('webhook-body:'+hash)){res.json({duplicate:true});return;}
  const event=req.header('x-github-event');if(!['issue_comment','issues','pull_request','push','check_run','check_suite'].includes(event??'')){res.json({ignored:true});return;}
  const targets=service.workspaces().filter(item=>item.workspace.repo===req.body.repository?.full_name);if(targets.length>5)throw new Error('Too many webhook targets; use bounded CLI reconciliation');
  for(const item of targets)await service.poll(item.workspace.repo,item.workspace.projectId);
  service.cache.transaction(()=>{service.cache.set('webhook:'+delivery,hash);service.cache.set('webhook-body:'+hash,true);});res.json({processed:targets.length});
 }));
 router.use((req,res,next)=>{const origin=req.header('origin');if(origin&&!allowedOrigins.includes(origin)){res.status(403).json({error:'Origin forbidden'});return;}if(!['GET','HEAD'].includes(req.method)&&(!origin||!req.is('application/json'))){res.status(403).json({error:'Allowed Origin and JSON required'});return;}next();});
 router.post('/session',handle(async(req,res)=>{
  const ip=req.ip??'unknown',entry=attempts.get(ip);if(entry&&Date.now()-entry.at<60000&&entry.count>=8){res.status(429).json({error:'Too many pairing attempts'});return;}
  if(typeof req.body.pairingKey!=='string'||!same(req.body.pairingKey,pairingKey)){attempts.set(ip,{at:entry&&Date.now()-entry.at<60000?entry.at:Date.now(),count:entry&&Date.now()-entry.at<60000?entry.count+1:1});res.status(401).json({error:'Invalid GitHub dashboard pairing key'});return;}
  const user=await service.identity(),now=Date.now();for(const [key,value]of sessions)if(value.expires<now)sessions.delete(key);if(sessions.size>=32)throw new Error('Too many browser sessions');
  const id=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');sessions.set(id,{csrf,expires:now+7200000});res.setHeader('Set-Cookie',`ud_github_session=${id}; HttpOnly; SameSite=Strict; Path=/api/github; Max-Age=7200${req.secure?'; Secure':''}`);res.json({csrfToken:csrf,user});
 }));
 router.use((req,res,next)=>{const id=(req.header('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ud_github_session='))?.split('=')[1],session=id?sessions.get(id):undefined;if(!session||session.expires<Date.now()){res.status(401).json({error:'Pair the GitHub dashboard using the protected local key'});return;}if(!['GET','HEAD'].includes(req.method)&&!same(req.header('x-csrf-token')??'',session.csrf)){res.status(403).json({error:'CSRF token required'});return;}(req as any).githubCsrf=session.csrf;next();});
 router.get('/session',handle(async(req,res)=>{res.json({csrfToken:(req as any).githubCsrf,user:await service.identity()});}));
 router.get('/workspaces',handle(async(_req,res)=>{res.json({workspaces:service.workspaces()});}));
 router.post('/connect',handle(async(req,res)=>{
  const {projectId,repo,members,requiredChecks=[],workflow}=req.body,project=projects.getProject(projectId),arch=projects.getArchitecture(projectId),tasks=projects.listTasks(projectId);if(!project||!arch?.isApproved||!tasks.length)throw new Error('Select a project with approved architecture and generated tasks first');if(!Array.isArray(members)||members.length<1||members.length>3)throw new Error('Provide1..3 verified GitHub developers');
  const user=await service.identity();
  const workspace:Workspace={version:'UD-IC/2.0',projectId,name:project.name,description:project.problemStatement,architecture:JSON.stringify(arch),repo,host:user,members:members.map((member:any)=>({...member,id:1})),baseBranch:'main',requiredChecks,workflow,tasks:tasks.map((task:any,index:number)=>{const owner=members.find((member:any)=>member.role===task.assignedRole)??members[index%members.length];return {id:task.taskId,title:task.title,assignee:owner.login,tool:owner.tool,branch:'ud/'+projectId.replace(/[^\w-]/g,'-')+'/'+task.taskId.replace(/[^\w-]/g,'-'),description:task.objective,dependencies:task.dependencies,allowedPaths:task.allowedPaths,protectedPaths:task.protectedPaths,acceptanceCriteria:task.acceptanceCriteria,contracts:task.inputs};})};
  res.json(await service.initialize(workspace));
 }));
 router.post('/attach',handle(async(req,res)=>{res.json(await service.attach(req.body.repo,Number(req.body.issue)));}));
 router.get('/state',handle(async(req,res)=>{const snapshot=service.snapshot(String(req.query.repo),String(req.query.projectId));if(!snapshot){res.status(404).json({error:'No cached snapshot; synchronize first'});return;}res.json(snapshot);}));
 router.post('/sync',handle(async(req,res)=>{res.json(await service.poll(req.body.repo,req.body.projectId));}));
 router.post('/send',handle(async(req,res)=>{const user=await service.identity();const m=message({projectId:req.body.projectId,taskId:req.body.taskId??null,sender:user.login,recipient:req.body.recipient,type:req.body.type,payload:req.body.payload??{},...(req.body.correlationId?{correlationId:req.body.correlationId}:{})},req.body.id);res.json(await service.send(req.body.repo,req.body.projectId,validateMessage({...m,createdAt:req.body.createdAt??m.createdAt})));}));
 router.post('/assign',handle(async(req,res)=>{res.json(await service.assign(req.body.repo,req.body.projectId,req.body.taskId,req.body.assignee,req.body.branch));}));
 router.post('/checks',handle(async(req,res)=>{res.json(await service.startChecks(req.body.repo,req.body.projectId,req.body.taskId));}));
 router.get('/prompt',handle(async(req,res)=>{const snapshot=service.snapshot(String(req.query.repo),String(req.query.projectId)),task=snapshot?.workspace.tasks.find(t=>t.id===req.query.taskId);if(!snapshot||!task)throw new Error('Task not found');res.json({mode:'MANUAL',prompt:service.prompt(snapshot.workspace,task,snapshot.coordinatorIssue)});}));
 return router;
}
