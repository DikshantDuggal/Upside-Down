// Full browser acceptance against real A/B services and a disposable Git workspace.
// No production mock data, trace credentials or changes to the user's source repo.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer as createCoordinator } from '../../server/index.ts';
import { LocalStore } from '../src/store.ts';
import { CoordinatorClient } from '../src/transport.ts';
import { createLocalService } from '../src/server.ts';
import { createServer as createVite } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium, expect } from '../../web/node_modules/@playwright/test/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'ud-website-'));
const source = join(scratch, 'source'), integration = join(scratch, 'integration');
const savedEnv = { UD_LOCAL_TARGET: process.env.UD_LOCAL_TARGET, UD_API_TARGET: process.env.UD_API_TARGET };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const port = Number(process.env.UD_TEST_WEB_PORT ?? 5174);
const webOrigin = `http://127.0.0.1:${port}`;
let coordinator, remote, store, local, peerStore, peer, vite, browser, page;
try {
  mkdirSync(source);
  git(source, 'init', '--quiet', '--initial-branch=source');
  git(source, 'config', 'core.autocrlf', 'false');
  git(source, 'config', 'user.name', 'Website test');
  git(source, 'config', 'user.email', 'test@localhost');
  writeFileSync(join(source, 'source.cjs'), 'module.exports = () => 1 / 0;\n');
  writeFileSync(join(source, 'check.cjs'), "process.exit(require('./source.cjs')()===1 ? 0 : 1);\n");
  git(source, 'add', 'source.cjs', 'check.cjs');
  git(source, 'commit', '--quiet', '-m', 'test fixture');
  const base = git(source, 'rev-parse', 'HEAD');
  git(source, 'worktree', 'add', '-b', 'integration', integration, base);
  coordinator = createCoordinator(join(scratch, 'coordinator.db'), { authenticate: true, sseReplay: true,
    patchCompletionMode: 'verified_application', execution: {
      runtimeDirectory: join(scratch, 'jobs'), workspaces: [
        { id: 'source', repositoryPath: source, repairTargetFile: 'source.cjs', allowedPaths: ['source.cjs'], testProfileIds: ['check'] },
        { id: 'integration', repositoryPath: integration, integrationBranch: 'integration', allowedPaths: ['source.cjs'], testProfileIds: ['check'] },
      ], testProfiles: [{ id: 'check', executable: process.execPath, args: ['check.cjs'], timeoutMs: 5000 }],
    } });
  remote = coordinator.app.listen(0, '127.0.0.1');
  await once(remote, 'listening');
  store = new LocalStore(join(scratch, 'device.db'));
  const credential = coordinator.auth.enroll(store.deviceId).token;
  const reviewer = coordinator.auth.enroll(randomUUID(), 'reviewer');
  const pairingKey = randomUUID();
  local = await createLocalService({ store, pairingKey, port: 0, allowedOrigins: [webOrigin],
    client: new CoordinatorClient(`http://127.0.0.1:${remote.address().port}`, credential),
    reviewerClient: new CoordinatorClient(`http://127.0.0.1:${remote.address().port}`, reviewer.token) });
  process.env.UD_LOCAL_TARGET = local.origin;
  process.env.UD_API_TARGET = local.origin;
  vite = await createVite({ root: join(root, 'web'), configFile: join(root, 'web/vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(webOrigin);
  await page.getByRole('button', { name: 'Pair browser', exact: true }).click();
  await page.getByLabel('Local pairing key', { exact: true }).fill(pairingKey);
  await page.getByRole('dialog').getByRole('button', { name: 'Pair browser', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Network & queue', exact: true }).click();
  await expect(page.getByText('This browser is paired. Reviewer authority was verified with the coordinator.', { exact: true })).toBeVisible();
  for (const name of ['Overview', 'Tasks', 'Agents', 'Activity', 'Patch reviews', 'Conflicts', 'Team messages', 'Network & queue']) {
    await page.getByRole('link', { name, exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
  }
  console.log('PASS: all dashboard pages, layout, pairing and automatic verified reviewer authority.');

  await page.getByRole('link', { name: 'Team messages', exact: true }).click();
  await page.route('**/local/commands', route => route.fulfill({ status: 400,
    headers: { 'Content-Type': 'application/json', 'X-UD-Contract': 'UD-IC/1.0' },
    body: JSON.stringify({ code: 'INVALID_BODY', message: 'TEST FIXTURE: definite local rejection' }) }), { times: 1 });
  await page.getByLabel('Message your team').fill('TEST FIXTURE: rejected message');
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await expect(page.getByText(/Correct the message and try again/)).toBeVisible();
  const message = `TEST FIXTURE: corrected message ${randomUUID()}`;
  await page.getByLabel('Message your team').fill(message);
  await page.getByRole('button', { name: 'Queue message', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 20000 });
  console.log('PASS: recover from definite message rejection and deliver corrected message through real A/B.');

  const title = `TEST FIXTURE: repair via website ${randomUUID()}`;
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill(title);
  await page.getByRole('button', { name: 'Queue task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByText(title, { exact: true }).click();
  await page.getByLabel('Workspace ID', { exact: true }).fill('source');
  await page.getByLabel('Test profile ID', { exact: true }).fill('check');
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect.poll(() => store.state().patches.length, { timeout: 30000 }).toBe(1);
  const task = coordinator.coordinator.listTasks().find(value => value.title === title);
  const patch = store.state().patches[0];
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Patch reviews', exact: true }).click();
  await page.getByRole('button', { name: /^Patch / }).click();
  await expect(page.getByRole('button', { name: 'Approve decision', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve decision', exact: true }).click();
  await expect.poll(() => coordinator.coordinator.getPatch(patch.id).status).toBe('approved');
  assert.equal(coordinator.coordinator.getTask(task.id).status, 'review');
  assert.equal(git(integration, 'rev-parse', 'HEAD'), base);
  await page.getByLabel('Target workspace ID', { exact: true }).fill('integration');
  await page.getByLabel('Test profile ID', { exact: true }).fill('check');
  await page.getByRole('button', { name: 'Apply approved patch', exact: true }).click();
  await expect.poll(() => coordinator.coordinator.getTask(task.id).status, { timeout: 30000 }).toBe('done');
  const verified = coordinator.coordinator.getPatch(patch.id);
  assert.equal(verified.applicationStatus, 'verified');
  assert.notEqual(git(integration, 'rev-parse', 'HEAD'), base);
  assert.ok(readFileSync(join(source, 'source.cjs'), 'utf8').includes('/ 0'));
  await expect(page.getByRole('dialog').getByText('verified', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => store.state().patches.find(value => value.id === patch.id)?.applicationStatus,
    { timeout: 10000 }).toBe('verified');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Patch / })).toBeVisible();
  await page.getByRole('button', { name: /^Patch / }).click();
  await expect(page.getByRole('dialog').getByText('verified', { exact: true })).toBeVisible({ timeout: 15000 });
  console.log('PASS: UI run, safe patch, reviewer approval, explicit apply, real passing tests and Git commit; verification survives reload.');

  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  peerStore = new LocalStore(join(scratch, 'peer.db'));
  const peerToken = coordinator.auth.enroll(peerStore.deviceId).token;
  peer = await createLocalService({ store: peerStore, pairingKey: randomUUID(), port: 0, startWorker: false,
    client: new CoordinatorClient(`http://127.0.0.1:${remote.address().port}`, peerToken) });
  const tickPeer = async () => { await peer.worker.tick(); clearTimeout(peer.worker.timer); };
  const conflictTaskId = randomUUID(), conflictTitle = `TEST FIXTURE: stale proposal ${randomUUID()}`;
  peerStore.enqueue({ type: 'task.create', payload: { clientTaskId: conflictTaskId, title: conflictTitle } }, 'test', randomUUID());
  await tickPeer();
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page.getByText(conflictTitle, { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByText(conflictTitle, { exact: true }).click();
  await page.getByLabel('Target status').selectOption('running');
  await page.getByRole('button', { name: 'Queue proposal · base r1', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('r2', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  peerStore.enqueue({ type: 'task.transition', taskId: conflictTaskId, baseRevision: 1,
    payload: { targetStatus: 'blocked', reason: 'TEST FIXTURE: stale peer proposal' } }, 'test', randomUUID());
  await tickPeer();
  await page.getByRole('link', { name: 'Conflicts', exact: true }).click();
  await expect(page.getByText(conflictTitle, { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Review conflict', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('TEST FIXTURE: retain the newer authoritative state');
  await page.getByRole('checkbox', { name: /I reviewed this resolution/ }).check();
  await page.getByRole('button', { name: 'Resolve conflict', exact: true }).click();
  await expect(page.getByText(/Resolved: keep authoritative/)).toBeVisible();
  assert.equal(coordinator.coordinator.getTask(conflictTaskId).status, 'running');
  console.log('PASS: real stale proposal from a second enrolled device is quarantined and resolved through reviewer UI.');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  coordinator.auth.revoke(reviewer.principal.id);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('link', { name: 'Network & queue', exact: true }).click();
  await expect(page.getByText('This browser is paired. Reviewer actions require a separately verified credential.', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage)).then(value =>
    [credential, reviewer.token, pairingKey].some(secret => value.includes(secret))), false);
  assert.deepEqual(errors, []);
  console.log('PASS: revoked reviewer immediately loses UI authority; no browser exceptions or stored credentials.');
} catch (error) {
  if (page) console.error('Browser failure:', await page.locator('body').innerText().catch(() => 'Unavailable'));
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  await local?.close();
  store?.close();
  await peer?.close();
  peerStore?.close();
  if (remote) { remote.closeAllConnections(); await new Promise(resolve => remote.close(resolve)); }
  await coordinator?.jobs?.shutdown();
  coordinator?.db.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert.equal(dirname(scratch), resolve(tmpdir()));
  assert.ok(basename(scratch).startsWith('ud-website-'));
  rmSync(scratch, { recursive: true, force: true });
}
