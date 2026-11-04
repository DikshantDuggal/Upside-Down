# Transport boundary and future work

Only GitHubTransport implements the Phase5 agent transport. No new local,
WebSocket, peer-to-peer or MCP agent transport was added. Legacy application
networking is preserved; Phase5 coordination does not depend on it.

The actual interface in `server/core/github/transport.ts` is:

```typescript
interface AgentTransport {
  send(message: AgentMessage, issue: number): Promise<SendResult>;
  receive(issue: number): Promise<ReceivedMessageBatch>;
  acknowledge(message: AgentMessage, issue: number): Promise<SendResult>;
  getStatus(): Promise<{
    login: string;
    repository: string;
    authenticated: boolean;
  }>;
}
```

SendResult contains the remote comment and whether it was reconciled. The receive
batch contains remote comments and a source cursor. Acknowledging explicitly
publishes a validated protocol message, not a hidden read receipt. GitHubApi is
separately injectable for deterministic fixtures. The browser consumes service
DTOs; the reducer consumes envelopes and independently obtained author/PR data.

Future LocalTransport, WebSocketTransport or MCPTransport needs a separately
approved phase with provenance, replay, idempotent writes, durable cursors,
bounded retries, permissions and audit. GitHub-specific issue bootstrap and PR
verification remain in the coordination service, so another transport still
requires integration work. There are no placeholder implementations claiming
these features work today. GitHub remains authoritative for this MVP.
