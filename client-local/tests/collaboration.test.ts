import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readProxyPath } from "../src/server.ts";
import { LocalStore } from "../src/store.ts";

test("collaboration read allowlist rejects unknown routes, query injection and repeated filters", () => {
  const read = (route: string) => readProxyPath(new URL(route, "http://127.0.0.1"));
  assert.equal(read("/api/projects"), "/api/projects");
  const id = randomUUID(); assert.equal(read(`/api/projects/${id}`), `/api/projects/${id}`);
  assert.equal(read("/api/handoffs?toAgent=backend-a"), "/api/handoffs?toAgent=backend-a");
  for (const route of ["/api/projects?url=https://example.com", `/api/projects/${id}?command=whoami`, "/api/handoffs?toAgent=a&toAgent=b", "/api/handoffs?toAgent=" + "x".repeat(201), "/api/handoffs?taskId=not-uuid"]) assert.throws(() => read(route));
  assert.equal(read("/api/projects/anything/execute"), undefined);
});

test("collaboration cache invalidation preserves unrelated canonical task cache", () => {
  const store = new LocalStore(":memory:");
  try {
    store.cacheWrite("/api/projects", [{ id: randomUUID() }]);
    store.cacheWrite("/api/handoffs?toAgent=peer", []);
    store.cacheWrite("/api/tasks", [{ id: randomUUID(), title: "unchanged" }]);
    store.invalidateCollaborationReads();
    assert.equal(store.cacheRead("/api/projects"), undefined);
    assert.equal(store.cacheRead("/api/handoffs?toAgent=peer"), undefined);
    assert.equal(store.cacheRead("/api/tasks")?.body[0].title, "unchanged");
    assert.equal(store.batch().length, 0);
  } finally { store.close(); }
});
