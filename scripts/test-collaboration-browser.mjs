// Real browser project/task/handoff/ACK across two independent authenticated devices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server/index.ts';
import { LocalStore } from '../client-local/src/store.ts';
import { CoordinatorClient } from '../client-local/src/transport.ts';
import { createLocalService } from '../client-local/src/server.ts';
import { startWebHost } from './web-host.mjs';
import { chromium, expect } from '../web/node_modules/@playwright/test/index.mjs';
const root = path.resolve(import.meta.dirname,'..'), scratch = fs.mkdtempSync(path.join(tmpdir(),'ud-collaboration-'));
let coordinator, remote, browser; const devices=[];
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function device(name){
 const port=await freePort(), origin=`http://127.0.0.1:${port}`, store=new LocalStore(path.join(scratch,name+'.db'));
 const token=coordinator.auth.enroll(store.deviceId).token, pairingKey=randomUUID();
 const local=await createLocalService({store,client:new CoordinatorClient(`http://127.0.0.1:${remote.address().port}`,token),pairingKey,port:0,allowedOrigins:[origin]});
 const host=await startWebHost({port,localOrigin:local.origin,configPath:path.join(scratch,name+'-frontend.json')});
 const context=await browser.newContext(),page=await context.newPage();
 const result={store,local,host,context,page,origin,pairingKey};devices.push(result);
 await page.goto(origin);await page.getByRole('button',{name:'Pair browser',exact:true}).click();await page.getByLabel('Local pairing key',{exact:true}).fill(pairingKey);
 await page.getByRole('dialog').getByRole('button',{name:'Pair browser',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 return result;
}
async function register(device,id,name){const page=device.page;await page.getByRole('link',{name:'Handoffs',exact:true}).click();await page.getByLabel('New agent ID',{exact:true}).fill(id);await page.getByLabel('Agent name',{exact:true}).fill(name);await page.getByRole('button',{name:'Register agent',exact:true}).click();await expect(page.getByText('Agent registered on this device. No AI runtime was started.',{exact:true})).toBeVisible();}
async function task(device,title,owner){const page=device.page;await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByRole('textbox',{name:'Task title'}).fill(title);await page.getByLabel('Owner ID',{exact:false}).fill(owner);await page.getByRole('button',{name:'Queue task',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>coordinator.coordinator.listTasks().filter(t=>t.title===title).length,{timeout:20000}).toBe(1);return coordinator.coordinator.listTasks().find(t=>t.title===title);}
try {
 coordinator=createServer(path.join(scratch,'coordinator.db'),{authenticate:true,sseReplay:true});remote=coordinator.app.listen(0,'127.0.0.1');await once(remote,'listening');const coordinatorPort=remote.address().port;
 browser=await chromium.launch({headless:true});const a=await device('a'),b=await device('b');assert.notEqual(a.store.deviceId,b.store.deviceId);
 const projectName=`PROJECT ACCEPTANCE ${randomUUID()}`;
 await a.page.getByRole('link',{name:'Projects',exact:true}).click();await a.page.getByLabel('Project name',{exact:true}).fill(projectName);await a.page.getByLabel('Project description',{exact:true}).fill('Real two-device handoff acceptance');
 await a.page.getByRole('button',{name:'Create project',exact:true}).click();await expect(a.page.getByRole('heading',{name:projectName,exact:true})).toBeVisible();
 await a.page.reload();await expect(a.page.getByRole('heading',{name:projectName,exact:true})).toBeVisible();
 const project=coordinator.coordinator.listProjects().find(p=>p.name===projectName);assert.ok(project);
 const suffix=randomUUID().slice(0,8),agentA='backend-'+suffix,agentB='frontend-'+suffix;
 await register(a,agentA,'Backend fixture agent');await register(b,agentB,'Frontend fixture agent');
 const taskA=await task(a,'Backend task '+suffix,agentA),taskB=await task(b,'Frontend task '+suffix,agentB);
 await a.page.getByRole('link',{name:'Handoffs',exact:true}).click();
 await a.page.getByLabel('Sending agent',{exact:true}).selectOption(agentA);await a.page.getByLabel('Receiving agent',{exact:true}).selectOption(agentB);
 await a.page.getByLabel('Associated task',{exact:true}).selectOption(taskA.id);await a.page.getByLabel('Dependent task (optional)',{exact:true}).selectOption(taskB.id);
 await a.page.getByLabel('Project context (optional)',{exact:true}).selectOption(project.id);
 const summary='HANDOFF ACCEPTANCE '+suffix;await a.page.getByLabel('Handoff summary',{exact:true}).fill(summary);await a.page.getByRole('button',{name:'Send handoff',exact:true}).click();
 await expect(a.page.getByText('Handoff recorded. Recipient acknowledgement is tracked separately.',{exact:true})).toBeVisible();
 await b.page.getByRole('link',{name:'Handoffs',exact:true}).click();await expect(b.page.getByText(summary,{exact:true})).toBeVisible({timeout:20000});
 const original=coordinator.coordinator.listHandoffs().find(h=>h.summary===summary);assert.equal(original.taskId,taskA.id);assert.equal(original.dependentTaskId,taskB.id);assert.equal(original.payload.projectId,project.id);assert.equal(original.payload.contract,'UD-IC/1.0');
 await b.page.getByRole('button',{name:'Acknowledge handoff',exact:true}).click();await expect(b.page.getByText('Recipient acknowledgement recorded.',{exact:true})).toBeVisible();
 await expect(a.page.getByText(/Acknowledged by recipient/).first()).toBeVisible({timeout:20000});
 assert.equal(coordinator.coordinator.listHandoffs().filter(h=>h.payload.ackFor===original.id).length,1);
 const session=await a.context.request.get(a.origin+'/local/session',{headers:{'X-UD-Contract':'UD-IC/1.0'}}).then(r=>r.json());
 const spoof=await a.context.request.post(a.origin+'/api/handoffs',{headers:{Origin:a.origin,'X-UD-Contract':'UD-IC/1.0','X-CSRF-Token':session.csrfToken,'Idempotency-Key':randomUUID()},data:{fromAgent:agentB,toAgent:agentA,taskId:taskA.id,handoffType:'context_sharing',summary:'forged receiver',payload:{ackFor:original.id}}});
 assert.equal(spoof.status(),403);assert.equal(a.store.batch().length,0);assert.equal(b.store.batch().length,0);
 await b.page.reload();await expect(b.page.getByText(/Acknowledged by recipient/).first()).toBeVisible({timeout:15000});
 await b.page.setViewportSize({width:390,height:844});assert.equal(await b.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));
 await a.page.getByRole('link',{name:'Projects',exact:true}).click();await a.page.getByLabel('Project name',{exact:true}).fill('must not queue offline');
 await expect(a.page.getByRole('button',{name:'Create project',exact:true})).toBeDisabled({timeout:20000});assert.equal(a.store.batch().length,0);
 remote=coordinator.app.listen(coordinatorPort,'127.0.0.1');await once(remote,'listening');
 await expect(a.page.getByRole('button',{name:'Create project',exact:true})).toBeEnabled({timeout:20000});
 assert.equal(coordinator.coordinator.listProjects().length,1);assert.equal(coordinator.coordinator.listTasks().length,2);assert.equal(coordinator.coordinator.listHandoffs().length,2);
 fs.writeFileSync(path.join(root,'.board/evidence/collaboration-browser.json'),JSON.stringify({status:'PASS',testedAt:new Date().toISOString(),checks:['browser project create/reload persistence','two separately owned agent registrations','two actual assigned tasks','structured handoff with task/dependency/project context','receiving device acknowledgement and live sender update','forged sender rejected','no offline queue for online-only extensions','offline disable/reconnect','mobile viewport containment']},null,2));
 console.log('PASS: real two-device browser project/assignment/handoff/ACK, sender security, reload, offline guard and recovery.');
} catch(error) {
 if(devices[0]) console.error((await devices[0].page.locator("body").innerText()).slice(0,5500));
 throw error;
} finally {
 await browser?.close();for(const d of devices){await d.host.close();await d.local.close();d.store.close();}
 if(remote?.listening){remote.closeAllConnections();await new Promise(r=>remote.close(r));}coordinator?.db.close();
 assert.equal(path.dirname(scratch),path.resolve(tmpdir()));assert.ok(path.basename(scratch).startsWith('ud-collaboration-'));fs.rmSync(scratch,{recursive:true,force:true});
}
