# Future Transports Architecture & Extension Guide

Upside-Down 2.0 decouples the coordination protocol (`UD-IC/2.0`) and state reduction engine (`CoordinationReducer`) from the physical communication medium via the **`AgentTransport`** abstraction.

While Phase 5 establishes **GitHub as the authoritative MVP transport**, this document outlines the architecture and blueprint for supporting alternate and hybrid transports in future releases.

---

## 1. The `AgentTransport` Interface

Located in `server/core/github/transport.ts`:

```typescript
export interface AgentTransport {
  // Discovery & Identity
  whoami(): Promise<{ id: string; login: string }>;
  
  // Issue & Conversation Management
  createIssue(title: string, body: string, labels: string[], assignees?: string[]): Promise<IssueInfo>;
  getIssue(number: number): Promise<IssueInfo>;
  listIssues(labels: string[]): Promise<IssueInfo[]>;
  updateIssue(number: number, updates: Partial<{ title: string; body: string; state: 'open' | 'closed' }>): Promise<void>;
  
  // Message & Comment Stream
  postComment(issueNumber: number, body: string, messageId?: string): Promise<CommentInfo>;
  listComments(issueNumber: number, since?: string): Promise<CommentInfo[]>;
  
  // Pull Request & Evidence Verification
  getPullRequest(number: number): Promise<PullRequestInfo>;
  getCombinedStatus(ref: string): Promise<CiStatusInfo>;
  listCheckRuns(ref: string): Promise<CheckRunInfo[]>;
  
  // Cache & Offline Outbox Controls
  flushOutbox?(): Promise<number>;
  getOutboxCount?(): Promise<number>;
}
```

Because all coordination logic depends solely on `AgentTransport`, alternative communication layers can be plugged in without rewriting or modifying the state reducer, prompt bridges, or web dashboards.

---

## 2. Planned Future Transports

### A. `LocalTransport` (Direct Shared Filesystem / SQLite)
- **Use Case:** Single-machine multi-agent evaluation, isolated local offline development, or CI runners without internet connectivity.
- **Mechanism:** Implements `createIssue` and `postComment` as rows in a local SQLite database (`local_coordination.db`) or shared directory (`.upside-down/messages/*.json`).
- **Benefits:** Instant zero-latency delivery, zero API rate limits, complete offline autonomy.

### B. `WebSocketTransport` (Low-Latency Peer-to-Peer / Relay)
- **Use Case:** High-speed pair programming sessions, live token-by-token code streaming, or interactive real-time debugging.
- **Mechanism:** Coordinates over an encrypted WebSocket broker or WebRTC data channels.
- **Hybrid Strategy:** Uses GitHub Issues as the immutable record of truth and state anchor, with WebSockets used as an acceleration layer for sub-second notifications.

### C. `MCPTransport` (Model Context Protocol Direct Tools)
- **Use Case:** Seamless native agent integration via Anthropic / OpenAI Model Context Protocol.
- **Mechanism:** Exposes the Agent Bridge commands as first-class MCP tools:
  - `upside_down_ack_task`
  - `upside_down_report_progress`
  - `upside_down_request_handoff`
  - `upside_down_submit_pr`
- **Benefits:** Agents can invoke actions directly from their tool loop without needing to execute terminal shell commands or copy-paste text blocks.
