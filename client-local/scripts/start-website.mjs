// Local development stack; all three services bind to loopback.
import { createServer as createCoordinator } from '../../server/index.ts';
import { LocalStore } from '../src/store.ts';
import { CoordinatorClient } from '../src/transport.ts';
import { createLocalService } from '../src/server.ts';
import { createServer as createVite } from '../../web/node_modules/vite/dist/node/index.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(process.env.UD_WEBSITE_DATA ?? join(root, '.board/website-runtime'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (process.platform === 'win32') {
  execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r',
    `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe' });
}
const privateJson = (name, create) => {
  const file = join(directory, name);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(create()), { flag: 'wx', mode: 0o600 });
  return JSON.parse(readFileSync(file, 'utf8'));
};
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be 1..65535`);
  return value;
};
const apiPort = port('PORT', 4000), localPort = port('UD_LOCAL_PORT', 4100), webPort = port('UD_WEB_PORT', 5173);
const webOrigin = `http://127.0.0.1:${webPort}`;
let coordinator, remote, store, local, vite;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await vite?.close();
  await local?.close();
  store?.close();
  if (remote) {
    remote.closeAllConnections();
    await new Promise(resolve => remote.close(resolve));
  }
  await coordinator?.jobs?.shutdown();
  coordinator?.db.close();
}
try {
  coordinator = createCoordinator(join(directory, 'coordinator.db'), { authenticate: true, sseReplay: true,
    patchCompletionMode: 'verified_application',
    ...(process.env.UD_WORKSPACE_CONFIG ? { execution: JSON.parse(readFileSync(process.env.UD_WORKSPACE_CONFIG, 'utf8')) } : {}) });
  remote = coordinator.app.listen(apiPort, '127.0.0.1');
  await once(remote, 'listening');
  store = new LocalStore(join(directory, 'device.db'));
  const device = privateJson('device-credential.json', () => coordinator.auth.enroll(store.deviceId));
  const principal = coordinator.auth.authenticate(device.token);
  if (principal.deviceId !== store.deviceId || principal.role !== 'device') throw new Error('Stored credential does not match this local device');
  const reviewer = process.argv.includes('--reviewer')
    ? privateJson('reviewer-credential.json', () => coordinator.auth.enroll(randomUUID(), 'reviewer')) : undefined;
  const { pairingKey } = privateJson('device.db.session.json', () => ({ pairingKey: randomBytes(32).toString('hex') }));
  local = await createLocalService({ store, pairingKey, port: localPort, allowedOrigins: [webOrigin],
    client: new CoordinatorClient(`http://127.0.0.1:${apiPort}`, device.token),
    reviewerClient: reviewer ? new CoordinatorClient(`http://127.0.0.1:${apiPort}`, reviewer.token) : undefined });
  process.env.UD_LOCAL_TARGET = local.origin;
  process.env.UD_API_TARGET = local.origin;
  vite = await createVite({ root: join(root, 'web'), configFile: join(root, 'web/vite.config.ts'),
    server: { host: '127.0.0.1', port: webPort, strictPort: true } });
  await coordinator.jobs?.recover();
  coordinator.jobs?.kick();
  await vite.listen();
  writeFileSync(join(directory, 'runtime.json'), JSON.stringify({ pid: process.pid, web: webOrigin, local: local.origin,
    coordinator: `http://127.0.0.1:${apiPort}` }), { mode: 0o600 });
  console.log(`Website ready: ${webOrigin}`);
  console.log(`Pair browser using the key in ${join(directory, 'device.db.session.json')}`);
  console.log(`Persistent local data: ${directory}. Reviewer credential: ${reviewer ? 'configured' : 'not enabled'}.`);
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
} catch (error) {
  console.error('Website startup failed:', error instanceof Error ? error.message : 'Unknown failure');
  await close();
  process.exitCode = 1;
}
