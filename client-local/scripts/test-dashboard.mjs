// Real dashboard -> paired local SQLite queue -> authenticated coordinator.
// Requires root, client-local and web dependencies plus Playwright Chromium.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer as createCoordinator } from '../../server/index.ts';
import { LocalStore } from '../src/store.ts';
import { CoordinatorClient } from '../src/transport.ts';
import { createLocalService } from '../src/server.ts';
import { createServer as createVite } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium, expect } from '../../web/node_modules/@playwright/test/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'ud-dashboard-'));
const savedEnv = { UD_LOCAL_TARGET: process.env.UD_LOCAL_TARGET, UD_API_TARGET: process.env.UD_API_TARGET };
let coordinator, remote, store, local, vite, browser;
try {
  coordinator = createCoordinator(join(scratch, 'coordinator.db'), { authenticate: true, sseReplay: true });
  remote = coordinator.app.listen(0, '127.0.0.1');
  await once(remote, 'listening');
  store = new LocalStore(join(scratch, 'device.db'));
  const credential = coordinator.auth.enroll(store.deviceId).token;
  const pairingKey = randomUUID();
  local = await createLocalService({ store, pairingKey, port: 0,
    allowedOrigins: ['http://127.0.0.1:5173'],
    client: new CoordinatorClient(`http://127.0.0.1:${remote.address().port}`, credential) });
  process.env.UD_LOCAL_TARGET = local.origin;
  process.env.UD_API_TARGET = local.origin;
  vite = await createVite({ root: resolve(root, 'web'), configFile: resolve(root, 'web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 5173, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  // No trace, screenshots, storage state or credential logging.
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Pair browser', exact: true }).click();
  await page.getByLabel('Local pairing key', { exact: true }).fill(pairingKey);
  await page.getByRole('dialog').getByRole('button', { name: 'Pair browser', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const title = `TEST FIXTURE: Joined dashboard ${randomUUID()}`;
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill(title);
  await page.getByRole('button', { name: 'Queue task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => coordinator.coordinator.listTasks().filter(task => task.title === title).length,
    { timeout: 20_000 }).toBe(1);
  await expect.poll(() => store.state().tasks.filter(task => task.title === title).length,
    { timeout: 20_000 }).toBe(1);
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  assert.equal(coordinator.coordinator.listTasks().filter(task => task.title === title).length, 1);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage)).then(value =>
    value.includes(pairingKey) || value.includes(credential)), false);
  console.log('PASS: real browser pairing, durable enqueue, authenticated A/B delivery, task display and reload without duplication or stored credentials.');
} finally {
  await browser?.close();
  await vite?.close();
  await local?.close();
  store?.close();
  if (remote) {
    remote.closeAllConnections();
    await new Promise(resolve => remote.close(resolve));
  }
  coordinator?.db.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert.equal(dirname(scratch), resolve(tmpdir()));
  assert.ok(basename(scratch).startsWith('ud-dashboard-'));
  rmSync(scratch, { recursive: true, force: true });
}
