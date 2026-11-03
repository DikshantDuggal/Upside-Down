// Bounded release verification. No background polling, source reset or fixture success fallback.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.board/evidence'); fs.mkdirSync(output, { recursive: true });
const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const checks = [
 ['root-types', ['run', 'typecheck']], ['local-types', ['--prefix', 'client-local', 'run', 'typecheck']],
 ['contracts', ['run', 'test:contract']], ['legacy-backend', ['test']],
 ['legacy-storage', ['run', 'test:sync']], ['scripted-handoffs', ['run', 'test:demo']],
 ['launch', ['run', 'test:launch']], ['local-service', ['--prefix', 'client-local', 'test']],
 ['sync-router', ['--prefix', 'server/sync', 'test']], ['official-build', ['--prefix', 'web', 'run', 'build']],
 ['official-unit', ['--prefix', 'web', 'test']], ['environment', ['run', 'test:env']], ['collaboration-browser', ['run', 'test:collaboration-browser']],
];
const results = { verifiedAt: new Date().toISOString(), node: process.version,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeWasClean: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() === '', checks: [] };
for (const [name, args] of checks) {
 const started = Date.now();
 const run = spawnSync(process.execPath, [npm, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 12 * 1024 * 1024 });
 const log = (run.stdout ?? '') + (run.stderr ?? '') + (run.error ? '\n' + run.error.message : '');
 fs.writeFileSync(path.join(output, name + '.log'), log);
 results.checks.push({ name, command: 'npm ' + args.join(' '), status: run.status === 0 ? 'PASS' : 'FAIL', exitCode: run.status, durationMs: Date.now() - started, log: '.board/evidence/' + name + '.log' });
 fs.writeFileSync(path.join(output, 'release-checks.json'), JSON.stringify(results, null, 2));
 console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} ${name} (${((Date.now() - started)/1000).toFixed(1)}s)`);
 if (run.status !== 0) console.log(log.slice(-3500));
}
process.exitCode = results.checks.every(check => check.status === 'PASS') ? 0 : 1;
