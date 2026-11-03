import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
const flag = process.argv.indexOf('--state-dir');
const state = path.resolve(flag >= 0 ? process.argv[flag + 1] : path.join(process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? process.cwd(), 'UpsideDown', 'final-mvp'));
const file = path.join(state, 'launch-control.json');
if (!fs.existsSync(file)) throw new Error('No managed launcher found in this state directory. No processes were stopped.');
const control = JSON.parse(fs.readFileSync(file, 'utf8'));
if (control.kind !== 'upside-down-launch-control' || !/^[a-f0-9]{64}$/.test(control.token)) throw new Error('Invalid private launch control record.');
await new Promise((resolve, reject) => {
  const socket = net.connect(control.pipe);
  let acknowledged = false;
  socket.on('data', chunk => { acknowledged ||= chunk.toString().includes('stopping'); });
  socket.setTimeout(5000, () => socket.destroy(new Error('Managed launcher did not respond.')));
  socket.once('connect', () => socket.end(JSON.stringify({ token: control.token, command: 'stop' }) + '\n'));
  socket.once('error', reject); socket.once('close', () => acknowledged ? resolve() : reject(new Error('Managed launcher did not acknowledge shutdown.')));
});
console.log('Graceful shutdown requested for this managed launch. Persistent data retained.');
