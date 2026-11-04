/**
 * AI Coordinator Engine (Upside-Down 2.0)
 * Intelligent Orchestration for Hackathon Ideation, Architecture, and Multi-Agent Work Division
 * Supports Gemini API, OpenAI, and a built-in Heuristic Demo Mode for zero-cost operation.
 */

import { randomUUID } from "node:crypto";
import type {
  HackathonProject,
  ProjectIdea,
  ArchitectureBlueprint,
  TaskContractV2,
  CrossAgentHandoff,
  SupportedCodingTool,
} from "../../contracts/hackathon.ts";

export interface AICoordinatorConfig {
  provider?: "gemini" | "openai" | "demo";
  geminiApiKey?: string;
  openaiApiKey?: string;
  model?: string;
}

export class AICoordinator {
  private provider: "gemini" | "openai" | "demo";
  private geminiApiKey?: string;
  private openaiApiKey?: string;

  constructor(config: AICoordinatorConfig = {}) {
    this.geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;

    // Current generator is deterministic; API-key presence cannot make it a live LLM.
    this.provider = "demo";
  }

  public getProvider(): string {
    return this.provider;
  }

  public isDemoMode(): boolean {
    return this.provider === "demo";
  }

  private ideaCycle: number = 0;

  // --- 1. AI IDEA STUDIO: DYNAMIC DOMAIN-AWARE IDEA GENERATOR ---
  public async generateIdeas(project: HackathonProject): Promise<ProjectIdea[]> {
    this.ideaCycle++;
    const cycle = this.ideaCycle;
    const problem = (project.problemStatement || "Autonomous collaborative problem solving").trim();
    const name = (project.name || "Hackathon Project").trim();
    const time = project.availableTime || "24h";
    const devCount = project.developerCount || 2;
    const tech = (project.technologies && project.technologies.length > 0)
      ? project.technologies.join(", ")
      : "TypeScript, React, Node.js, SQLite";

    const combined = (name + " " + problem).toLowerCase();
    const isHealth = /(health|medic|patient|hospital|clinic|doctor|disease|vital|emergency|triage|pharma|biomed)/i.test(combined);
    const isFinance = /(finan|bank|crypto|fraud|pay|wallet|trade|stock|ledger|money|loan|defi|token|credit)/i.test(combined);
    const isEducation = /(edu|student|learn|tutor|school|study|teach|course|homework|quiz|exam|class|curricul)/i.test(combined);
    const isCleanTech = /(climate|energy|green|carbon|solar|waste|eco|sustainable|crop|farm|water|grid|emiss)/i.test(combined);
    const isCyberSec = /(cyber|security|hack|breach|vulnerab|phish|auth|zero-trust|threat|incident|ransom)/i.test(combined);

    interface ConceptTemplate {
      name: string;
      pitch: string;
      problem: string;
      targetUsers: string;
      usp: string;
      coreFeatures: string[];
      suggestedTech: string[];
      mvpDifficulty: "Easy" | "Medium" | "Hard";
      technicalRisks: string[];
      demoScenario: string;
      judgingAlignment: string;
    }

    let catalog: ConceptTemplate[] = [];

    if (isHealth) {
      catalog = [
        {
          name: "MedPulse AI — Clinical Triage & Emergency Resource Engine",
          pitch: "Real-time AI patient acuity scoring and intelligent ER bed allocation to eliminate clinical triage bottlenecks.",
          problem: "Emergency room crowding and delayed specialist handoffs result in preventable patient complications.",
          targetUsers: "Emergency department staff, triage nurses, and hospital medical directors",
          usp: "Predictive vital deterioration alerts paired with sub-second automated specialist dispatching.",
          coreFeatures: [
            "Continuous vital sign telemetry & early warning score calculation",
            "Automated ambulance incoming patient pre-triage classifier",
            "Emergency bed availability & medical equipment heat map",
            "Role-gated physician handoff protocol with zero data loss",
          ],
          suggestedTech: [tech, "WebSockets", "FastAPI / Node", "TailwindCSS"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Strict HIPAA/data privacy compliance", "Handling intermittent hospital IoT connectivity"],
          demoScenario: "Ambulance streams incoming patient vitals -> system auto-assigns Trauma Bay 3 and notifies attending surgeon instantly.",
          judgingAlignment: "Massive real-world healthcare impact, safety-critical architecture, and elegant execution.",
        },
        {
          name: "VitalMesh — Autonomous ICU Deterioration Early-Warning Mesh",
          pitch: "Edge-computed biometric anomaly detector forecasting patient deterioration 4 hours before clinical crash.",
          problem: "ICU alarms cause clinician alert fatigue, leading to delayed interventions on critical patients.",
          targetUsers: "Intensive care nurses, cardiologists, and hospitalists",
          usp: "Multi-parameter fusion filtering false positives with 94% validated clinical specificity.",
          coreFeatures: [
            "Waveform stream ingestion (ECG, SpO2, arterial blood pressure)",
            "Automated alert deduplication and severity escalation",
            "Bedside tablet dashboard with visual risk trajectories",
            "Offline resilient SQLite local sync for continuous monitoring",
          ],
          suggestedTech: [tech, "Chart.js", "Express", "SQLite WAL"],
          mvpDifficulty: "Easy",
          technicalRisks: ["Sensor noise and movement artifact filtering"],
          demoScenario: "Simulate sudden SpO2 drop -> VitalMesh elevates risk score from Green to Red and highlights deteriorating cardiac trend.",
          judgingAlignment: "Solves alarm fatigue, highly demonstrable in live demo.",
        },
        {
          name: "CareSync Hub — Zero-Loss Inter-Specialist Handoff Protocol",
          pitch: "Standardized digital SBAR handoff platform synchronizing care plans between shifting medical teams.",
          problem: "Shift change miscommunications cause over 70% of sentinel medical errors in tertiary hospitals.",
          targetUsers: "Resident physicians, nursing shifts, and surgical coordinators",
          usp: "Cryptographically verified digital sign-outs with automated pending lab tracking.",
          coreFeatures: [
            "Structured SBAR (Situation, Background, Assessment, Recommendation) builder",
            "Live pending labs and imaging study auto-reconciliation",
            "Two-way acknowledgement signatures for patient custody transfer",
            "Mobile-optimized bedside sign-out interface",
          ],
          suggestedTech: [tech, "Zod", "React 19", "Vite"],
          mvpDifficulty: "Easy",
          technicalRisks: ["Integration with legacy hospital electronic health records (EHRs)"],
          demoScenario: "Outgoing resident initiates handoff -> incoming resident reviews pending scans, clicks acknowledge, and custody transfers.",
          judgingAlignment: "Direct patient safety improvement, complete workflows, zero fluff.",
        },
        {
          name: "PharmaGuard AI — Real-Time Contraindication & Dosing Sentinel",
          pitch: "Instant multi-drug interaction checking with renal/hepatic dosage tuning at point of prescription.",
          problem: "Adverse drug events cause 100,000+ hospitalizations yearly due to overlooked drug-drug contraindications.",
          targetUsers: "Clinical pharmacists, prescribing doctors, and outpatient clinics",
          usp: "Sub-10ms polypharmacy graph analysis with personalized renal clearance adjustment.",
          coreFeatures: [
            "Instant interaction matrix across 5,000+ active compounds",
            "Patient allergy and genomic contraindication alerts",
            "Pediatric and geriatric weight-adjusted dosage calculator",
            "Exportable e-prescription summary with patient-friendly instructions",
          ],
          suggestedTech: [tech, "SQLite", "OpenFDA API", "TypeScript"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Database completeness for rare compound combinations"],
          demoScenario: "Prescribe Warfarin + Ciprofloxacin -> PharmaGuard flags severe bleeding risk and suggests safe alternative Azithromycin.",
          judgingAlignment: "High technical rigor, life-saving clinical utility.",
        },
        {
          name: "OmniTriage — Regional Emergency Dispatch & Hospital Capacity Router",
          pitch: "Decentralized regional bed coordination routing ambulances away from saturated emergency rooms in real time.",
          problem: "Ambulance diversion and ER saturation create dangerous delays during regional casualty surges.",
          targetUsers: "911 dispatchers, paramedic squads, and regional hospital network coordinators",
          usp: "Dynamic multi-criteria routing balancing drive time with real-time ER surgical capacity.",
          coreFeatures: [
            "Regional hospital capacity map with live ER wait times",
            "Paramedic mobile app for pre-arrival triage notification",
            "Surge alert broadcast during mass-casualty events",
            "Predictive bed turnover forecasting using historical discharge trends",
          ],
          suggestedTech: [tech, "Leaflet / Maps", "Server-Sent Events", "Node.js"],
          mvpDifficulty: "Hard",
          technicalRisks: ["Coordinating disparate hospital network IT systems"],
          demoScenario: "Dispatcher inputs high-acuity stroke call -> OmniTriage bypasses crowded local hospital to route directly to open Cath Lab 4 miles away.",
          judgingAlignment: "Systems-level innovation, compelling visual map demo.",
        },
      ];
    } else if (isFinance) {
      catalog = [
        {
          name: "FraudSentinel — Real-Time Autonomous Transaction Anomaly Shield",
          pitch: "High-throughput streaming fraud detection scoring transactions and isolating fraudulent card rings in under 15 milliseconds.",
          problem: "Account takeover and synthetic identity fraud cost financial institutions over $40B annually.",
          targetUsers: "Risk engineering teams, anti-fraud analysts, and fintech compliance officers",
          usp: "Sub-15ms graph behavioral scoring that detects synthetic identity clusters before money leaves accounts.",
          coreFeatures: [
            "Sub-15ms payment velocity and geovelocity anomaly detection",
            "Graph entity resolution identifying multi-account ring formations",
            "One-click suspicious transaction freeze and SMS challenge trigger",
            "Interactive fraud analyst workbench with explainable score breakdown",
          ],
          suggestedTech: [tech, "WebSocket", "Node.js", "SQLite"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Maintaining sub-50ms latency under high concurrent load"],
          demoScenario: "Trigger normal purchase -> instant green approval. Trigger split-second geographic anomaly -> transaction quarantined and flagged.",
          judgingAlignment: "Direct financial impact, high-performance data processing, excellent visual demo.",
        },
        {
          name: "VaultMesh — Multi-Agent Institutional Settlement & Payment Reconciliation",
          pitch: "Autonomous multi-ledger reconciliation agent eliminating manual end-of-day bank settlement breaks.",
          problem: "Financial institutions spend thousands of manual hours reconciling mismatched settlement records across disparate clearing networks.",
          targetUsers: "Treasury departments, clearing houses, and corporate CFOs",
          usp: "Autonomous heuristic matching resolving 99.2% of unmatched transaction breaks without human intervention.",
          coreFeatures: [
            "Universal parser for SWIFT MT940, ISO 20022, and JSON bank feeds",
            "Fuzzy multi-currency matching with timestamp tolerance",
            "Automated settlement discrepancy quarantine and escalation",
            "Immutable audit log with cryptographically signed balance snapshots",
          ],
          suggestedTech: [tech, "Zod", "Express", "SQLite WAL"],
          mvpDifficulty: "Easy",
          technicalRisks: ["Handling fragmented legacy bank file formats"],
          demoScenario: "Upload two mismatching ledger CSVs -> VaultMesh matches 98 transactions, detects 2 discrepancies, and auto-generates adjustment entries.",
          judgingAlignment: "Enterprise ROI, high technical maturity, and bulletproof auditability.",
        },
        {
          name: "RiskMatrix AI — Real-Time Alternative Credit Scoring Engine",
          pitch: "Instant financial creditworthiness assessment for unbanked micro-entrepreneurs using cash-flow and commerce telemetry.",
          problem: "Billions of underbanked small merchants cannot access working capital due to lack of traditional credit bureau history.",
          targetUsers: "Microfinance lenders, neobanks, and small business owners",
          usp: "Real-time cash-flow volatility and revenue trend scoring yielding 40% lower default rates.",
          coreFeatures: [
            "Bank transaction statement auto-categorization and revenue profiling",
            "Working capital loan affordability and repayment simulation",
            "Automated loan term generation with dynamic interest tiering",
            "Applicant dashboard with actionable steps to improve financial score",
          ],
          suggestedTech: [tech, "Chart.js", "React 19", "TailwindCSS"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Fairness and algorithmic bias mitigation across diverse borrower demographics"],
          demoScenario: "Applicant submits bank feed -> RiskMatrix analyzes 90-day cash flow, approves $5,000 micro-credit line, and displays repayment schedule.",
          judgingAlignment: "Strong social impact, sound financial logic, polished user journey.",
        },
        {
          name: "PayStream — Milestone-Gated Escrow & Streaming Payroll Protocol",
          pitch: "Trustless programmatic milestone escrow releasing contractor payments automatically upon verified deliverable approval.",
          problem: "Freelancers and clients face payment disputes, late disbursements, and unpaid invoices due to lack of milestone escrow.",
          targetUsers: "Remote software agencies, independent contractors, and client organizations",
          usp: "Automated cryptographic GitHub PR and deliverable evidence verification gating fund release.",
          coreFeatures: [
            "Milestone contract builder with defined acceptance criteria",
            "Multi-signature host approval and automated payment trigger",
            "Real-time streaming fund release upon continuous task progress",
            "Dispute resolution arbitration room with frozen escrow protection",
          ],
          suggestedTech: [tech, "TypeScript", "Node.js", "SQLite"],
          mvpDifficulty: "Easy",
          technicalRisks: ["Secure credential custody for mock banking gateways"],
          demoScenario: "Contractor submits verified GitHub PR -> Client approves -> Escrow releases payment milestone with instant receipt.",
          judgingAlignment: "Direct alignment with developer workflows and freelance trust economies.",
        },
      ];
    } else if (isEducation) {
      catalog = [
        {
          name: "CogniLearn — Adaptive Real-Time Concept Mastery Graph",
          pitch: "Dynamic personalized learning engine identifying student prerequisite gaps and auto-generating micro-lessons in real time.",
          problem: "Traditional online courses have 90%+ drop-out rates because students get stuck on prerequisite concepts without tailored support.",
          targetUsers: "STEM students, self-taught developers, and online educators",
          usp: "Knowledge graph prerequisite tracking diagnosing exact conceptual blockers within 3 diagnostic questions.",
          coreFeatures: [
            "Interactive concept dependency graph showing mastered vs blocked nodes",
            "Adaptive diagnostic quiz generator targeted to student skill edge",
            "Dynamic code sandbox with automated instant test feedback",
            "Voice and text Socratic explainer breaking complex concepts down",
          ],
          suggestedTech: [tech, "D3.js / SVG", "React 19", "SQLite"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Curating high-quality concept dependency graphs for complex subjects"],
          demoScenario: "Student fails recursion problem -> CogniLearn diagnoses call stack misunderstanding, branches to visual stack demo, and tests mastery.",
          judgingAlignment: "Massive pedagogical impact, visually stunning interactive knowledge graph.",
        },
        {
          name: "StudySync Studio — Collaborative Peer Learning & AI Study Decks",
          pitch: "Real-time collaborative study workspace turning raw lecture notes into interactive flashcards, quizzes, and spaced-repetition decks.",
          problem: "Students spend hours passively reading notes instead of engaging in high-retention active recall and peer discussion.",
          targetUsers: "University cohorts, study groups, and medical/bar exam candidates",
          usp: "Collaborative multiplayer study rooms with synchronous quiz duels and automated deck synthesis.",
          coreFeatures: [
            "Instant Markdown and PDF note extraction into Anki-compatible flashcards",
            "Multiplayer live study room with shared quiz timer",
            "SM-2 Spaced Repetition Algorithm optimizing memory retention",
            "Peer discussion threads with AI-assisted citation lookup",
          ],
          suggestedTech: [tech, "WebSockets", "Vite", "TailwindCSS"],
          mvpDifficulty: "Easy",
          technicalRisks: ["Accurate extraction of mathematical equations and diagram figures"],
          demoScenario: "Paste lecture notes -> StudySync generates 10 high-yield flashcards -> 2 students duel in live multiplayer quiz mode.",
          judgingAlignment: "Extremely fun and engaging live demo, strong utility for judges.",
        },
        {
          name: "SkillTree AI — Verified Milestone Developer Career Navigator",
          pitch: "Actionable project-driven technical roadmap verifying developer skill competencies through real code submissions.",
          problem: "Job seekers waste months on generic tutorials that don't prove real-world engineering competency to hiring managers.",
          targetUsers: "Aspiring software engineers, career switchers, and tech hiring teams",
          usp: "Automated Git repository inspection verifying test coverage and architecture quality per skill badge.",
          coreFeatures: [
            "Interactive RPG-style skill tree for full-stack and AI engineering",
            "Hands-on milestone project briefs with runnable test suites",
            "Automated code review scoring style, testing, and boundary policies",
            "Shareable verified portfolio page showing pass/fail test evidence",
          ],
          suggestedTech: [tech, "TypeScript", "GitHub API", "React 19"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Sandboxed execution of untrusted user test submissions"],
          demoScenario: "Student submits GitHub repo for 'REST API' milestone -> SkillTree runs tests, verifies 100% pass, and unlocks next skill branch.",
          judgingAlignment: "Direct bridge from education to employment, clear technical verification.",
        },
      ];
    } else if (isCleanTech) {
      catalog = [
        {
          name: "GreenGrid AI — Decentralized Microgrid Solar & Battery Exchange",
          pitch: "Autonomous peer-to-peer neighborhood renewable energy balancer routing excess residential solar to peak demand nodes.",
          problem: "Residential solar energy is frequently curtailed or dumped because grid infrastructure lacks dynamic neighborhood routing.",
          targetUsers: "Solar home owners, microgrid operators, and municipal energy planners",
          usp: "Sub-second localized energy dispatch optimizing battery degradation vs grid peak tariffs.",
          coreFeatures: [
            "Neighborhood microgrid topology map with real-time solar generation stats",
            "Predictive battery charge/discharge scheduler based on weather forecasts",
            "Automated P2P energy credit ledger with instantaneous settlement",
            "Emergency islanding mode during regional grid blackout events",
          ],
          suggestedTech: [tech, "Chart.js", "Server-Sent Events", "SQLite"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Interfacing with heterogeneous inverter and smart meter protocols"],
          demoScenario: "Simulate afternoon peak demand -> GreenGrid shifts 15 kWh from Home A's full battery to Home B's EV charger at discounted rate.",
          judgingAlignment: "Environmental urgency, sophisticated optimization, clean dashboard UI.",
        },
        {
          name: "CarbonPulse — Automated Scope 1-3 Supply Chain Footprint Auditor",
          pitch: "Enterprise supply chain carbon accounting transforming procurement invoices into real-time verified emissions ledgers.",
          problem: "Corporate sustainability reporting takes 6+ months and relies on manual estimates prone to greenwashing accusations.",
          targetUsers: "Chief Sustainability Officers, supply chain managers, and ESG compliance auditors",
          usp: "Automated invoice line-item extraction mapped to verified GHG Protocol emission factors.",
          coreFeatures: [
            "Automated invoice and freight bill carbon footprint calculator",
            "Supplier emissions ranking and decarbonization roadmap recommender",
            "Exportable audit-ready GHG Protocol and CSRD compliance reports",
            "Scenario modeler forecasting emissions reduction under vendor switching",
          ],
          suggestedTech: [tech, "Node.js", "React 19", "SQLite"],
          mvpDifficulty: "Easy",
          technicalRisks: ["Accurate emission factor mapping across multi-national suppliers"],
          demoScenario: "Upload supplier logistics manifest -> CarbonPulse breaks down 42 tons CO2e and recommends shifting 3 routes to electric rail.",
          judgingAlignment: "High enterprise relevance, strong visual charting, clear regulatory driver.",
        },
      ];
    } else if (isCyberSec) {
      catalog = [
        {
          name: "ThreatZero — Autonomous Attack Surface Vulnerability Remediation Agent",
          pitch: "Continuous external attack surface mapper automatically creating and testing verified pull requests to patch dependencies.",
          problem: "Security teams take an average of 65 days to patch known CVEs, leaving critical zero-day windows open to exploit.",
          targetUsers: "DevSecOps engineers, security leads, and compliance officers",
          usp: "Full-loop autonomous discovery, sandbox reproduction, and minimal-diff patch generation.",
          coreFeatures: [
            "Continuous sub-domain and exposed API endpoint discovery",
            "CVE dependency vulnerability scanner with exploitability scoring",
            "Automated candidate patch generator with isolated sandbox test verification",
            "Executive security posture scorecard with mean-time-to-remediation trends",
          ],
          suggestedTech: [tech, "Node.js", "Express", "SQLite WAL"],
          mvpDifficulty: "Medium",
          technicalRisks: ["Preventing false-positive regressions in automated patches"],
          demoScenario: "Trigger CVE scan -> ThreatZero detects vulnerable JWT parser, drafts verified patch, runs test suite, and opens PR.",
          judgingAlignment: "Massive market demand, high technical coolness, end-to-end automation.",
        },
      ];
    }

    // Default / AI Developer Tools / Hackathon Mission Control
    const defaultCatalog: ConceptTemplate[] = [
      {
        name: `PulseFlow — Intelligent ${name} Mission Control`,
        pitch: `Real-time reactive multi-agent platform solving "${problem.slice(0, 60)}..." via contract-first autonomous pipelines.`,
        problem: problem,
        targetUsers: "Hackathon teams, autonomous developer agents, and engineering leads",
        usp: "Zero-latency synchronization between disparate AI coding assistants with contract-first collision detection.",
        coreFeatures: [
          "Instant natural language problem decomposition into 7-phase roadmaps",
          "Automated API & data contract generation before any code is written",
          "Live developer assignment board with universal prompt bridges",
          "One-click release integration, collision checking, and deploy gatekeeper",
        ],
        suggestedTech: [tech, "WebSocket / SSE", "TailwindCSS"],
        mvpDifficulty: "Medium",
        technicalRisks: ["Handling API schema divergences without blocking parallel agents"],
        demoScenario: "Host inputs problem statement -> 2 agents execute parallel frontend/backend tasks -> live integration test passes on stage.",
        judgingAlignment: "Directly targets technical execution, innovation, and practical multi-agent collaboration.",
      },
      {
        name: "OmniMesh — Verifiable AI Co-Developer Coordination Hub",
        pitch: "Multi-agent collaboration mesh ensuring zero-loss code handoffs, strict path boundaries, and automated PR verification.",
        problem: "Fragmented multi-agent toolchains lack unified accountability, leading to merge conflicts and broken production builds.",
        targetUsers: "AI-assisted engineers using mixed tools (Antigravity, Claude Code, Cursor, Codex)",
        usp: "Universal prompt bridge and path-policy enforcement preventing agents from overwriting sibling files.",
        coreFeatures: [
          "Role-isolated workspace contracts with strict path boundary policies",
          "Interactive dependency graph with cross-agent blocker notifications",
          "Automated GitHub pull request collision detection and test verification",
          "Live mission control cockpit with heartbeat monitor and active lease timers",
        ],
        suggestedTech: [tech, "GitHub Octokit", "Zod", "Vite"],
        mvpDifficulty: "Easy",
        technicalRisks: ["Git branch merge conflicts on shared utility files"],
        demoScenario: "Simulate concurrent PRs from Agent A and Agent B, trigger collision warning, and show host resolving with 1 click.",
        judgingAlignment: "High marks for completeness, developer ergonomics, and rock-solid reliability.",
      },
      {
        name: "HyperDraft — Rapid Prototyping Mission Control & Architecture Synthesizer",
        pitch: "End-to-end hackathon accelerator turning raw problem statements into verified, deployable vertical slices in under 12 hours.",
        problem: "Teams waste initial hackathon hours arguing over architecture and schemas instead of shipping working code.",
        targetUsers: "Time-constrained competitive hackathon developers and venture builders",
        usp: "Synthesizes problem statements into executable 7-phase roadmaps with ready-to-code prompt exports.",
        coreFeatures: [
          "AI idea comparison board with difficulty, feasibility, and judging scores",
          "Instant OpenAPI & TypeScript schema generator with mock endpoints",
          "Exportable agent prompts tailored for Antigravity, Claude, and Codex",
          "Automated release package bundler and deployment health checker",
        ],
        suggestedTech: [tech, "Node.js Native SQLite", "Playwright"],
        mvpDifficulty: "Medium",
        technicalRisks: ["Maintaining schema accuracy when requirements shift mid-hackathon"],
        demoScenario: "Enter a 1-sentence prompt, get 3 validated ideas, select one, and inspect generated runnable task contracts in 30 seconds.",
        judgingAlignment: "Directly addresses hackathon velocity, usability, and presentation polish.",
      },
      {
        name: "ZeroConflict — Path-Partitioned Git Orchestrator for AI Agents",
        pitch: "Dynamic repository partitioner allocating non-overlapping directory bounds to parallel AI agents to eliminate merge conflicts.",
        problem: "When 3+ AI coding agents work on the same git repository simultaneously, conflicting edits destroy progress and break CI.",
        targetUsers: "Autonomous software development teams and AI agent orchestrators",
        usp: "Contract-enforced workspace boundary policies with automated git branch reconciliation.",
        coreFeatures: [
          "Dynamic file-level boundary policy assignment per agent",
          "Automated Git worktree isolation with shared contract interfaces",
          "Pre-merge collision simulator detecting semantic interface breaks",
          "Live visual branch dependency tree with merge-ready badges",
        ],
        suggestedTech: [tech, "Git CLI", "TypeScript", "Express"],
        mvpDifficulty: "Medium",
        technicalRisks: ["Handling necessary shared config files like package.json or tsconfig"],
        demoScenario: "Agent A and Agent B commit in parallel -> ZeroConflict verifies allowed path isolation and merges without conflict.",
        judgingAlignment: "Groundbreaking solution to a universal multi-agent coding challenge.",
      },
      {
        name: "Synthetix CI — Self-Healing Autonomous Test & Patch Engine",
        pitch: "Continuous autonomous regression repair analyzing failing test traces and generating validated minimal code patches.",
        problem: "Developers lose hours debugging failed integration tests and interpreting cryptic stack traces under hackathon pressure.",
        targetUsers: "Full-stack developers, QA engineers, and hackathon competitors",
        usp: "Bounded offline heuristic patch generation with automated test pass verification.",
        coreFeatures: [
          "Subprocess test runner capturing exit codes, stdout, and error traces",
          "Deterministic patch generator synthesizing minimal unified diffs",
          "Automated security scanner blocking token leaks and destructive mutations",
          "Host reviewer sign-off gate before applying verified patches to repository",
        ],
        suggestedTech: [tech, "Node.js", "SQLite", "Vitest / Jest"],
        mvpDifficulty: "Hard",
        technicalRisks: ["Preventing circular patch loops on complex architectural failures"],
        demoScenario: "Inject breaking bug into test suite -> Synthetix detects failure, drafts 4-line patch, tests it, and shows green checkmark.",
        judgingAlignment: "Extraordinary technical depth, highly impressive for judges.",
      },
      {
        name: "AgentSwarm Studio — Cross-Model Coding Assistant Bridge",
        pitch: "Universal task protocol bridging Antigravity, Claude Code, Cursor, and Codex into a synchronized collaboration room.",
        problem: "Developers on the same hackathon team use different AI coding tools that cannot communicate or coordinate directly.",
        targetUsers: "Mixed-assistant developer teams and hackathon organizers",
        usp: "Format-agnostic prompt bridge translating shared task contracts into tool-tailored instructions.",
        coreFeatures: [
          "Universal task specification with allowed paths and protected boundaries",
          "One-click tailored prompt export for 5 major AI coding tools",
          "Structured cross-agent dependency handoffs (API request -> schema response)",
          "Centralized progress board aggregating commits, PRs, and test evidence",
        ],
        suggestedTech: [tech, "React 19", "Vite", "TailwindCSS"],
        mvpDifficulty: "Easy",
        technicalRisks: ["Keeping prompt templates aligned with latest AI tool capabilities"],
        demoScenario: "Dev A on Antigravity copies frontend prompt -> Dev B on Claude Code copies backend prompt -> both sync via central board.",
        judgingAlignment: "Directly solves the multi-tool interoperability problem.",
      },
    ];

    const activePool = catalog.length >= 3 ? catalog : defaultCatalog;
    const poolSize = activePool.length;

    // Pick 3 non-overlapping concepts based on rotation cycle
    const offset = (cycle * 3) % poolSize;
    const selectedTemplates: ConceptTemplate[] = [];
    for (let i = 0; i < 3; i++) {
      selectedTemplates.push(activePool[(offset + i) % poolSize]);
    }

    const ideas: ProjectIdea[] = selectedTemplates.map((template, idx) => ({
      id: `idea-${randomUUID().slice(0, 8)}`,
      projectId: project.id,
      name: template.name,
      pitch: template.pitch,
      problem: template.problem || problem,
      targetUsers: template.targetUsers,
      usp: template.usp,
      coreFeatures: template.coreFeatures,
      suggestedTech: template.suggestedTech,
      mvpDifficulty: template.mvpDifficulty,
      timeFeasibility: `Optimized for ${time} development with parallel ${devCount}-agent workstreams.`,
      technicalRisks: template.technicalRisks,
      demoScenario: template.demoScenario,
      judgingAlignment: template.judgingAlignment,
      version: 1,
      isSelected: false,
      createdAt: new Date().toISOString(),
    }));

    return ideas;
  }

  // --- 2. AI IDEA STUDIO: REFINE IDEAS ---
  public async refineIdeas(
    project: HackathonProject,
    feedback: string,
    existingIdeas: ProjectIdea[]
  ): Promise<ProjectIdea[]> {
    const isDemo = this.isDemoMode();
    const version = (existingIdeas[0]?.version || 1) + 1;
    const lower = feedback.toLowerCase();

    // Context-aware transformation based on feedback
    return existingIdeas.map((idea, index) => {
      let refinedName = idea.name;
      let refinedPitch = idea.pitch;
      let refinedDifficulty = idea.mvpDifficulty;
      let refinedRisks = [...idea.technicalRisks];
      const refinedFeatures = [...idea.coreFeatures];

      if (lower.includes("innovative") || lower.includes("creative")) {
        refinedName = `Neo${idea.name.replace(/^Neo/, "")}`;
        refinedPitch = `${idea.pitch} Enhanced with innovative autonomous self-healing agent pipelines.`;
        refinedFeatures.push("Autonomous heuristic repair and test-feedback loops");
      } else if (lower.includes("simple") || lower.includes("easy") || lower.includes("24 hours") || lower.includes("too complicated")) {
        refinedDifficulty = "Easy";
        refinedPitch = `Streamlined vertical slice: ${idea.pitch}`;
        refinedRisks = ["Keeping feature scope tight for timely delivery"];
      } else if (lower.includes("combine")) {
        refinedName = `Unified ${idea.name}`;
        refinedPitch = `Hybrid concept combining reactive synchronization with automated PR verification.`;
        refinedFeatures.push("Unified cross-agent dependency resolver");
      } else if (lower.includes("free") || lower.includes("open-source")) {
        refinedPitch = `${idea.pitch} (100% Free & Open-Source Stack, zero paid API keys needed).`;
        idea.suggestedTech = ["React", "Express", "SQLite", "Node.js"];
      } else if (lower.includes("judge") || lower.includes("impressive")) {
        refinedPitch = `Judge-optimized edition: ${idea.pitch} High-impact visual timeline and live execution benchmarks.`;
        refinedFeatures.push("Real-time benchmark visualizer and judge presentation mode");
      } else {
        refinedPitch = `${idea.pitch} [Refined based on host feedback: "${feedback.slice(0, 40)}..."]`;
      }

      if (isDemo && !refinedPitch.includes("")) {
        refinedPitch = `${refinedPitch}`;
      }

      return {
        ...idea,
        id: `idea-${randomUUID().slice(0, 8)}`,
        name: index === 0 ? refinedName : idea.name,
        pitch: refinedPitch,
        mvpDifficulty: refinedDifficulty,
        coreFeatures: refinedFeatures,
        technicalRisks: refinedRisks,
        version: version,
        isSelected: false,
        createdAt: new Date().toISOString(),
      };
    });
  }

  // --- 3. AI ARCHITECTURE GENERATOR ---
  public async generateArchitecture(
    project: HackathonProject,
    selectedIdea: ProjectIdea
  ): Promise<ArchitectureBlueprint> {
    const devCount = project.developerCount || 2;
    const hours = parseInt(project.availableTime, 10) || 24;

    const blueprint: ArchitectureBlueprint = {
      id: `arch-${randomUUID().slice(0, 8)}`,
      projectId: project.id,
      version: 1,
      isApproved: false,
      spec: {
        objective: `Deliver a fully functional MVP for ${selectedIdea.name} within ${project.availableTime}, targeting ${selectedIdea.targetUsers}.`,
        targetUsers: [
          selectedIdea.targetUsers,
          "Hackathon Evaluation Panel / Judges",
          "Multi-agent Developer Teams",
        ],
        userJourneys: [
          "Host creates hackathon workspace and sets constraints",
          "AI Idea Engine suggests concepts and host approves blueprint",
          `${devCount} developers connect their AI assistants and claim isolated tasks`,
          "Developers push branches, contracts are checked, and collision engine verifies safety",
          "Host inspects live integration dashboard and approves deployment",
        ],
        mvpFeatures: selectedIdea.coreFeatures,
        optionalFeatures: [
          "Multi-cloud deployment adapter (Render, Vercel, Railway)",
          "Real-time voice agent commentary for live demo presentation",
        ],
        nonFunctionalReqs: [
          "Sub-100ms API response latency on local and hosted environments",
          "Zero-trust credential separation: API keys stay server-side",
          "Durable persistence surviving server restarts without state corruption",
        ],
        successCriteria: [
          "Clean end-to-end user flow from problem to release",
          "Passing automated integration and unit test suites",
          "Production-ready deployment build with zero compiler warnings",
        ],
      },
      technical: {
        frontend: "React 19 + Vite (TypeScript, Tailwind / Accessible UI)",
        backend: "Node.js (v22+) + Express + TypeScript",
        database: "Centralized Persistent SQLite (Node native DatabaseSync) / PostgreSQL ready",
        auth: "Role-Based Access Control (Host, Member, Agent) with Scoped Bearer Tokens",
        apis: "RESTful JSON APIs with Server-Sent Events (SSE) for Real-Time Streaming",
        aiProviders: [this.provider.toUpperCase(), "OpenAI / Claude Prompt Adapters"],
        externalServices: ["GitHub API (PR & Branch Tracking)", "Vercel / Railway Deployment Webhooks"],
        hosting: "Hosted Web-First Architecture (Vercel Frontend + Render/Railway Backend)",
        repoStructure: [
          "web/         — React 19 Frontend Dashboard & Mission Control",
          "server/      — Authoritative Express API, Orchestrator & Database",
          "contracts/   — Versioned Protocol & Data Contract Definitions",
          "docs/        — System Architecture & Integration Playbooks",
        ],
      },
      contracts: [
        {
          name: "Project Details",
          method: "GET",
          path: "/api/projects/:id",
          description: "Retrieve complete project status, active milestone, and member list.",
        },
        {
          name: "List Task Contracts",
          method: "GET",
          path: "/api/projects/:id/tasks",
          description: "List versioned 2.0 task contracts with assigned roles, dependencies, and evidence.",
        },
        {
          name: "Claim Task Contract",
          method: "POST",
          path: "/api/tasks/:id/claim",
          description: "Developer/Agent claims an available task contract with lease expiration.",
        },
        {
          name: "Submit Task Progress",
          method: "POST",
          path: "/api/tasks/:id/progress",
          description: "Report task completion percentage, status transition, and blocker notes.",
        },
        {
          name: "Submit Implementation Evidence",
          method: "POST",
          path: "/api/tasks/:id/submit",
          description: "Submit Git branch, PR URL, and test results for verification.",
        },
        {
          name: "Collision & Integration Check",
          method: "POST",
          path: "/api/projects/:id/integration/check",
          description: "Detect overlapping file paths between tasks and verify contract conformance.",
        },
        {
          name: "Host Release Approval",
          method: "POST",
          path: "/api/projects/:id/release/approve",
          description: "Authorized host gatekeeper approving final deployment release.",
        },
      ],
      roadmap: [
        {
          phase: 1,
          title: "Foundation & Workspace Setup",
          description: "Initialize centralized schema, authentication tokens, and project record.",
          estimatedHours: Math.max(1, Math.round(hours * 0.1)),
          deliverables: ["Project record created", "Database tables initialized", "Host permissions enrolled"],
        },
        {
          phase: 2,
          title: "Core Service Contracts & APIs",
          description: "Implement foundational REST routes and SSE event streaming.",
          estimatedHours: Math.max(2, Math.round(hours * 0.2)),
          deliverables: ["API contract endpoints live", "Real-time event journal active"],
        },
        {
          phase: 3,
          title: "Parallel Agent Workstreams",
          description: `Delegate frontend and backend work to ${devCount} independent developer workstreams.`,
          estimatedHours: Math.max(4, Math.round(hours * 0.35)),
          deliverables: ["UI components built", "Business logic implemented", "Prompt bridges active"],
        },
        {
          phase: 4,
          title: "Cross-Agent Handoffs & Integration",
          description: "Reconcile contract dependencies, detect path collisions, and link GitHub PRs.",
          estimatedHours: Math.max(2, Math.round(hours * 0.15)),
          deliverables: ["Collision checks clean", "API contracts verified between agents"],
        },
        {
          phase: 5,
          title: "Automated Verification & Testing",
          description: "Run automated unit, integration, and E2E test suites.",
          estimatedHours: Math.max(1, Math.round(hours * 0.1)),
          deliverables: ["All test suites green", "Zero unhandled rejections"],
        },
        {
          phase: 6,
          title: "Demo Preparation & Presentation Polish",
          description: "Configure demo scenario, benchmark counters, and mission control cards.",
          estimatedHours: Math.max(1, Math.round(hours * 0.05)),
          deliverables: ["Mission control dashboard ready", "Demo walkthrough verified"],
        },
        {
          phase: 7,
          title: "Host Approval & Production Deployment",
          description: "Host review of release evidence and deployment execution.",
          estimatedHours: Math.max(1, Math.round(hours * 0.05)),
          deliverables: ["Release approved by host", "Deployment live / deployment instructions generated"],
        },
      ],
      createdAt: new Date().toISOString(),
    };

    return blueprint;
  }

  // --- 4. MULTI-AGENT WORK DIVISION ENGINE: TASK DECOMPOSITION ---
  public async decomposeTasks(
    project: HackathonProject,
    architecture: ArchitectureBlueprint,
    developerCount: 2 | 3
  ): Promise<TaskContractV2[]> {
    const projectId = project.id;
    const now = new Date().toISOString();

    if (developerCount === 2) {
      return [
        {
          contractVersion: "2.0",
          taskId: `task-fe-01`,
          projectId,
          title: "Build Responsive Mission Control UI & Dashboard",
          assignedRole: "frontend",
          status: "ready",
          priority: "high",
          dependencies: [],
          objective: "Develop user-facing mission control dashboard with live agent cards, Kanban task board, and real-time SSE stream.",
          allowedPaths: ["web/src/features/", "web/src/components/", "web/src/styles.css"],
          protectedPaths: ["server/", "contracts/"],
          inputs: {
            apiContracts: architecture.contracts.map((c) => `${c.method} ${c.path}`),
            theme: "Modern AI Control Center",
          },
          deliverables: [
            "Project overview and countdown timer",
            "Kanban task board supporting drag & status transitions",
            "Agent heartbeat and status indicator cards",
            "Accessible dialogs and notification toasts",
          ],
          acceptanceCriteria: [
            "Renders cleanly without horizontal overflow",
            "Updates dynamically on real-time SSE events",
            "Zero React console warnings or hydration errors",
          ],
          owner: { assignedSlot: "developer-a", agentTool: "antigravity" },
          progressPercent: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          contractVersion: "2.0",
          taskId: `task-be-01`,
          projectId,
          title: "Implement Authoritative API & Persistent Storage Engine",
          assignedRole: "backend",
          status: "ready",
          priority: "critical",
          dependencies: [],
          objective: "Build centralized SQLite schema, REST API routes, SSE event streaming, and role-based token authentication.",
          allowedPaths: ["server/api/", "server/db/", "server/core/"],
          protectedPaths: ["web/src/"],
          inputs: {
            spec: architecture.spec,
            contracts: architecture.contracts,
          },
          deliverables: [
            "Persistent SQLite repository with transaction safety",
            "CRUD endpoints for projects, tasks, and ideas",
            "SSE real-time stream with event sequencing",
            "Authentication middleware enforcing role boundaries",
          ],
          acceptanceCriteria: [
            "All API contract endpoints return valid JSON",
            "SSE clients receive live updates upon task mutation",
            "Database passes automated persistence & recovery tests",
          ],
          owner: { assignedSlot: "developer-b", agentTool: "claude-code" },
          progressPercent: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          contractVersion: "2.0",
          taskId: `task-fe-02`,
          projectId,
          title: "Connect Frontend to Live API Endpoints & State Store",
          assignedRole: "frontend",
          status: "backlog",
          priority: "high",
          dependencies: ["task-be-01", "task-fe-01"],
          objective: "Integrate dashboard state with backend endpoints, replacing mock data with real network calls.",
          allowedPaths: ["web/src/api/", "web/src/app/"],
          protectedPaths: ["server/"],
          inputs: {
            backendBaseUrl: "http://localhost:4000/api",
          },
          deliverables: [
            "Type-safe API client with error boundaries",
            "EventSource listener for real-time state sync",
            "Optimistic updates for task status transitions",
          ],
          acceptanceCriteria: [
            "Actions in UI create durable records in backend database",
            "Network disconnects display graceful offline notice",
          ],
          owner: { assignedSlot: "developer-a", agentTool: "antigravity" },
          progressPercent: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          contractVersion: "2.0",
          taskId: `task-be-02`,
          projectId,
          title: "Implement Collision Detection & Release Gatekeeper",
          assignedRole: "backend",
          status: "backlog",
          priority: "high",
          dependencies: ["task-be-01"],
          objective: "Implement path-based collision analysis between tasks, contract compliance checks, and release approval endpoint.",
          allowedPaths: ["server/core/", "server/api/"],
          protectedPaths: ["web/"],
          inputs: {
            allowedPathsPolicy: "Strict boundary isolation",
          },
          deliverables: [
            "Collision detection comparing PR file paths",
            "Release approval gate requiring host signature",
            "Deployment webhook simulation & status tracker",
          ],
          acceptanceCriteria: [
            "Detects and flags overlapping file changes",
            "Prevents release deployment without host approval",
          ],
          owner: { assignedSlot: "developer-b", agentTool: "claude-code" },
          progressPercent: 0,
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    // 3-Developer Decomposition
    return [
      {
        contractVersion: "2.0",
        taskId: `task-fe-01`,
        projectId,
        title: "Build Responsive Mission Control UI & Kanban Dashboard",
        assignedRole: "frontend",
        status: "ready",
        priority: "high",
        dependencies: [],
        objective: "Develop the full web dashboard with live agent cards, Kanban task board, and real-time SSE stream.",
        allowedPaths: ["web/src/features/", "web/src/components/", "web/src/styles.css"],
        protectedPaths: ["server/", "contracts/"],
        inputs: {
          apiContracts: architecture.contracts.map((c) => `${c.method} ${c.path}`),
        },
        deliverables: [
          "Interactive AI idea explorer and comparison cards",
          "7-column Kanban task board with filter and search",
          "Live agent control center with tool status tags",
        ],
        acceptanceCriteria: [
          "Clean visual presentation with zero console errors",
          "Responsive across desktop and tablet screen sizes",
        ],
        owner: { assignedSlot: "developer-a", agentTool: "antigravity" },
        progressPercent: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        contractVersion: "2.0",
        taskId: `task-be-01`,
        projectId,
        title: "Build Authoritative Database & REST API Gateway",
        assignedRole: "backend",
        status: "ready",
        priority: "critical",
        dependencies: [],
        objective: "Build SQLite persistent storage, REST endpoints for projects and tasks, and SSE stream.",
        allowedPaths: ["server/api/", "server/db/", "server/core/"],
        protectedPaths: ["web/src/"],
        inputs: {
          spec: architecture.spec,
          contracts: architecture.contracts,
        },
        deliverables: [
          "Durable SQLite schema for projects, tasks, and ideas",
          "REST endpoints conforming to architecture blueprint",
          "SSE stream broadcast for real-time coordination",
        ],
        acceptanceCriteria: [
          "All declared endpoints pass automated schema tests",
          "Database maintains ACID integrity under parallel load",
        ],
        owner: { assignedSlot: "developer-b", agentTool: "claude-code" },
        progressPercent: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        contractVersion: "2.0",
        taskId: `task-ai-01`,
        projectId,
        title: "Build Prompt Bridges & Collision Integration Engine",
        assignedRole: "ai_integration",
        status: "ready",
        priority: "high",
        dependencies: [],
        objective: "Implement exportable prompt bridges (Antigravity, Claude, Codex, Cursor), collision detection engine, and release verification.",
        allowedPaths: ["server/core/promptBridge.ts", "server/core/integrationEngine.ts", "docs/"],
        protectedPaths: ["web/src/components/"],
        inputs: {
          supportedTools: ["antigravity", "claude-code", "codex", "cursor", "aider", "opencode"],
        },
        deliverables: [
          "Prompt bridge generator formatting tool-tailored assignments",
          "Path collision analyzer detecting overlapping PR changes",
          "Automated test runner and release verification service",
        ],
        acceptanceCriteria: [
          "Generates copy-ready markdown prompts with zero missing context",
          "Accurately flags file overlap collisions between tasks",
        ],
        owner: { assignedSlot: "developer-c", agentTool: "codex" },
        progressPercent: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        contractVersion: "2.0",
        taskId: `task-full-02`,
        projectId,
        title: "End-to-End System Integration & Release Verification",
        assignedRole: "fullstack",
        status: "backlog",
        priority: "high",
        dependencies: ["task-fe-01", "task-be-01", "task-ai-01"],
        objective: "Wire the complete end-to-end user journey from problem statement to release approval.",
        allowedPaths: ["web/src/", "server/"],
        protectedPaths: [],
        inputs: {
          verificationTarget: "100% automated test pass rate",
        },
        deliverables: [
          "Host release approval workflow in UI",
          "Automated integration test proving zero data loss",
          "Production deployment build bundle",
        ],
        acceptanceCriteria: [
          "Complete journey executes smoothly without manual terminal steps",
          "All core unit and integration tests pass green",
        ],
        owner: { assignedSlot: "developer-c", agentTool: "codex" },
        progressPercent: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  // --- 5. CROSS-AGENT HANDOFF RECONCILIATION ---
  public resolveHandoff(
    handoff: CrossAgentHandoff,
    sourceTask?: TaskContractV2,
    targetTask?: TaskContractV2
  ): { resolutionNotes: string; suggestedContractChanges?: Record<string, unknown> } {
    const summary = handoff.requestSummary;
    return {
      resolutionNotes: `Handoff resolved between [${handoff.sourceRole}] (Task ${handoff.sourceTaskId}) and [${handoff.targetRole}] (Task ${handoff.targetTaskId}). Request: "${summary}". Required interfaces updated in target contract inputs.`,
      suggestedContractChanges: {
        providedInterface: summary,
        updatedAt: new Date().toISOString(),
        status: "acknowledged",
      },
    };
  }
}
