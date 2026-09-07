# Security events

Courtside writes security events as structured ECS JSON to its normal application log. The
versioned catalogue at `src/main/resources/security/security-events.json` is the contract for event
codes, severity, result, allowed fields and typed reason or action values. A contract test keeps the
shipped catalogue and the runtime emitters identical. Standard ECS envelope fields such as the
timestamp, logger identity and request trace are supplied by the logging framework rather than the
event payload.

The events cover authentication decisions, authorization refusals, session termination,
credential issuance, replacement and withdrawal, administrative security changes, triggered rate
protections and concrete refusals by rate, CSRF and request-validation controls. A known account is named only by its
immutable `account.id`; an administrative actor uses `actor.account.id`. Request-bound events
inherit the short-lived `traceId` and `spanId` from the normal logging context.

For `courtside.control.triggered`, `event.outcome=success` means the protection or observation was
successfully activated; it does not mean that the submitted operation succeeded. Concrete rejected
requests use `courtside.control.refused` with `event.outcome=failure`.

These events deliberately exclude usernames, email and IP addresses, credentials, tokens, request
bodies and raw User-Agent strings. An authentication attempt for an unknown identifier contains no
submitted identifier. Event callers accept typed reasons and actions rather than arbitrary text, so
request data cannot add fields or log structure.

## Application and operator responsibilities

Courtside produces the event and writes it to standard output. It does not claim delivery to an
external system and does not include a log shipper, durable queue, retention policy or alerting
service. The reference deployment therefore makes no synchronous external delivery call that can
block club operations. An operator who replaces the standard-output path is responsible for
preserving that outage behavior.

An operator can retain and route standard output with a Docker logging driver, a sidecar or another
collector. A collector may transform the ECS record into OTLP or another supported destination.
Those are optional deployment choices: the operator decides transport security, storage, access,
retention, alert thresholds and escalation. Evidence from one installation establishes only the
transport configured for that installation.

When defining alerts, select the stable `event.code` and, where useful, the typed `event.reason` or
`event.action`. Do not derive alerts from the human-readable message, which is intentionally fixed
at `Security event`.
