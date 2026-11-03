# Hackathon demonstration walkthrough

Use the official app at http://127.0.0.1:5175. Startup and pairing details:
[FINAL_LAUNCH_GUIDE.md](FINAL_LAUNCH_GUIDE.md).

1. Open Network & queue. Verify a real device UUID, coordinator reachability and
   session status. Reviewer authority must say it was verified with the coordinator.
2. Create a clearly named demo task. Observe queued acceptance separately from
   authoritative delivery, then open its current revision in Tasks.
3. Send a team message. See its actual sender, timestamp and delivered content.
4. Open Activity; verify task/message events arrived without a manual page reload.
5. For the disposable repair, open a new task and set Workspace ID `demo-source`
   and Test profile ID `demo-check`, then Start run.
6. Inspect actual baseline failure, bounded heuristic result and safe patch.
7. Approve as the independently enrolled reviewer. The task stays review and the
   integration HEAD remains unchanged at this point.
8. Apply with Target workspace ID `demo-integration` and profile `demo-check`.
   Verify passing evidence, an actual Git commit, verified application and done.
9. Reload: task/patch/evidence must persist. The developer source checkout is never
   used as the application target.
10. Demonstrate offline restart/conflict recovery using two independent device
    services. The automated actual-service suites exercise this locally; physical
    Arhaan-machine testing remains pending.

The Git fixture supports one application from its original base. Stop the previous
managed launch and run `npm run demo:new` for a fresh rehearsal. All previous
records are retained; this never deletes user data or checkpoints.

Projects and Handoffs are now actual official pages, approved by the human.
Create a project; register a device-owned agent on each participating device;
create/assign the two tasks using Owner ID; send a handoff with its associated
and dependent tasks plus project context. The receiving device acknowledges it.
Both UIs update from actual persisted records. Registration does not start an AI
runtime. The local two-device browser test verifies this flow, forged-sender
rejection, reload persistence and offline/reconnect guards.

The legacy `test:demo` remains an explicitly scripted contract demonstration,
not evidence that independent AI agents performed implementation work.
