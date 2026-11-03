/**
 * Multi-Agent Collaboration Demonstration Test Suite
 * Protocol Version: 3.0 / Phase 3 Integration
 * Demonstrates:
 * 1. Agent A receives a backend task
 * 2. Agent B receives a frontend task
 * 3. Both agents acknowledge assignments
 * 4. Progress appears in the interface / event stream
 * 5. Agent A completes task via proposed patch
 * 6. User approves patch, moving backend task to done
 * 7. Agent B receives relevant structured handoff
 * 8. System records all activity and persists state
 */

import { createServer } from "../index.ts";
import http from "node:http";

async function runDemoTest() {
  console.log("\n=== PHASE 3: MULTI-AGENT COLLABORATION DEMONSTRATION ===");

  const { app } = createServer(":memory:");
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  console.log(`[DEMO SERVER] Running on ${baseUrl}`);

  try {
    // Helper function for HTTP requests
    async function api(path: string, method: string = "GET", body?: unknown): Promise<{ status: number; data: any }> {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data: any = await res.json();
      return { status: res.status, data };
    }

    // Step 1: Verify Initial Project Setup
    console.log("\n[STEP 1] Initializing Project & Registering Independent Agents...");
    const projRes = await api("/projects", "POST", {
      name: "Upside-Down Core Integration",
      description: "Demonstrating autonomous multi-agent handoff and collaboration",
    });
    if (projRes.status !== 201) throw new Error(`Project creation failed: ${JSON.stringify(projRes)}`);
    console.log(`  [PASS] Project created: '${projRes.data.name}' (ID: ${projRes.data.id})`);

    // Register Agent A (Backend Specialist) and Agent B (Frontend Specialist)
    const agentARes = await api("/agents/register", "POST", {
      id: "agent-backend-codex",
      name: "Backend Agent (Codex)",
      status: "idle",
      runtimeAvailable: true,
    });
    const agentBRes = await api("/agents/register", "POST", {
      id: "agent-frontend-claude",
      name: "Frontend Agent (Claude)",
      status: "idle",
      runtimeAvailable: true,
    });
    if (agentARes.status !== 200 || agentBRes.status !== 200) {
      throw new Error("Agent registration failed");
    }
    console.log("  [PASS] Registered Agent A (@agent-backend-codex) and Agent B (@agent-frontend-claude)");

    // Step 2: Task Creation & Assignment
    console.log("\n[STEP 2] Creating and Assigning Specialized Tasks...");
    const taskARes = await api("/tasks", "POST", {
      title: "Implement Authentication REST Endpoint & Schema",
      description: "Create /api/auth/login with session token validation and JWT signing.",
      ownerId: "agent-backend-codex",
    });
    const taskBRes = await api("/tasks", "POST", {
      title: "Build Login Dialog & State Integration",
      description: "Implement interactive login modal that consumes the /api/auth/login contract.",
      ownerId: "agent-frontend-claude",
    });
    if (taskARes.status !== 201 || taskBRes.status !== 201) {
      throw new Error("Task creation failed");
    }
    const taskA = taskARes.data;
    const taskB = taskBRes.data;
    console.log(`  [PASS] Task A created: '${taskA.title}' assigned to ${taskA.ownerId}`);
    console.log(`  [PASS] Task B created: '${taskB.title}' assigned to ${taskB.ownerId}`);

    // Step 3: Agents Acknowledge Assignments & Report Progress
    console.log("\n[STEP 3] Agents Acknowledge Assignments and Begin Execution...");
    const ackA = await api(`/tasks/${taskA.id}/transition`, "POST", {
      targetStatus: "running",
      baseRevision: taskA.revision,
      ownerId: "agent-backend-codex",
      reason: "Agent A acknowledged task assignment and started implementation",
    });
    const ackB = await api(`/tasks/${taskB.id}/transition`, "POST", {
      targetStatus: "assigned",
      baseRevision: taskB.revision,
      ownerId: "agent-frontend-claude",
      reason: "Agent B acknowledged task assignment (awaiting backend contract handoff)",
    });
    if (ackA.status !== 200 || ackB.status !== 200) {
      throw new Error(`Task acknowledgment failed: A=${ackA.status}, B=${ackB.status}`);
    }
    console.log(`  [PASS] Agent A status: Task A transitioned to RUNNING (Rev: v${ackA.data.revision})`);
    console.log(`  [PASS] Agent B status: Task B transitioned to ASSIGNED (Rev: v${ackB.data.revision})`);

    // Step 4: Agent A Completes Task & Proposes Code Patch
    console.log("\n[STEP 4] Agent A Proposes Code Patch for Verification & Review...");
    const sampleDiff = `--- a/server/api/auth.ts
+++ b/server/api/auth.ts
@@ -0,0 +1,12 @@
+export interface AuthSession {
+  userId: string;
+  token: string;
+  expiresAt: string;
+}
+
+export function authenticateUser(credentials: { user: string; pass: string }): AuthSession {
+  return {
+    userId: "user-101",
+    token: "tok_secure_session_token_xyz",
+    expiresAt: new Date(Date.now() + 3600000).toISOString()
+  };
+}`;

    const patchRes = await api("/patches", "POST", {
      taskId: taskA.id,
      runId: "run-backend-auth-001",
      diffContent: sampleDiff,
      testOutput: "PASS: 4/4 auth unit tests passed in 48ms.",
    });
    if (patchRes.status !== 201) throw new Error(`Patch proposal failed: ${JSON.stringify(patchRes)}`);
    console.log(`  [PASS] Patch proposed (ID: ${patchRes.data.id}). Task A transitioned to REVIEW.`);

    // Verify Task A is now in Review
    const taskAReview = await api(`/tasks/${taskA.id}`);
    if (taskAReview.data.status !== "review") {
      throw new Error(`Expected Task A to be 'review', got '${taskAReview.data.status}'`);
    }

    // Step 5: User/Lead Reviews and Approves the Patch
    console.log("\n[STEP 5] Human/Lead Reviews and Approves Proposed Patch...");
    const approveRes = await api(`/patches/${patchRes.data.id}/approve`, "POST", {
      reviewerId: "lead-engineer",
    });
    if (approveRes.status !== 200) throw new Error(`Patch approval failed: ${JSON.stringify(approveRes)}`);

    const taskADone = await api(`/tasks/${taskA.id}`);
    if (taskADone.data.status !== "done") {
      throw new Error(`Expected Task A to be 'done', got '${taskADone.data.status}'`);
    }
    console.log(`  [PASS] Patch approved by '${approveRes.data.reviewerId}'. Task A transitioned to DONE (Rev: v${taskADone.data.revision}).`);

    // Step 6: Agent A Issues Structured Handoff to Agent B
    console.log("\n[STEP 6] Agent A Generates Structured Handoff to Agent B...");
    const handoffRes = await api("/handoffs", "POST", {
      fromAgent: "agent-backend-codex",
      toAgent: "agent-frontend-claude",
      taskId: taskA.id,
      dependentTaskId: taskB.id,
      handoffType: "task_completed",
      summary: "Authentication API endpoints (/api/auth/login) are deployed and verified. Frontend integration unblocked.",
      payload: {
        endpoint: "/api/auth/login",
        method: "POST",
        schemaVersion: "1.0.0",
        sampleResponse: { userId: "user-101", token: "tok_secure_session_token_xyz" },
      },
    });
    if (handoffRes.status !== 201) throw new Error(`Handoff creation failed: ${JSON.stringify(handoffRes)}`);
    const handoff = handoffRes.data;
    console.log(`  [PASS] Structured handoff created: '${handoff.summary}'`);
    console.log(`  [PASS] Recipient: @${handoff.toAgent} | Contract Version: ${handoff.contractVersion}`);

    // Step 7: Agent B Retrieves Handoff and Starts Frontend Work
    console.log("\n[STEP 7] Agent B Ingests Handoff and Advances Frontend Task...");
    const inboxRes = await api("/handoffs?toAgent=agent-frontend-claude");
    if (inboxRes.status !== 200 || inboxRes.data.length === 0) {
      throw new Error("Agent B failed to receive handoff");
    }
    const receivedHandoff = inboxRes.data[0];
    console.log(`  [PASS] Agent B received handoff ID: ${receivedHandoff.id} from @${receivedHandoff.fromAgent}`);

    // Agent B transitions its task to running with handoff context
    const taskBRunning = await api(`/tasks/${taskB.id}/transition`, "POST", {
      targetStatus: "running",
      baseRevision: ackB.data.revision,
      ownerId: "agent-frontend-claude",
      reason: `Unblocked by backend handoff #${receivedHandoff.id}`,
    });
    if (taskBRunning.status !== 200) throw new Error("Agent B task transition failed");
    console.log(`  [PASS] Task B transitioned to RUNNING (Rev: v${taskBRunning.data.revision})`);

    // Step 8: Verify Complete Event Stream & Durable Activity Log
    console.log("\n[STEP 8] Verifying Durable Event Stream & Audit Trail...");
    const eventsRes = await api("/events?limit=50");
    if (eventsRes.status !== 200) throw new Error("Failed to fetch events");
    const eventTypes = eventsRes.data.map((e: { type: string }) => e.type);
    console.log(`  [PASS] Total Activity Events Logged: ${eventsRes.data.length}`);
    console.log(`  [PASS] Observed Event Sequence: [${Array.from(new Set(eventTypes)).join(", ")}]`);

    console.log("\n>>> MULTI-AGENT COLLABORATION DEMONSTRATION: 100% SUCCESSFUL <<<");
  } finally {
    server.close();
  }
}

runDemoTest().catch((err) => {
  console.error("\n❌ DEMONSTRATION FAILED:", err);
  process.exit(1);
});
