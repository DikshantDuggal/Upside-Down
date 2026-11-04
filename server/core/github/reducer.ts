import {type Workspace,type AgentMessage,type RemoteComment,parse,canonical} from './protocol.ts';
export interface PrEvidence {number:number;url:string;author:string;branch:string;headSha:string;state:string;merged:boolean;files:string[];reviews:{login:string;state:string}[];checks:{name:string;status:string;conclusion:string|null}[];ci:'passed'|'failed'|'pending'|'not_configured';valid:boolean;problems:string[]}
export interface TaskView {id:string;title:string;assignee:string;branch:string;issue?:number;assignmentId?:string;status:'unassigned'|'awaiting_ack'|'acknowledged'|'running'|'blocked'|'submitted'|'failed'|'verified';progress:number;submission?:AgentMessage;pr?:PrEvidence;blocker?:string;discoveredPrs?:{number:number;url:string;headSha:string}[]}
export interface HandoffView {id:string;taskId:string;targetTaskId:string;sender:string;recipient:string;status:'pending'|'acknowledged'|'responded'|'completed';text:string;deadline?:string;response?:string;responseId?:string;hostApproved?:boolean}
export interface Snapshot {workspace:Workspace;coordinatorIssue:number;tasks:TaskView[];agents:{login:string;role:string;tool:string;status:string}[];handoffs:HandoffView[];messages:(AgentMessage&{sourceId:number;url:string;author:string})[];audit:{sourceId:number;decision:string;reason:string}[];cursor:string;refreshedAt:string;removedSourceIds:number[]}
const eq=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export function reduce(workspace:Workspace,coordinatorIssue:number,comments:RemoteComment[],evidence:Record<string,PrEvidence>={}):Snapshot{
 const tasks=workspace.tasks.map(t=>({id:t.id,title:t.title,assignee:t.assignee,branch:t.branch,status:'unassigned',progress:0} as TaskView));
 const agents=workspace.members.map(m=>({login:m.login,role:m.role,tool:m.tool,status:'not_registered'}));
 const snapshot:Snapshot={workspace,coordinatorIssue,tasks,agents,handoffs:[],messages:[],audit:[],cursor:String(Math.max(0,...comments.map(c=>c.id))),refreshedAt:new Date().toISOString(),removedSourceIds:[]};
 const known=new Map<string,{body:string;message:AgentMessage}>(),accepted=new Map<string,AgentMessage>();
 const ordered=[...comments].sort((a,b)=>a.id-b.id);let pending=ordered;
 const process=(comment:RemoteComment,final=false):'done'|'defer'=>{
  let m:AgentMessage|null;try{m=parse(comment.body);}catch(error){snapshot.audit.push({sourceId:comment.id,decision:'rejected',reason:'Malformed protocol: '+(error as Error).message});return 'done';}if(!m)return 'done';
  const reject=(reason:string)=>{snapshot.audit.push({sourceId:comment.id,decision:'rejected',reason});return 'done' as const;};
  if(comment.created_at!==comment.updated_at)return reject('Edited protocol comments are quarantined; publish a new correlated message');
  if(m.projectId!==workspace.projectId)return reject('Wrong project');
  const member=workspace.members.find(x=>x.id===comment.user.id&&eq(x.login,comment.user.login));const host=comment.user.id===workspace.host.id&&eq(comment.user.login,workspace.host.login);
  if(!member&&!host)return reject('GitHub author is not an authorized member');if(!eq(m.sender,comment.user.login))return reject('Payload sender does not match actual GitHub author');
  if(!['host','all'].includes(m.recipient)&&!workspace.members.some(x=>eq(x.login,m!.recipient))&&!eq(m.recipient,workspace.host.login))return reject('Unknown recipient');
  const duplicate=known.get(m.id);if(duplicate){if(duplicate.body!==canonical(m))return reject('Message ID content collision');snapshot.audit.push({sourceId:comment.id,decision:'duplicate',reason:'Same message ID already processed'});return 'done';}
  const task=m.taskId?tasks.find(t=>t.id===m!.taskId):undefined;
  if(m.taskId&&!task)return reject('Unknown task');
  const hostOnly=['TASK_ASSIGNMENT','CONTRACT_UPDATE','HOST_MESSAGE','HOST_APPROVAL','HOST_REJECTION','INTEGRATION_REQUEST'];if(hostOnly.includes(m.type)&&!host)return reject('Only the verified project host can perform this action');
  if(m.type==='TASK_ASSIGNMENT'){
   const spec=workspace.tasks.find(t=>t.id===task?.id);if(!task||!spec||!workspace.members.some(x=>eq(x.login,String(m!.payload.assignee)))||!/^[-A-Za-z0-9_./]+$/.test(String(m.payload.branch))||String(m.payload.branch).includes('..')||[workspace.baseBranch,'main','master'].includes(String(m.payload.branch)))return reject('Invalid assignment owner/branch');
   if(task.issue&&task.issue!==Number(m.payload.issue))return reject('Reassignment must preserve the task issue');
   if(comment.issue!==coordinatorIssue&&comment.issue!==Number(m.payload.issue))return reject('Assignment on unrelated issue');
   task.assignee=String(m.payload.assignee);task.branch=String(m.payload.branch);task.issue=Number(m.payload.issue);task.assignmentId=m.id;task.status='awaiting_ack';task.progress=0;task.submission=undefined;task.pr=undefined;
  }else{
   if(task&&!task.assignmentId){if(!final)return 'defer';return reject('Task assignment not yet available');}
   if(task&&comment.issue!==task.issue&&comment.issue!==coordinatorIssue)return reject('Message posted on the wrong task issue');
   if(m.correlationId&&!accepted.has(m.correlationId)){if(!final)return 'defer';return reject('Unknown/deleted/quarantined correlation source');}
   if(m.type.startsWith('TASK_')){
    if(!task||!eq(task.assignee,m.sender))return reject('Only the currently assigned developer can update the task');
    if(m.payload.assignmentId!==task.assignmentId)return reject('Stale assignment revision');
    if(m.type==='TASK_ACK'){if(task.status!=='awaiting_ack')return reject('Task already acknowledged or advanced');task.status='acknowledged';}
    if(m.type==='TASK_STARTED'){if(!['acknowledged','blocked','failed'].includes(task.status))return reject('Acknowledge before starting');const spec=workspace.tasks.find(t=>t.id===task.id)!;if(spec.dependencies.some(id=>tasks.find(t=>t.id===id)?.status!=='verified'))return reject('Dependencies require verified completion');task.status='running';task.blocker=undefined;}
    if(m.type==='TASK_PROGRESS'){if(task.status!=='running')return reject('Task is not running');if(typeof m.payload.progress!=='number'||m.payload.progress<task.progress)return reject('Progress cannot silently regress');task.progress=m.payload.progress;}
    if(m.type==='TASK_BLOCKED'||m.type==='TASK_FAILED'){if(!['running','acknowledged','blocked'].includes(task.status))return reject('Invalid blocking/failure transition');task.status=m.type==='TASK_BLOCKED'?'blocked':'failed';task.blocker=String(m.payload.text??'Developer reported failure');}
    if(m.type==='TASK_COMPLETED'){if(!['running','blocked'].includes(task.status))return reject('Start task before submitting');if(m.payload.branch!==task.branch)return reject('Submission is for the wrong assigned branch');task.status='submitted';task.submission=m;task.pr=evidence[m.id];}
   }else if(m.type==='AGENT_REGISTER'||m.type==='AGENT_READY'||m.type==='AGENT_RECONNECT'||m.type==='AGENT_DISCONNECT'){
    const agent=agents.find(a=>eq(a.login,m!.sender));if(!agent)return reject('Only registered team identities can report presence');if(m.type==='AGENT_REGISTER'){if(m.payload.role!==agent.role||!['codex','claude-code','antigravity','opencode','cursor','aider','custom','manual'].includes(String(m.payload.tool)))return reject('Registration must preserve the approved role and use a supported manual tool');agent.tool=String(m.payload.tool);agent.status='registered_manual';}else if(m.type==='AGENT_DISCONNECT')agent.status='disconnected';else agent.status='ready_manual';
   }else if(m.type==='HANDOFF_REQUEST'){
    const target=tasks.find(t=>t.id===m!.payload.targetTaskId);if(!task||!eq(task.assignee,m.sender)||!target||!eq(target.assignee,m.recipient))return reject('Handoff must be between actual task owners');
    const existing=snapshot.handoffs.find(h=>h.taskId===task.id&&h.targetTaskId===target.id&&h.text===m!.payload.text&&h.status!=='completed');if(existing)return reject('An equivalent unresolved handoff already exists');
    snapshot.handoffs.push({id:m.id,taskId:task.id,targetTaskId:target.id,sender:m.sender,recipient:m.recipient,status:'pending',text:String(m.payload.text),deadline:(()=>{const raw=m!.payload.deadline;if(typeof raw!=='string')return undefined;const duration=raw.match(/^(\d+)(s|m|h)$/);if(!duration)return raw;return new Date(Date.parse(comment.created_at)+Number(duration[1])*({s:1000,m:60000,h:3600000}[duration[2]]??0)).toISOString();})()});
   }else if(m.type.startsWith('HANDOFF_')){
    const h=snapshot.handoffs.find(h=>h.id===m!.correlationId);if(!h||![h.taskId,h.targetTaskId].includes(m.taskId??''))return reject('Handoff request/task not found');const sourceTask=tasks.find(t=>t.id===h.taskId),targetTask=tasks.find(t=>t.id===h.targetTaskId);if(!sourceTask||!targetTask||!eq(sourceTask.assignee,h.sender)||!eq(targetTask.assignee,h.recipient))return reject('Handoff ownership changed; host review required');
    if(m.type==='HANDOFF_COMPLETED'){if(!eq(m.sender,h.sender)||h.status!=='responded')return reject('Only requester can complete a responded handoff');h.status='completed';}
    else {if(!eq(m.sender,h.recipient)||!eq(m.recipient,h.sender))return reject('Only intended recipient can acknowledge/respond');if(m.type==='HANDOFF_ACK'){if(h.status!=='pending')return reject('Handoff already acknowledged');h.status='acknowledged';}else {if(!['pending','acknowledged'].includes(h.status))return reject('Handoff already responded');h.status='responded';h.response=String(m.payload.contract??m.payload.text??'');h.responseId=m.id;}}
   }else if(m.type==='HOST_APPROVAL'){
    const submission=m.correlationId?accepted.get(m.correlationId):undefined,pr=submission?evidence[submission.id]:undefined;
    if(submission?.type==='HANDOFF_RESPONSE'){
      const handoff=snapshot.handoffs.find(h=>h.responseId===submission.id&&h.taskId===m!.taskId);if(!handoff)return reject('Handoff response is unavailable');handoff.hostApproved=true;
    }else{
      if(!task||task.status!=='submitted'||submission?.id!==task.submission?.id||!pr?.valid||pr.ci!=='passed'||m.payload.expectedHeadSha!==pr.headSha||m.payload.prNumber!==pr.number)return reject('Approval requires current verified PR SHA, path policy and actual passing CI');task.status='verified';task.progress=100;
    }
   }else if(m.type==='HOST_REJECTION'){
    if(!task||!task.submission||task.submission.id!==m.correlationId)return reject('Reject the current submission explicitly');task.status='blocked';task.blocker=String(m.payload.text??'Host requested revision');
   }else if(m.type==='HOST_MESSAGE'&&m.payload.action==='resolve_blocker'){
    if(!task||task.status!=='blocked')return reject('Only a blocked task can be cleared');task.status='acknowledged';task.blocker=String(m.payload.text??'Host cleared blocker; explicit developer resume required');
   }else if(m.type==='CONTRACT_ACK'){
    if(accepted.get(m.correlationId!)?.type!=='CONTRACT_UPDATE')return reject('ACK must reference a host contract update');
   }else if(m.type==='INTEGRATION_RESULT'){
    if(!host)return reject('CI results must be fetched by host connector; text cannot prove success');
   }
  }
  known.set(m.id,{body:canonical(m),message:m});accepted.set(m.id,m);snapshot.messages.push({...m,sourceId:comment.id,url:comment.html_url,author:comment.user.login});snapshot.audit.push({sourceId:comment.id,decision:'accepted',reason:'Verified GitHub author and protocol transition'});return 'done';
 };
 // Resolve references without trusting delivery order. Dependencies that remain
 // unavailable are quarantined rather than mutating ownership or execution state.
 for(let pass=0;pending.length&&pass<=ordered.length;pass++){const next=pending.filter(comment=>process(comment) === 'defer');if(next.length===pending.length){next.forEach(comment=>process(comment,true));break;}pending=next;}
 return snapshot;
}
