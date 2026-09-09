# Resource-demand decisions

Courtside keeps the machine-readable inventory in
[`../security/resource-demand-inventory.json`](../security/resource-demand-inventory.json). The
contract derives HTTP entry points from OpenAPI and scheduled or asynchronous entry points from
their production annotations. A new entry point therefore fails the tooling check until it is
classified exactly once.

The inventory calls an operation demanding when its cost grows materially with tenant data, input
size, cryptographic work, an external dependency or fan-out. Each such group states the applicable
input or data bound, concurrency or rate bound, execution model, failure behavior and relationship
to caller or proxy timeouts. Asynchronous executor queues are finite and use caller-run
backpressure, so saturation cannot turn into an unbounded in-memory backlog. The `ordinary-http`
class is still a reviewed decision: it covers only
single-record work and contract-bounded pages or calendar windows.

The inventory is descriptive, not a claim that every demanding operation has a dedicated limiter.
The reference deployment has finite container and database resources, but bulk administrative
exports, impact counts, global session revocation and retention sweeps intentionally say when no
per-operation ceiling exists. They are not exposed as anonymous bulk work, and the current review
found no bypass of their authorization, input bounds or transactional behavior. A future change
that makes one of those paths remotely amplifiable must add the product control in the same change;
changing prose cannot make the closed production-entry-point check pass.

The reference Caddy configuration does not manufacture a response timeout as a substitute for an
operation bound. Dependency deadlines, database lock waits and explicit request limits remain
separate controls. Where a synchronous caller disconnects, Courtside does not promise that every
server-side step is cancelled; retries depend on the operation's transaction, stable identity and
idempotency behavior recorded in the inventory.
