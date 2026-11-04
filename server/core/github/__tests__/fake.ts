import {type GitHubApi,type ApiResponse,GitHubError} from '../transport.ts';
import {serialize,type AgentMessage,type GitHubUser} from '../protocol.ts';
export class FakeGitHub implements GitHubApi {
 users:Record<string,GitHubUser>={hostdev:{login:'hostdev',id:1},alice:{login:'alice',id:2},bob:{login:'bob',id:3},mallory:{login:'mallory',id:4}};
 user=this.users.hostdev;issues:any[]=[];comments:any[]=[];labels=new Set<string>();number=100;commentId=1000;revision=1;writes=0;requests=0;failReads=false;loseNextWrite=false;dispatches=0;prHead='a'.repeat(40);prBranch='ud/frontend';prOwner='alice';checkConclusion='success';files=['web/src/task.tsx'];
 as(login:string){this.user=this.users[login];return this;}
 add(issue:number,m:AgentMessage,login=m.sender){const now=new Date().toISOString();const comment={id:++this.commentId,body:serialize(m),user:this.users[login],created_at:now,updated_at:now,html_url:`https://github.com/acme/demo/issues/${issue}#issuecomment-${this.commentId}`,issue};this.comments.push(comment);this.revision++;return comment;}
 async request<T=any>(method:string,endpoint:string,body?:any,etag?:string):Promise<ApiResponse<T>>{
  this.requests++;if(method==='GET'&&this.failReads)throw new GitHubError('GitHub unavailable',401);
  const url=new URL(endpoint,'https://api.github.com'),route=url.pathname;let data:any,headers:Record<string,string>={},status=200;
  const tag='"'+this.revision+':'+this.user.login+'"';if(method==='GET'&&etag===tag)return {status:304,headers:{etag:tag},data:undefined as T};
  const page=(items:any[])=>{const n=Number(url.searchParams.get('page')??1),limit=Number(url.searchParams.get('per_page')??100);if(items.length>n*limit)headers.link='<next>; rel="next"';return items.slice((n-1)*limit,n*limit);};
  if(method==='GET'){
   if(route==='/user')data={...this.user,private_note:'DO_NOT_PUBLISH'};
   else if(route.startsWith('/users/')){data=this.users[route.split('/').at(-1)!];if(!data)throw new GitHubError('Missing user',404);}
   else if(route==='/repos/acme/demo')data={full_name:'acme/demo',default_branch:'main',has_issues:true,permissions:{push:this.user.id===1}};
   else if(route.includes('/assignees/')){status=204;data=undefined;}
   else if(route.includes('/labels/')){if(!this.labels.has(decodeURIComponent(route.split('/').at(-1)!)))throw new GitHubError('Missing label',404);data={name:route.split('/').at(-1)};}
   else if(route==='/repos/acme/demo/issues')data=page(this.issues);
   else if(/\/issues\/\d+\/comments$/.test(route))data=page(this.comments.filter(c=>c.issue===Number(route.split('/').at(-2))));
   else if(/\/issues\/\d+$/.test(route)){data=this.issues.find(i=>i.number===Number(route.split('/').at(-1)));if(!data)throw new GitHubError('Missing issue',404);}
   else if(/\/pulls\/\d+\/files$/.test(route))data=page(this.files.map(filename=>({filename})));
   else if(/\/pulls\/\d+\/commits$/.test(route))data=[{sha:this.prHead}];
   else if(/\/pulls\/\d+\/reviews$/.test(route))data=[];
   else if(/\/pulls\/\d+$/.test(route))data={number:Number(route.split('/').at(-1)),html_url:'https://github.com/acme/demo/pull/1',user:this.users[this.prOwner],head:{sha:this.prHead,ref:this.prBranch,repo:{full_name:'acme/demo'}},base:{ref:'main'},changed_files:this.files.length,state:'open',merged:false};
   else if(route.endsWith('/check-runs'))data={total_count:1,check_runs:[{name:'tests',status:'completed',conclusion:this.checkConclusion}]};
   else if(route.endsWith('/status'))data={total_count:0,statuses:[],state:'success'};
   else if(route.includes('/actions/workflows/'))data={id:77,state:'active',html_url:'https://github.com/acme/demo/actions/workflows/ci.yml'};
   else throw new Error('Unimplemented fake GET '+endpoint);
   headers.etag=tag;
  }else{
   this.writes++;this.revision++;
   if(route.endsWith('/labels')){this.labels.add(body.name);data=body;status=201;}
   else if(route==='/repos/acme/demo/issues'){data={number:++this.number,title:body.title,body:body.body,user:this.user,html_url:`https://github.com/acme/demo/issues/${this.number}`,assignees:body.assignees??[]};this.issues.push(data);status=201;}
   else if(/\/issues\/\d+\/comments$/.test(route)){const now=new Date().toISOString();data={id:++this.commentId,body:body.body,user:this.user,created_at:now,updated_at:now,html_url:'https://github.com/acme/demo/issues/1#issuecomment-'+this.commentId,issue:Number(route.split('/').at(-2))};this.comments.push(data);status=201;if(this.loseNextWrite){this.loseNextWrite=false;throw new GitHubError('Response lost after acceptance');}}
   else if(route.endsWith('/dispatches')){this.dispatches++;status=204;}
   else if(method==='PATCH'){const issue=this.issues.find(i=>i.number===Number(route.split('/').at(-1)));if(issue)Object.assign(issue,body);data=body;}
   else throw new Error('Unimplemented fake write '+endpoint);
  }
  return {status,headers,data:data as T};
 }
}
