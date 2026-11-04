import { useEffect, useState } from "react";
import "./GitHubCommunication.css";

type Snapshot = {
  workspace: { repo: string; projectId: string; name: string; host: { login: string; id: number }; members: { login: string; role: string; tool: string }[] };
  coordinatorIssue: number;
  tasks: { id: string; title: string; assignee: string; branch: string; issue: number; assignmentId: string; status: string; progress: number; submission?: { id: string }; discoveredPrs?: { number: number; url: string; headSha: string }[]; pr?: { number: number; url: string; headSha: string; ci: string; valid: boolean; problems: string[]; checks: { name: string; status: string; conclusion: string }[] } }[];
  agents: { login: string; role: string; tool: string; status: string }[];
  handoffs: { id: string; taskId: string; sender: string; recipient: string; status: string; text: string; deadline?: string; response?: string; responseId?: string; hostApproved?: boolean }[];
  messages: { id: string; type: string; taskId: string | null; sender: string; recipient: string; createdAt: string; sourceId: number; url: string; payload: Record<string, unknown> }[];
  audit: { sourceId: number; decision: string; reason: string }[];
  removedSourceIds: number[]; cursor: string; refreshedAt: string;
};
let csrf = "";
async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/github/" + route, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(65000), headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? "GitHub request failed"), { status: response.status, retryAt: data.retryAt });
  return data;
}
export function GitHubCommunicationCenter({ projectId }: { projectId?: string }) {
  const [user, setUser] = useState<{ login: string; id: number }>();
  const [data, setData] = useState<Snapshot>();
  const [repo, setRepo] = useState("DikshantDuggal/Upside-Down");
  const [project, setProject] = useState(projectId ?? "");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [issue, setIssue] = useState("");
  const [members, setMembers] = useState('[{"login":"DikshantDuggal","role":"backend","tool":"codex"},{"login":"ArhaanArora","role":"frontend","tool":"claude-code"}]');
  const [checks, setChecks] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [task, setTask] = useState("");
  const [type, setType] = useState("HOST_MESSAGE");
  const [to, setTo] = useState("all");
  const [payload, setPayload] = useState('{"text":"Please report current status."}');
  const [correlation, setCorrelation] = useState("");
  const [pending, setPending] = useState(false);
  const activeRepo=data?.workspace.repo??repo, activeProject=data?.workspace.projectId??project;
  const isHost = user?.id === data?.workspace.host.id;
  const pendingKey = "upside-down:github:pending:v2:" + user?.login;
  async function run(fn: () => Promise<unknown>, message: string) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try { await fn(); setNotice(message); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); } finally { setBusy(false); }
  }
  async function restore() {
    const session = await api<{ csrfToken: string; user: { login: string; id: number } }>("session");
    csrf = session.csrfToken; setUser(session.user);
    const list = await api<{ workspaces: { workspace: Snapshot["workspace"]; issue: number }[] }>("workspaces");
    const found = list.workspaces.find(w => w.workspace.projectId === projectId) ?? list.workspaces[0];
    if (found) { setRepo(found.workspace.repo); setProject(found.workspace.projectId); try { setData(await api<Snapshot>("state?" + new URLSearchParams({ repo: found.workspace.repo, projectId: found.workspace.projectId }))); } catch { /* Explicit sync rebuilds history. */ } }
  }
  useEffect(() => { void restore().catch(e => { if (e.status !== 401) setError(e.message); }); }, []);
  useEffect(() => { if (projectId) setProject(projectId); }, [projectId]);
  useEffect(() => { if (user) setPending(!!localStorage.getItem(pendingKey)); }, [user, pendingKey]);
  async function sync() { setData(await api<Snapshot>("sync", { repo:activeRepo, projectId:activeProject })); }
  async function post() {
    const input = { repo:activeRepo, projectId:activeProject, taskId: task || null, type, recipient: to, payload: JSON.parse(payload), ...(correlation ? { correlationId: correlation } : {}) };
    const old = localStorage.getItem(pendingKey); let record = old ? JSON.parse(old) : null;
    if (record && JSON.stringify(record.input) !== JSON.stringify(input)) throw new Error("Earlier outcome unknown. Retry original saved message before changing content.");
    record ??= { input, request: { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() } };
    localStorage.setItem(pendingKey, JSON.stringify(record)); setPending(true);
    try { await api("send", record.request); localStorage.removeItem(pendingKey); setPending(false); await sync(); }
    catch (e) { const f = e as { status?: number; retryAt?: number }; if (f.status && f.status >= 400 && f.status < 500 && ![408, 429].includes(f.status) && !f.retryAt) { localStorage.removeItem(pendingKey); setPending(false); } throw e; }
  }
  function compose(nextType: string, id: string, recipient: string, body: Record<string, unknown>, corr = "") { setType(nextType); setTask(id); setTo(recipient); setPayload(JSON.stringify(body, null, 2)); setCorrelation(corr); }
  const button = (label: string, fn: () => void, disabled = false) => <button type="button" className="button secondary small" disabled={busy || disabled} onClick={fn}>{label}</button>;
  return <section aria-label="Agent communication center" className="tab-pane github-communication">
    <div className="section-head"><div><h2>Agent Communication Center</h2><p>GitHub Issues/comments are authoritative. Coding assistants use manual or CLI bridges.</p></div>{button("Refresh from GitHub", () => void run(sync, "Verified GitHub history synchronized."), !user || !project)}{user&&button("Reauthorize dashboard",()=>setUser(undefined))}</div>
    {error && <div className="notice" role="alert">{error} The last successful snapshot/checkpoint is retained.</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!user ? <form className="panel form-stack" onSubmit={e => { e.preventDefault(); void run(async () => { const s = await api<{ csrfToken: string; user: { login: string; id: number } }>("session", { pairingKey: key }); csrf = s.csrfToken; setUser(s.user); setKey(""); await restore(); }, "GitHub dashboard paired."); }}><h3>Authorize host dashboard</h3><p>GitHub credentials stay in the server CLI. Use the protected key in <code>%LOCALAPPDATA%/UpsideDown/github-coordination/dashboard.key</code>. Never paste it into GitHub.</p><label>GitHub dashboard key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} required /></label><button className="button primary" disabled={busy}>Pair GitHub dashboard</button></form> : <>
      <div className="notice">Authenticated GitHub account: <strong>@{user.login}</strong>. Presence is a verified GitHub report, not proof of a running IDE or AI.</div>
      <details className="panel"><summary>Connect repository or attach existing mission</summary><div className="form-stack" style={{marginTop:14}}>
        <label>Repository<input value={repo} onChange={e=>setRepo(e.target.value)}/></label><label>Project ID<input value={project} onChange={e=>setProject(e.target.value)}/></label><label>Developers (JSON: login, role, tool)<textarea rows={4} value={members} onChange={e=>setMembers(e.target.value)}/></label><label>Required CI check names<input value={checks} onChange={e=>setChecks(e.target.value)} placeholder="tests, typecheck"/></label><label>Optional workflow file<input value={workflow} onChange={e=>setWorkflow(e.target.value)} placeholder="ci.yml"/></label>
        {button('Connect repository and start GitHub mission',()=>void run(async()=>setData(await api<Snapshot>('connect',{repo,projectId:project,members:JSON.parse(members),requiredChecks:checks.split(',').map(v=>v.trim()).filter(Boolean),...(workflow?{workflow}:{})})),'Real coordinator/task issues created or reconciled. Await developer ACKs.'))}
        <label>Existing coordination issue number<input value={issue} onChange={e=>setIssue(e.target.value)}/></label>{button('Attach coordination issue',()=>void run(async()=>{const next=await api<Snapshot>('attach',{repo,issue:Number(issue)});setData(next);setProject(next.workspace.projectId);},'Workspace reconstructed from GitHub.'))}
      </div></details>
      {data && <>
        <p><a href={`https://github.com/${data.workspace.repo}/issues/${data.coordinatorIssue}`} target="_blank" rel="noreferrer">Coordinator issue #{data.coordinatorIssue}</a> · Last verified read {new Date(data.refreshedAt).toLocaleString()} · Cursor {data.cursor}</p>
        <p className="small muted">Refresh is explicit. No recurring monitor or automatic task execution is enabled.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>{data.agents.map(a => <article key={a.login} className="panel"><h3>@{a.login}</h3><p>{a.role} · {a.tool}</p><span className="badge">{a.status.replaceAll("_", " ")}</span></article>)}</div>
        <h3>GitHub task board</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12}}>{data.tasks.map(item=><article className="panel" key={item.id}><h3>{item.title}</h3><p><strong>@{item.assignee}</strong> · {item.status} · {item.progress}%</p><code style={{overflowWrap:'anywhere'}}>{item.branch}</code><p><a href={`https://github.com/${data.workspace.repo}/issues/${item.issue}`} target="_blank" rel="noreferrer">View GitHub issue #{item.issue}</a></p><div className="action-row">
          {button('Manual agent prompt',()=>void run(async()=>{const result=await api<{prompt:string}>('prompt?'+new URLSearchParams({repo:activeRepo,projectId:activeProject,taskId:item.id}));setPrompt(result.prompt);},'Prompt ready. Execution requires developer approval.'))}
          {user.login.toLowerCase()===item.assignee.toLowerCase()&&<>{button('Acknowledge task',()=>compose('TASK_ACK',item.id,data.workspace.host.login,{assignmentId:item.assignmentId,text:'Assignment received.'}),item.status!=='awaiting_ack')}{button('Report started',()=>compose('TASK_STARTED',item.id,data.workspace.host.login,{assignmentId:item.assignmentId,text:'Developer approved starting this task.'}))}{button('Report progress',()=>compose('TASK_PROGRESS',item.id,data.workspace.host.login,{assignmentId:item.assignmentId,progress:item.progress,text:'Progress report.'}))}{button('Report blocker',()=>compose('TASK_BLOCKED',item.id,data.workspace.host.login,{assignmentId:item.assignmentId,text:'Describe the blocker.'}))}{button('Submit actual PR',()=>compose('TASK_COMPLETED',item.id,data.workspace.host.login,{assignmentId:item.assignmentId,branch:item.branch,text:'Add prNumber and the full actual commitHash to this payload. No success is assumed.'}))}</>}
          {isHost&&<>{button('Request status',()=>compose('HOST_MESSAGE',item.id,item.assignee,{text:'Please report status.',action:'request_status'}))}{button('Resolve blocker',()=>compose('HOST_MESSAGE',item.id,item.assignee,{text:'Host cleared blocker; please resume explicitly.',action:'resolve_blocker'}))}{button('Reassign task',()=>compose('TASK_ASSIGNMENT',item.id,item.assignee,{assignee:item.assignee,branch:item.branch,issue:item.issue,reason:'Explicit host reassignment'}))}</>}
        </div>{item.pr&&<div style={{marginTop:14}}><a href={item.pr.url} target="_blank" rel="noreferrer">PR #{item.pr.number}</a><p>CI: {item.pr.ci} · policy: {item.pr.valid?'verified':'not verified'}</p><ul>{item.pr.problems.map(problem=><li key={problem}>{problem}</li>)}</ul>{item.pr.checks.map((check,i)=><div key={i}>{check.name}: {check.status} / {check.conclusion??'pending'}</div>)}{isHost&&<div className="action-row">{button('Start integration checks',()=>void run(()=>api('checks',{repo:activeRepo,projectId:activeProject,taskId:item.id}),'GitHub Actions workflow dispatched; no success assumed.'))}{button('Approve verified submission',()=>compose('HOST_APPROVAL',item.id,item.assignee,{prNumber:item.pr!.number,expectedHeadSha:item.pr!.headSha,text:'Approve this exact verified submission.'},item.submission?.id),!item.pr.valid||item.pr.ci!=='passed')}{button('Request revision',()=>compose('HOST_REJECTION',item.id,item.assignee,{text:'Describe required revision.'},item.submission?.id))}</div>}</div>}</article>)}</div>
        <section aria-label="Discovered task pull requests">{data.tasks.flatMap(t=>(t.discoveredPrs??[]).map(pr=><p key={t.id+pr.number}><a href={pr.url} target="_blank" rel="noreferrer">Discovered PR #{pr.number}</a> for {t.title} · Matching author/branch; submission and CI review still required.</p>))}</section><h3>Dependency handoffs</h3>{data.handoffs.length?data.handoffs.map(h=><article className="panel" key={h.id}><strong>@{h.sender} → @{h.recipient}</strong><p>{h.text}</p><span className="badge">{h.status}</span>{h.deadline&&<p>Deadline: {h.deadline}{h.status==='pending'&&Date.parse(h.deadline)<Date.now()?' — ACK overdue; host intervention required':''}</p>}{h.response&&<pre style={{whiteSpace:'pre-wrap'}}>{h.response}</pre>}<div className="action-row">{user.login===h.recipient&&<>{button('ACK handoff',()=>compose('HANDOFF_ACK',h.taskId,h.sender,{text:'Request received.'},h.id),h.status!=='pending')}{button('Respond with contract',()=>compose('HANDOFF_RESPONSE',h.taskId,h.sender,{text:'Provide the implementation contract.',contract:'Replace with the actual shared contract.'},h.id))}</>}{isHost&&h.responseId&&button(h.hostApproved?'Handoff approved':'Approve handoff',()=>compose('HOST_APPROVAL',h.taskId,h.sender,{text:'Host approved the shared handoff contract.'},h.responseId),!!h.hostApproved)}{user.login===h.sender&&button('Complete handoff',()=>compose('HANDOFF_COMPLETED',h.taskId,h.recipient,{text:'Contract received and reconciled.'},h.id),h.status!=='responded')}</div></article>):<p className="muted">No recorded handoffs. Compose HANDOFF_REQUEST from your own task, with targetTaskId and text, addressed to the other task owner.</p>}
        <section className="panel" style={{marginTop:20}}><h3>Post a traceable GitHub message</h3><form className="form-stack" onSubmit={e=>{e.preventDefault();void run(post,'Message posted/reconciled on GitHub.');}}>
          <label>Message type<select aria-label="Message type" value={type} onChange={e=>setType(e.target.value)}>{['AGENT_REGISTER','AGENT_READY','TASK_ASSIGNMENT','TASK_ACK','TASK_STARTED','TASK_PROGRESS','TASK_BLOCKED','TASK_COMPLETED','TASK_FAILED','HANDOFF_REQUEST','HANDOFF_ACK','HANDOFF_RESPONSE','HANDOFF_COMPLETED','CONTRACT_UPDATE','CONTRACT_ACK','INTEGRATION_REQUEST','INTEGRATION_RESULT','HOST_MESSAGE','HOST_APPROVAL','HOST_REJECTION','AGENT_DISCONNECT','AGENT_RECONNECT'].map(value=><option key={value}>{value}</option>)}</select></label>
          <label>Task<select aria-label="Task" value={task} onChange={e=>setTask(e.target.value)}><option value="">Project message</option>{data.tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><label>Recipient<select aria-label="Recipient" value={to} onChange={e=>setTo(e.target.value)}><option value="all">all</option><option value="host">host</option>{data.workspace.members.map(m=><option key={m.login} value={m.login}>{m.login}</option>)}</select></label><label>Correlation message UUID<input value={correlation} onChange={e=>setCorrelation(e.target.value)}/></label><label>Validated payload (JSON)<textarea aria-label="Validated payload (JSON)" rows={7} value={payload} onChange={e=>setPayload(e.target.value)}/></label><p className="small muted">Actual sender is @{user.login}. Ownership checks run before posting. Comments never execute code.</p><button className="button primary" disabled={busy}>Post GitHub message</button>
        </form>{pending&&button('Retry original saved message',()=>void run(async()=>{const record=JSON.parse(localStorage.getItem(pendingKey)??'null');if(!record)throw new Error('No pending message');await api('send',record.request);localStorage.removeItem(pendingKey);setPending(false);await sync();},'Original delivery reconciled without a new message ID.'))}</section>
        <h3>Verified GitHub message timeline</h3>{[...data.messages].reverse().map(m => <article className="panel" key={m.id}><strong>{m.type} · @{m.sender} → {m.recipient}</strong><p style={{ whiteSpace: "pre-wrap" }}>{String(m.payload.text ?? m.payload.reason ?? "")}</p><small>{new Date(m.createdAt).toLocaleString()} · {m.id}</small><p><a href={m.url} target="_blank" rel="noreferrer">GitHub comment #{m.sourceId}</a></p></article>)}
        <details className="panel"><summary>Validation audit / quarantined messages</summary>{data.audit.filter(a => a.decision !== "accepted").map((a, i) => <p key={i}>#{a.sourceId}: {a.decision} — {a.reason}</p>)}{data.removedSourceIds.map(id => <p key={id}>#{id}: source deleted; state rebuilt from current GitHub evidence.</p>)}</details>
      </>}
      {prompt && <section className="panel"><h3>MANUAL agent prompt</h3>{button("Copy manual prompt", () => void run(() => navigator.clipboard.writeText(prompt), "Manual prompt copied. Developer approval is required before execution."))}<pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 500, overflow: "auto" }}>{prompt}</pre></section>}
    </>}
  </section>;
}
