import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '../web/node_modules/@playwright/test/index.mjs';
const root = path.resolve(import.meta.dirname, '..');
const state = path.resolve(process.env.UD_ACCEPTANCE_STATE ?? path.join(process.env.LOCALAPPDATA, 'UpsideDown/final-mvp'));
const urls = JSON.parse(fs.readFileSync(path.join(state, 'launch-control.json'), 'utf8')).urls;
const source = path.join(state, 'demo-workspace/source'), integration = path.join(state, 'demo-workspace/integration');
assert.equal(JSON.parse(fs.readFileSync(path.join(state, 'demo-workspace/demo-fixture.json'), 'utf8')).kind, 'upside-down-disposable-git-fixture');
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const base = git(source, 'rev-parse', 'HEAD');
assert.equal(git(integration, 'rev-parse', 'HEAD'), base, 'This disposable fixture has already been applied. Use npm run demo:new for a fresh demo after stopping the previous stack.');
const token = fs.readFileSync(path.join(state, 'device.token'), 'utf8').trim();
const headers = { Authorization: `Bearer ${token}`, 'X-UD-Contract': 'UD-IC/1.0' };
const read = route => fetch(urls.coordinator + '/api' + route, { headers }).then(r => r.json());
const pairingKey = JSON.parse(fs.readFileSync(path.join(state, 'device.db.session.json'), 'utf8')).pairingKey;
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage();
 await page.goto(urls.web);
 await page.getByRole('button', { name: 'Pair browser', exact: true }).click();
 await page.getByLabel('Local pairing key', { exact: true }).fill(pairingKey);
 await page.getByRole('dialog').getByRole('button', { name: 'Pair browser', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('link', { name: 'Network & queue', exact: true }).click();
 await expect(page.getByText('This browser is paired. Reviewer authority was verified with the coordinator.', { exact: true })).toBeVisible();
 const existing = (await read('/tasks')).find(task => task.title.startsWith('DEMO ACCEPTANCE: actual repair ') && task.status === 'review');
 const title = existing?.title ?? `DEMO ACCEPTANCE: actual repair ${randomUUID()}`;
 if (!existing) {
   await page.getByRole('button', { name: 'New task', exact: true }).click();
   await page.getByRole('textbox', { name: 'Task title' }).fill(title);
   await page.getByRole('button', { name: 'Queue task', exact: true }).click();
   await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 await page.getByRole('link', { name: 'Tasks', exact: true }).click();
 await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });
 await page.getByText(title, { exact: true }).click();
 if (!existing) {
   await page.getByLabel('Workspace ID', { exact: true }).fill('demo-source');
   await page.getByLabel('Test profile ID', { exact: true }).fill('demo-check');
   await page.getByRole('button', { name: 'Start run', exact: true }).click();
 }
 const task = existing ?? (await read('/tasks')).find(task => task.title === title); assert.ok(task);
 await expect.poll(async () => (await read(`/tasks/${task.id}/patches`)).length, { timeout: 30000 }).toBe(1);
 const patch = (await read(`/tasks/${task.id}/patches`))[0];
 await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
 await page.getByRole('link', { name: 'Patch reviews', exact: true }).click();
 await page.getByRole('button', { name: new RegExp(`^Patch ${patch.id.slice(0, 8)}`) }).click();
 await page.getByRole('button', { name: 'Approve decision', exact: true }).click();
 await expect.poll(async () => (await read(`/patches/${patch.id}`)).status).toBe('approved');
 assert.equal((await read(`/tasks/${task.id}`)).status, 'review'); assert.equal(git(integration, 'rev-parse', 'HEAD'), base);
 await page.getByLabel('Target workspace ID', { exact: true }).fill('demo-integration');
 await page.getByLabel('Test profile ID', { exact: true }).fill('demo-check');
 await page.getByRole('button', { name: 'Apply approved patch', exact: true }).click();
 await expect.poll(async () => (await read(`/tasks/${task.id}`)).status, { timeout: 30000 }).toBe('done');
 const verified = await read(`/patches/${patch.id}`); assert.equal(verified.applicationStatus, 'verified');
 assert.equal(git(source, 'rev-parse', 'HEAD'), base); assert.notEqual(git(integration, 'rev-parse', 'HEAD'), base);
 assert.ok(fs.readFileSync(path.join(source, 'source.cjs'), 'utf8').includes('/ 0'));
 assert.ok(fs.readFileSync(path.join(integration, 'source.cjs'), 'utf8').includes('/ 1'));
 await expect(page.getByRole('dialog').getByText('verified', { exact: true })).toBeVisible({ timeout: 15000 });
 await page.screenshot({ path: path.join(root, '.board/evidence/live-verified-application.png'), fullPage: true });
 fs.writeFileSync(path.join(root, '.board/evidence/live-verified-application.json'), JSON.stringify({ status: 'PASS', testedAt: new Date().toISOString(), taskId: task.id, patchId: patch.id, applicationId: verified.applicationId, commit: git(integration, 'rev-parse', 'HEAD'), sourceUnchanged: true, approvalAloneDidNotApply: true }, null, 2));
 console.log('PASS: persistent launched app completed actual UI run/review/approval/application with real tests and an isolated Git commit.');
} finally { await browser.close(); }
