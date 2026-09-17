# Funnel recipe

Choose `funnel` when Tailscale Funnel supplies the public HTTPS endpoint. PostgreSQL remains bundled
and mail uses an external SMTP relay. Courtside Caddy listens only on `127.0.0.1:8080` and remains
the policy boundary in front of the application.

Install with a `funnel` answer file, then publish the Caddy listener persistently:

```sh
tailscale funnel --bg http://127.0.0.1:8080
```

The `--bg` setting survives the terminal session. Record the Funnel configuration alongside the
club's recovery procedure because it belongs to the host, not the Courtside installation.

Do not point Funnel directly at the application container or its management port. Direct Funnel
would expose a different API and management boundary and would bypass Caddy's host, request-size,
forwarded-header and response-header policy. Only the loopback Caddy listener is supported.

`doctor` verifies the local listener and configuration. Tailnet policy, the public Funnel service,
public routing and remote availability remain operator-owned. Report an unavailable remote probe as
`WARN` or `unknown`; it does not turn the locally verified Courtside path into a failure or a pass.

Stop publication with `tailscale funnel reset` only after confirming that no other Funnel handler
shares that host. Courtside never changes Tailscale configuration itself.
