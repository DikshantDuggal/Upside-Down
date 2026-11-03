// A fresh managed demo state is the reset mechanism. Previous records are retained.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const state = path.join(process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? process.cwd(), 'UpsideDown', 'demos', `demo-${Date.now()}-${randomUUID().slice(0,8)}`);
console.log(`New disposable demo state: ${state}. Stop the prior managed stack first; no prior data will be deleted.`);
process.argv = [process.execPath, new URL('./dev-all.mjs', import.meta.url).pathname, '--state-dir', state, '--coordinator-port', '4001', '--reviewer', '--demo-workspace', '--open'];
await import('./dev-all.mjs');
