// Live authenticated GitHub browser test. Only dedicated test coordinator issue15.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '../web/node_modules/@playwright/test/index.mjs';
const root=path.resolve(import.meta.dirname,'..'),origin='http://127.0.0.1:5180';
let key='',browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 if(new URL(page.url()).origin!==origin)throw new Error('Unexpected browser origin; no key loaded');
 await page.getByRole('button',{name:'Agent Communication Center',exact:true}).click();
 const directory=process.env.UD_GITHUB_STATE_DIR??path.join(process.env.LOCALAPPDATA??process.env.XDG_STATE_HOME??root,'UpsideDown','github-coordination');key=fs.readFileSync(path.join(directory,'dashboard.key'),'utf8').trim();
 await page.getByLabel('GitHub dashboard key',{exact:true}).fill(key);await page.getByRole('button',{name:'Pair GitHub dashboard',exact:true}).click();
 await expect(page.getByText('@DikshantDuggal',{exact:true}).first()).toBeVisible({timeout:30000});
 await expect(page.getByRole('link',{name:'Coordinator issue #15',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'GitHub comment #6619062067',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Manual agent prompt',exact:true}).first().click();await expect(page.getByRole('heading',{name:'MANUAL agent prompt',exact:true})).toBeVisible();
 let interrupted=false;await page.route('**/api/github/send',async route=>{if(!interrupted){interrupted=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 const text='LIVE-BROWSER-TEST '+new Date().toISOString()+': host GitHub message and retry acceptance; no AI execution claimed.';
 await page.getByLabel('Message type',{exact:true}).selectOption('HOST_MESSAGE');await page.getByLabel('Task',{exact:true}).selectOption('');await page.getByLabel('Recipient',{exact:true}).selectOption('all');await page.getByLabel('Validated payload (JSON)',{exact:true}).fill(JSON.stringify({text}));await page.getByRole('button',{name:'Post GitHub message',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry original saved message',exact:true})).toBeVisible({timeout:65000});
 await page.getByRole('button',{name:'Retry original saved message',exact:true}).click();await expect(page.getByRole('button',{name:'Retry original saved message',exact:true})).toHaveCount(0,{timeout:65000});await expect(page.getByText(text,{exact:true})).toBeVisible({timeout:65000});
 await page.unroute('**/api/github/send');
 const snapshot=await page.evaluate(async()=>{const response=await fetch('/api/github/state?repo=DikshantDuggal%2FUpside-Down&projectId=phase5-acceptance-20261104');return response.json();});
 const matches=snapshot.messages.filter(m=>m.payload.text===text);assert.equal(matches.length,1);assert.equal(matches[0].author,'DikshantDuggal');
 await page.screenshot({path:path.join(root,'.board/phase5/ui-live.png'),fullPage:true});await page.reload();await page.getByRole('button',{name:'Agent Communication Center',exact:true}).click();await expect(page.getByText(text,{exact:true})).toBeVisible({timeout:30000});
 const storage=await page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage}));assert.ok(!storage.includes(key));assert.ok(!storage.includes('csrfToken'));assert.deepEqual(errors,[]);
 const other=await browser.newContext();const anonymous=await other.request.get(origin+'/api/github/workspaces');assert.equal(anonymous.status(),401);
 fs.writeFileSync(path.join(root,'.board/phase5/browser-acceptance.json'),JSON.stringify({status:'PASS',verifiedAt:new Date().toISOString(),githubAuthor:'DikshantDuggal',coordinatorIssue:15,messageId:matches[0].id,commentId:matches[0].sourceId,url:matches[0].url,checks:['actual protected dashboard pairing','GitHub-backed task board and source timeline','actual manual prompt export','actual host message accepted by GitHub despite interrupted browser response','retry reconciled original ID with one remote accepted message','refresh preserves message and session','no stored pairing or CSRF credentials','anonymous read rejected','zero browser runtime errors'],scope:'One real GitHub account; other identities are not impersonated.'},null,2));console.log('PASS: real GitHub dashboard, posting/retry, reload and credential isolation. Comment #'+matches[0].sourceId);
}catch(error){throw new Error((error?.message??String(error)).replaceAll(key||'__no_key__','[REDACTED]'));}finally{await browser?.close();}
