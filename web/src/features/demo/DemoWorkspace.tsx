import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FileText,
  FolderLock,
  GitBranch,
  Laptop,
  Layers3,
  Network,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import architecture from "./fixtures/ARCHITECTURE.md?raw";
import contract from "./fixtures/CONTRACT.md?raw";
import {
  context,
  DEMO_PROBLEM,
  pipeline,
  rolePrompt,
  roles,
  type RoleId,
} from "./data";
import "./demo.css";

type DemoPage = "studio" | "prompts" | "learn";
type Saved = {
  idea: string;
  generated: boolean;
  assigned: boolean;
  tools: Record<string, string>;
};
const KEY = "upside-down-demo-v1";
function readSaved(): Saved {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (value && typeof value.idea === "string")
      return {
        idea: value.idea,
        generated: value.generated === true,
        assigned: value.assigned === true,
        tools:
          value.tools && typeof value.tools === "object" ? value.tools : {},
      };
  } catch {
    /* storage is optional for the demo */
  }
  return { idea: DEMO_PROBLEM, generated: false, assigned: false, tools: {} };
}
function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DemoEntry() {
  return (
    <a className="demo-entry" href="#studio">
      <span className="demo-entry-icon">
        <Sparkles size={24} />
      </span>
      <div>
        <span className="demo-kicker">THE HACKATHON STUDIO · DEMO</span>
        <h2>One idea. Four laptops. A shared direction.</h2>
        <p>
          Turn a problem into a visual plan and ready-to-share agent prompts.
        </p>
      </div>
      <span className="demo-entry-cta">
        Open studio <ArrowRight size={18} />
      </span>
    </a>
  );
}
export function DemoWorkspace({ page }: { page: DemoPage }) {
  const [saved, setSaved] = useState(readSaved);
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(-1);
  const [node, setNode] = useState<RoleId>("P1");
  const [document, setDocument] = useState<
    "architecture" | "contract" | "context" | null
  >(null);
  const [view, setView] = useState(
    () =>
      new URLSearchParams(window.location.hash.split("?")[1]).get("device") ||
      "host",
  );
  const [promptId, setPromptId] = useState<RoleId>("P1");
  const [copied, setCopied] = useState("");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [pitch, setPitch] = useState(false);
  const [quiz, setQuiz] = useState("");
  const [assigning, setAssigning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const documentPanel = useRef<HTMLElement>(null);
  const role = roles.find((r) => r.id === node)!;
  const selected =
    roles.find((r) => r.id === (view === "host" ? promptId : view)) || roles[0];
  const generating = progress >= 0 && progress < 5;
  const visibleRoles =
    view === "host" ? roles : roles.filter((r) => r.id === selected.id);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* keep working in memory */
    }
  }, [saved]);
  useEffect(() => {
    if (document)
      documentPanel.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
  }, [document]);
  useEffect(() => {
    const update = () => {
      const device = new URLSearchParams(
        window.location.hash.split("?")[1],
      ).get("device");
      if (device && roles.some((r) => r.id === device)) {
        setView(device);
        setSaved((s) => ({ ...s, generated: true }));
      }
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!generating) return;
    const timer = setTimeout(() => {
      if (progress === 4)
        setSaved((s) => ({ ...s, generated: true, assigned: false }));
      setProgress((p) => p + 1);
    }, 620);
    return () => clearTimeout(timer);
  }, [progress, generating]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setStep((s) => (s + 1) % pipeline.length),
      2400,
    );
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!assigning) return;
    const timer = setTimeout(() => {
      setSaved((s) => ({ ...s, assigned: true }));
      setAssigning(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [assigning]);
  function selectFiles(list: FileList | null) {
    if (!list) return;
    const accepted = Array.from(list).filter((f) =>
      /\.(pdf|md)$/i.test(f.name),
    );
    setError(
      accepted.length < list.length
        ? "Choose PDF or Markdown (.md) files for this demo."
        : "",
    );
    setFiles((previous) =>
      [
        ...previous,
        ...accepted.map((f) => ({ name: f.name, size: f.size })),
      ].slice(0, 8),
    );
  }
  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setError("Clipboard unavailable. Use the Markdown download instead.");
    }
  }
  function reset() {
    setSaved({
      idea: DEMO_PROBLEM,
      generated: false,
      assigned: false,
      tools: {},
    });
    setFiles([]);
    setProgress(-1);
    setDocument(null);
    setView("host");
    setStep(0);
    setPlaying(false);
    setAssigning(false);
    setError("");
    window.location.hash = "studio";
  }
  const buildSteps = [
    "Reading the reference brief",
    "Mapping four ownership boundaries",
    "Linking the shared contract",
    "Preparing laptop prompts",
    "Packaging the handoff",
  ];
  return (
    <div className="demo-workspace">
      <div className="demo-toolbar">
        <span className="demo-pill">
          <span /> Scripted demo
        </span>
        <span>AgentSync / reference project 01</span>
        <button className="demo-text-button" onClick={reset}>
          <RotateCcw size={14} /> Reset walkthrough
        </button>
      </div>
      <nav className="demo-steps" aria-label="Demo workflow">
        {(
          [
            {
              id: "studio",
              title: "Shape the idea",
              detail: "Brief + architecture",
            },
            {
              id: "prompts",
              title: "Divide the work",
              detail: "Four laptop handoffs",
            },
            {
              id: "learn",
              title: "Understand the build",
              detail: "Visual learning",
            },
          ] as const
        ).map((item, i) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={page === item.id ? "current" : ""}
            aria-current={page === item.id ? "step" : undefined}
          >
            <span className="demo-step-number">{i + 1}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
            <ChevronRight size={17} />
          </a>
        ))}
      </nav>
      {error && (
        <p className="demo-error" role="alert">
          {error}
        </p>
      )}
      {page === "studio" && (
        <>
          <section className="demo-hero">
            <div className="demo-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
              <Network size={42} />
            </div>
            <div className="demo-kicker">
              FROM A SHARED IDEA TO A SHARED PLAN
            </div>
            <h2>
              Your next big idea,
              <br />
              <em>everyone on the same page.</em>
            </h2>
            <p>
              A problem becomes an architecture. An architecture becomes four
              clear assignments. Your team stays in sync.
            </p>
            <div className="demo-hero-tags">
              <span>01 shared vision</span>
              <span>04 laptop roles</span>
              <span>01 source of truth</span>
            </div>
          </section>
          <div className="demo-intake-grid">
            <section className="demo-panel">
              <div className="demo-panel-title">
                <span className="demo-square">
                  <FileText size={19} />
                </span>
                <div>
                  <h3>Start with the problem</h3>
                  <p>Write it down or bring your brief.</p>
                </div>
                <span className="demo-tiny-label">STEP 01</span>
              </div>
              <label htmlFor="demo-idea">Your idea / problem statement</label>
              <textarea
                id="demo-idea"
                value={saved.idea}
                onChange={(e) =>
                  setSaved((s) => ({ ...s, idea: e.target.value }))
                }
                rows={4}
              />
              <div
                className={`demo-drop ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  selectFiles(e.dataTransfer.files);
                }}
              >
                <Upload size={24} />
                <strong>Drop your brief here</strong>
                <span>PDF or Markdown · up to 8 files</span>
                <button
                  className="button secondary"
                  onClick={() => input.current?.click()}
                >
                  Browse files <ArrowRight size={14} />
                </button>
                <input
                  ref={input}
                  className="sr-only"
                  aria-label="Upload problem files"
                  type="file"
                  accept=".pdf,.md"
                  multiple
                  onChange={(e) => {
                    selectFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {files.length > 0 && (
                <ul className="demo-file-list">
                  {files.map((file, i) => (
                    <li key={`${file.name}-${i}`}>
                      <FileText size={16} />
                      <span>
                        {file.name}
                        <small>
                          {Math.max(1, Math.round(file.size / 1024))} KB ·
                          selected locally
                        </small>
                      </span>
                      <Check size={16} />
                      <button
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setFiles((f) => f.filter((_, index) => index !== i))
                        }
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="demo-caption">
                Selection preview only. File contents are never read or
                uploaded. Every brief opens the same AgentSync reference plan.
              </p>
              <button
                className="button primary demo-wide"
                disabled={
                  generating || (!saved.idea.trim() && files.length === 0)
                }
                onClick={() => {
                  setProgress(0);
                  setDocument(null);
                }}
              >
                {generating ? (
                  <>
                    <span className="demo-spinner" /> Preparing the reference
                    plan…
                  </>
                ) : (
                  <>
                    <Sparkles size={17} />
                    {saved.generated
                      ? "Replay architecture reveal"
                      : "Create architecture"}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </section>
            <aside className="demo-reference">
              <span className="demo-kicker">THIS DEMO'S NORTH STAR</span>
              <div className="demo-project-icon">
                <Layers3 size={32} />
              </div>
              <h3>AgentSync</h3>
              <p>
                A local-first control plane for coding agents working on one
                repository.
              </p>
              <div className="demo-reference-list">
                <span>
                  <CheckCheck size={18} /> Shared tasks & ownership
                </span>
                <span>
                  <GitBranch size={18} /> Contract-change awareness
                </span>
                <span>
                  <Network size={18} /> Offline queue & human review
                </span>
              </div>
              <div className="demo-source">
                <FileCode2 size={18} />
                <div>
                  <strong>Built from your documents</strong>
                  <span>ARCHITECTURE.md + CONTRACT.md</span>
                </div>
              </div>
              <p className="demo-caption">
                A fixed, reproducible walkthrough. No AI model is called.
              </p>
            </aside>
          </div>
          {progress >= 0 && (
            <section className="demo-progress" aria-live="polite">
              <div>
                <Sparkles size={18} />
                <strong>
                  {generating
                    ? buildSteps[progress]
                    : "Your reference architecture is ready"}
                </strong>
                <span>{Math.min(100, progress * 20)}%</span>
              </div>
              <div className="demo-progress-track">
                <span style={{ width: `${Math.min(100, progress * 20)}%` }} />
              </div>
              <div className="demo-progress-steps">
                {buildSteps.map((s, i) => (
                  <span className={progress > i ? "done" : ""} key={s}>
                    {progress > i ? (
                      <Check size={12} />
                    ) : (
                      <span className="demo-small-dot" />
                    )}
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}
          {saved.generated && (
            <section
              className="demo-architecture"
              aria-label="Generated architecture"
            >
              <div className="demo-section-title">
                <div>
                  <span className="demo-kicker">
                    ONE SYSTEM. FOUR CLEAR BOUNDARIES.
                  </span>
                  <h2>The architecture, unfolded.</h2>
                  <p>
                    Select a module to explore its owner, files and
                    responsibilities.
                  </p>
                </div>
                <span className="demo-tag">Reference plan · v1</span>
              </div>
              <div className="demo-map-layout">
                <div className="demo-map">
                  <div className="demo-map-root">
                    <Layers3 size={25} />
                    <strong>AgentSync</strong>
                    <span>Local-first collaboration</span>
                  </div>
                  <div className="demo-map-spine" />
                  <div className="demo-map-nodes">
                    {roles.map((r) => (
                      <button
                        key={r.id}
                        className={`demo-node ${r.color} ${node === r.id ? "selected" : ""}`}
                        onClick={() => setNode(r.id)}
                        aria-pressed={node === r.id}
                      >
                        <span className="demo-node-id">
                          {r.id} / LAPTOP {r.letter}
                        </span>
                        <Laptop size={23} />
                        <strong>{r.short}</strong>
                        <small>{r.paths[0]}</small>
                        <span className="demo-node-footer">
                          Explore module <ArrowRight size={13} />
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="demo-map-common">
                    <FileText size={16} /> Shared foundation{" "}
                    <span>context.md</span>
                    <span>ARCHITECTURE.md</span>
                    <span>CONTRACT.md</span>
                  </div>
                </div>
                <aside className={`demo-module ${role.color}`}>
                  <span className="demo-kicker">
                    LAPTOP {role.letter} / {role.id}
                  </span>
                  <h3>{role.name}</h3>
                  <p>{role.goal}</p>
                  <ul>
                    {role.tasks.map((t) => (
                      <li key={t}>
                        <Check size={14} />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <div className="demo-boundary">
                    <strong>Ownership boundary</strong>
                    <p>{role.boundary}</p>
                  </div>
                </aside>
              </div>
              <div className="demo-document-buttons">
                {(["architecture", "contract", "context"] as const).map((d) => (
                  <button
                    className={`button ${document === d ? "primary" : "secondary"}`}
                    key={d}
                    onClick={() => setDocument(document === d ? null : d)}
                  >
                    <FileText size={16} />
                    {d === "context" ? "context.md" : `${d.toUpperCase()}.md`}
                  </button>
                ))}
                <a className="button primary" href="#prompts">
                  Open prompt vault <ArrowRight size={16} />
                </a>
              </div>
            </section>
          )}
        </>
      )}
      {page === "prompts" && (
        <>
          {!saved.generated ? (
            <section className="demo-empty">
              <FolderLock size={40} />
              <h2>Your prompt vault starts with a plan.</h2>
              <p>
                Create the reference architecture to prepare all four laptop
                packs.
              </p>
              <a className="button primary" href="#studio">
                Open build studio <ArrowRight size={16} />
              </a>
            </section>
          ) : (
            <>
              <section className="demo-vault-header">
                <div>
                  <span className="demo-kicker">A PLACE FOR EVERY PROMPT</span>
                  <h2>Right laptop. Right context.</h2>
                  <p>
                    Four individual prompts. Three shared documents. No guessing
                    who owns what.
                  </p>
                </div>
                <label>
                  Preview access as
                  <select
                    aria-label="Preview access as"
                    value={view}
                    onChange={(e) => {
                      setView(e.target.value);
                      setDocument(null);
                    }}
                  >
                    <option value="host">Host · all four laptops</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        Laptop {r.letter} · {r.short}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <div className="demo-access-note">
                <FolderLock size={16} />
                {view === "host"
                  ? "Host preview: inspect every assignment."
                  : `Laptop ${selected.letter} preview: your role prompt and shared documents.`}
                <span>Simulated access · no authentication</span>
              </div>
              <div className="demo-shared-docs">
                {(["context", "architecture", "contract"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDocument(document === d ? null : d)}
                  >
                    <FileText size={24} />
                    <div>
                      <strong>
                        {d === "context"
                          ? "context.md"
                          : `${d.toUpperCase()}.md`}
                      </strong>
                      <span>
                        {d === "context"
                          ? "Common project brief"
                          : d === "architecture"
                            ? "How the pieces fit"
                            : "The integration agreement"}
                      </span>
                    </div>
                    <span className="demo-tag">SHARED</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
              <div className="demo-laptop-grid">
                {visibleRoles.map((r) => (
                  <button
                    className={`demo-laptop ${r.color} ${selected.id === r.id ? "selected" : ""}`}
                    key={r.id}
                    onClick={() => {
                      setPromptId(r.id);
                      setDocument(null);
                    }}
                    aria-pressed={selected.id === r.id}
                  >
                    <span className="demo-laptop-top">
                      <span className="demo-laptop-symbol">
                        <Laptop size={24} />
                      </span>
                      <span className="demo-tag">{r.id}</span>
                    </span>
                    <small>LAPTOP {r.letter}</small>
                    <h3>{r.name}</h3>
                    <p>{r.goal}</p>
                    <span className="demo-laptop-status">
                      <span />
                      {saved.assigned ? "Assigned in demo" : "Prompt ready"}
                    </span>
                  </button>
                ))}
              </div>
              <section className="demo-prompt-editor">
                <div className="demo-prompt-top">
                  <div>
                    <span className="demo-kicker">
                      LAPTOP {selected.letter} · PRIVATE ROLE PREVIEW
                    </span>
                    <h3>
                      {selected.short.toLowerCase().replaceAll(" ", "-")}.md
                    </h3>
                  </div>
                  <div className="demo-actions">
                    <button
                      className="button secondary"
                      onClick={() => copy(rolePrompt(selected), "prompt")}
                    >
                      <Copy size={15} />
                      {copied === "prompt" ? "Copied!" : "Copy prompt"}
                    </button>
                    <a
                      className="button primary"
                      href={`/demo/laptop-${selected.letter.toLowerCase()}-pack.pdf`}
                      download
                    >
                      <Download size={15} /> Download PDF pack
                    </a>
                  </div>
                </div>
                <div className="demo-prompt-meta">
                  <span>
                    <GitBranch size={14} />
                    {selected.branch}
                  </span>
                  <label>
                    Coding tool
                    <select
                      aria-label={`Coding tool for laptop ${selected.letter}`}
                      value={saved.tools[selected.id] || selected.tool}
                      onChange={(e) =>
                        setSaved((s) => ({
                          ...s,
                          tools: { ...s.tools, [selected.id]: e.target.value },
                        }))
                      }
                    >
                      {[
                        "Codex",
                        "Claude Code",
                        "Antigravity",
                        "Cursor",
                        "Other / CLI",
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <pre tabIndex={0}>{rolePrompt(selected)}</pre>
                <div className="demo-prompt-bottom">
                  <span>
                    <FileText size={15} /> PDF includes common context, full
                    architecture, full contract + this role only.
                  </span>
                  <button
                    className="demo-text-button"
                    onClick={() =>
                      downloadText(
                        `${selected.id}-prompt.md`,
                        rolePrompt(selected),
                      )
                    }
                  >
                    Download .md <Download size={14} />
                  </button>
                </div>
              </section>
              <div className="demo-vault-footer">
                <div>
                  <h3>
                    {saved.assigned
                      ? "Four roles. One aligned team."
                      : "Ready to hand it over?"}
                  </h3>
                  <p>
                    {saved.assigned
                      ? "Assignments are recorded in this browser. Share a PDF with each laptop to start your real handoff."
                      : "Preview the assignment sequence, then hand each laptop its own pack."}
                  </p>
                </div>
                <div className="demo-actions">
                  {view === "host" && (
                    <button
                      className="button primary"
                      disabled={saved.assigned || assigning}
                      onClick={() => setAssigning(true)}
                    >
                      {assigning ? (
                        <span className="demo-spinner" />
                      ) : (
                        <CheckCheck size={17} />
                      )}{" "}
                      {assigning
                        ? "Assigning demo roles…"
                        : saved.assigned
                          ? "Demo roles assigned"
                          : "Ready · assign four roles"}
                    </button>
                  )}
                  <a className="button secondary" href="#learn">
                    See how it works <ArrowRight size={16} />
                  </a>
                </div>
              </div>
              {view !== "host" && (
                <button
                  className="demo-text-button"
                  onClick={() =>
                    copy(
                      `${window.location.origin}/#prompts?device=${selected.id}`,
                      "link",
                    )
                  }
                >
                  {copied === "link"
                    ? "Preview link copied"
                    : "Copy this laptop's demo view link"}
                  <Copy size={14} />
                </button>
              )}
              {view === "host" && (
                <div className="demo-pack-downloads">
                  <span>All four PDF packs</span>
                  {roles.map((r) => (
                    <a
                      key={r.id}
                      href={`/demo/laptop-${r.letter.toLowerCase()}-pack.pdf`}
                      download
                    >
                      <Download size={14} />
                      Laptop {r.letter} · {r.short}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      {page === "learn" && (
        <>
          <section className="demo-learn-intro">
            <div>
              <span className="demo-kicker">
                BUILD IT. UNDERSTAND IT. OWN THE ROOM.
              </span>
              <h2>
                Follow one change.
                <br />
                <em>Understand the whole system.</em>
              </h2>
              <p>
                Watch a contract update travel through the reference
                architecture. Click any step, explore the code, then practice
                your pitch.
              </p>
            </div>
            <div className="demo-learn-symbol">
              <BookOpen size={45} />
              <span>INSIDE THE APP</span>
            </div>
          </section>
          <div className="demo-flow-title">
            <h3>The journey of a contract change</h3>
            <button
              className="button secondary"
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
              {playing ? "Pause animation" : "Play walkthrough"}
            </button>
          </div>
          <div className={`demo-pipeline ${playing ? "playing" : ""}`}>
            {pipeline.map((p, i) => (
              <button
                key={p.name}
                className={step === i ? "active" : ""}
                onClick={() => {
                  setStep(i);
                  setPlaying(false);
                }}
                aria-pressed={step === i}
              >
                <span className="demo-flow-index">{i + 1}</span>
                <small>{p.owner}</small>
                <strong>{p.name}</strong>
                <span>{p.subtitle}</span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
          <section className="demo-flow-detail" aria-live="polite">
            <div className="demo-flow-big">0{step + 1}</div>
            <div>
              <span className="demo-kicker">
                {pipeline[step].owner} / {pipeline[step].subtitle}
              </span>
              <h3>{pipeline[step].name}</h3>
              <p>{pipeline[step].detail}</p>
              <code>{pipeline[step].code}</code>
            </div>
          </section>
          <p className="demo-caption">
            Illustrated reference flow, not a captured runtime trace. The code
            below is explanatory pseudocode for the supplied plan.
          </p>
          <div className="demo-section-title">
            <div>
              <span className="demo-kicker">ZOOM IN, ONE MODULE AT A TIME</span>
              <h2>What does this file actually do?</h2>
            </div>
          </div>
          <div className="demo-explorer">
            <aside aria-label="Reference modules">
              {roles.map((r) => (
                <button
                  key={r.id}
                  className={node === r.id ? "selected" : ""}
                  onClick={() => {
                    setNode(r.id);
                    setShowCode(false);
                  }}
                >
                  <FileCode2 size={17} />
                  <div>
                    <strong>{r.short}</strong>
                    <small>{r.file}</small>
                  </div>
                  <ChevronRight size={14} />
                </button>
              ))}
            </aside>
            <div className="demo-explanation">
              <span className="demo-tag">
                CONCEPT: {role.concept.toUpperCase()}
              </span>
              <h3>{role.goal}</h3>
              <p>{role.explanation}</p>
              <div className="demo-code-toolbar">
                <code>{role.file}</code>
                <button
                  className="demo-text-button"
                  onClick={() => setShowCode((v) => !v)}
                >
                  {showCode ? "Hide sample" : "Explore sample code"}
                  <FileCode2 size={15} />
                </button>
              </div>
              {showCode && <pre tabIndex={0}>{role.sample}</pre>}
              <p className="demo-caption">
                Illustrative filename and pseudocode. This describes the
                reference project, not an inspection of your repository.
              </p>
            </div>
          </div>
          <div className="demo-learning-bottom">
            <section className="demo-quiz">
              <span className="demo-kicker">CHECK YOUR UNDERSTANDING</span>
              <h3>Why save before broadcasting?</h3>
              <p>
                The browser receives an event, then the server crashes. What
                protects the team's work?
              </p>
              {[
                "Persist the event before notifying the UI",
                "Send the notification first",
              ].map((answer) => (
                <button
                  key={answer}
                  className={quiz === answer ? "selected" : ""}
                  onClick={() => setQuiz(answer)}
                >
                  {answer}
                  <ArrowRight size={14} />
                </button>
              ))}
              {quiz && (
                <p role="status" className="demo-quiz-result">
                  {quiz.startsWith("Persist")
                    ? "Exactly. Durable state survives restart; the UI can recover it by sequence."
                    : "Try again: a notification alone disappears. Commit the event to SQLite first."}
                </p>
              )}
            </section>
            <section className="demo-pitch">
              <span className="demo-kicker">YOUR 60-SECOND STORY</span>
              <h3>Present with understanding.</h3>
              <p>
                Explain the problem, show the journey, and make your own
                contribution clear.
              </p>
              <button
                className="button primary"
                onClick={() => setPitch((v) => !v)}
              >
                <Play size={16} />
                {pitch ? "Close presentation notes" : "Practice the pitch"}
              </button>
              {pitch && (
                <ol>
                  <li>
                    <strong>The problem:</strong> agents work in parallel, but
                    contract changes and conflicting edits get lost.
                  </li>
                  <li>
                    <strong>The design:</strong> four owned modules, one local
                    source of truth, and clear shared contracts.
                  </li>
                  <li>
                    <strong>The walkthrough:</strong> follow a change through
                    the API, SQLite, SSE and a human conflict review.
                  </li>
                  <li>
                    <strong>The scope:</strong> this is a scripted planning and
                    teaching demo; laptop execution and cloud sync are not
                    demonstrated here.
                  </li>
                </ol>
              )}
            </section>
          </div>
        </>
      )}
      {document && (page !== "studio" || saved.generated) && (
        <section
          ref={documentPanel}
          className="demo-document"
          aria-label={`${document} document`}
        >
          <div className="demo-document-head">
            <h3>
              {document === "context"
                ? "context.md"
                : `${document.toUpperCase()}.md`}
            </h3>
            <div className="demo-actions">
              <button
                className="button secondary"
                onClick={() =>
                  downloadText(
                    `${document}.md`,
                    document === "context"
                      ? context
                      : document === "architecture"
                        ? architecture
                        : contract,
                  )
                }
              >
                <Download size={14} />
                Download
              </button>
              <button
                className="icon-button"
                aria-label="Close document"
                onClick={() => setDocument(null)}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <pre tabIndex={0}>
            {document === "context"
              ? context
              : document === "architecture"
                ? architecture
                : contract}
          </pre>
        </section>
      )}
      <footer className="demo-footnote">
        <span className="brand-symbol">
          <span />
          <span />
        </span>
        <span>
          Upside Down Studio <b>·</b> A shared plan is only the beginning.
        </span>
        <span>Fixed reference data · browser-local demo</span>
      </footer>
    </div>
  );
}
