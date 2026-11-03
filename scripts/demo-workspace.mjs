import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export function demoWorkspace(state) {
  const parent = path.join(state, 'demo-workspace'), source = path.join(parent, 'source'), integration = path.join(parent, 'integration'), marker = path.join(parent, 'demo-fixture.json');
  const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(source, { recursive: true });
    git(source, ['init', '--quiet', '--initial-branch=demo-source']);
    git(source, ['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(path.join(source, 'source.cjs'), 'module.exports = () => 1 / 0;\n');
    fs.writeFileSync(path.join(source, 'check.cjs'), "process.exit(require('./source.cjs')()===1 ? 0 : 1);\n");
    git(source, ['add', 'source.cjs', 'check.cjs']);
    git(source, ['-c', 'user.name=Upside-Down Disposable Demo', '-c', 'user.email=demo@localhost', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Disposable failing repair fixture']);
    git(source, ['worktree', 'add', '-b', 'demo-integration', integration, 'HEAD']);
    fs.writeFileSync(marker, JSON.stringify({ kind: 'upside-down-disposable-git-fixture', source, integration }), { flag: 'wx' });
  }
  if (!fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker, 'utf8')).kind !== 'upside-down-disposable-git-fixture') throw new Error('Demo workspace is not a registered disposable fixture. It was left untouched.');
  const configuration = { runtimeDirectory: path.join(parent, 'runs'), workspaces: [
    { id: 'demo-source', repositoryPath: source, repairTargetFile: 'source.cjs', allowedPaths: ['source.cjs'], testProfileIds: ['demo-check'] },
    { id: 'demo-integration', repositoryPath: integration, integrationBranch: 'demo-integration', allowedPaths: ['source.cjs'], testProfileIds: ['demo-check'] } ],
    testProfiles: [{ id: 'demo-check', executable: process.execPath, args: ['check.cjs'], timeoutMs: 5000 }] };
  const file = path.join(parent, 'workspaces.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(configuration, null, 2), { flag: 'wx', mode: 0o600 });
  return file;
}
