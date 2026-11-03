# Backend B sync ingress

Install with `npm --prefix server/sync ci`. Run router tests with
`npm --prefix server/sync test`.

Export: `createSyncRouter(gateway, authenticate)` in `router.ts`; mount at `/api/sync`.
Authentication sets `res.locals.principal`. The adapter validates before invoking the
gateway and processes each event sequentially. It owns no coordinator tables.

See `../../client-local/README.md` for the exact A/frontend handoff, unresolved gateway
watermark/idempotency details, test evidence boundaries, and local service setup.
This module alone does not implement coordinator-side durable deduplication or mutations.
