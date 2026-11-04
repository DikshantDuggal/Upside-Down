import {beforeEach, expect, it, vi} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {GitHubCommunicationCenter} from '../src/features/GitHubCommunication';
const user={login:'hostdev',id:1};
const snapshot={workspace:{repo:'acme/demo',projectId:'mission',name:'Fixture',host:user,members:[{...user,role:'backend',tool:'codex'}]},coordinatorIssue:10,tasks:[{id:'task',title:'Backend',assignee:'hostdev',branch:'ud/backend',issue:11,assignmentId:'a',status:'submitted',progress:30,submission:{id:'s'},pr:{number:5,url:'https://github.com/acme/demo/pull/5',headSha:'a'.repeat(40),ci:'not_configured',valid:true,problems:[],checks:[]}}],agents:[],handoffs:[],messages:[],audit:[],removedSourceIds:[],cursor:'20',refreshedAt:'2026-11-04T00:00:00Z'};
let paired=true, failSend=false, sent:Record<string,unknown>[], pairingBody:unknown;
const result=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{paired=true;failSend=false;sent=[];pairingBody=undefined;vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
 const route=input.replace('/api/github/','');
 if(route==='session'){if(init?.method==='POST'){pairingBody=JSON.parse(String(init.body));paired=true;}return paired?result({user,csrfToken:'test-csrf'}):result({error:'Pair required'},401);}
 if(route==='workspaces')return result({workspaces:[{workspace:snapshot.workspace,issue:10}]});
 if(route.startsWith('state?')||route==='sync')return result(snapshot);
 if(route==='send'){sent.push(JSON.parse(String(init?.body)));if(failSend){failSend=false;throw new TypeError('Response lost');}return result({reconciled:true});}
 throw new Error('Unexpected request '+route);
}));});
it('requires explicit pairing and does not persist pairing or CSRF secrets',async()=>{
 paired=false;render(<GitHubCommunicationCenter/>);const input=await screen.findByLabelText('GitHub dashboard key');await userEvent.type(input,'test-pairing-key');await userEvent.click(screen.getByRole('button',{name:'Pair GitHub dashboard'}));await screen.findByText(/Authenticated GitHub account:/);expect(pairingBody).toEqual({pairingKey:'test-pairing-key'});expect(JSON.stringify({...localStorage,...sessionStorage})).not.toMatch(/test-pairing-key|test-csrf/);
});
it('keeps approval disabled when GitHub has no observed CI',async()=>{
 render(<GitHubCommunicationCenter/>);expect(await screen.findByRole('button',{name:'Approve verified submission'})).toBeDisabled();expect(screen.getByText(/CI: not_configured/)).toBeVisible();
});
it('retries an ambiguous write with the original UUID, timestamp and target',async()=>{
 render(<GitHubCommunicationCenter/>);await screen.findByRole('button',{name:'Post GitHub message'});failSend=true;await userEvent.click(screen.getByRole('button',{name:'Post GitHub message'}));await screen.findByRole('button',{name:'Retry original saved message'});const original=sent[0];expect(JSON.stringify({...localStorage})).not.toContain('test-csrf');await userEvent.click(screen.getByRole('button',{name:'Retry original saved message'}));await waitFor(()=>expect(sent).toHaveLength(2));expect(sent[1]).toEqual(original);await waitFor(()=>expect(screen.queryByRole('button',{name:'Retry original saved message'})).toBeNull());expect(localStorage.length).toBe(0);
});
