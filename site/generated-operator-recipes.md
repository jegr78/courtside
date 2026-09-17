# Generierte Rezeptbefehle

Aus den Rezeptdateien der Deployment-CLI erzeugt. Bearbeite diese Datei nicht direkt.

| Rezept | Webzugang | Datenbank | E-Mail |
| --- | --- | --- | --- |
| `existing-infrastructure` | `external` | `external` | `smtp-relay` |
| `full-self-hosted` | `caddy` | `bundled` | `stalwart` |
| `funnel` | `funnel` | `bundled` | `smtp-relay` |
| `standard` | `caddy` | `bundled` | `smtp-relay` |

## `existing-infrastructure`

```sh
./recipe.sh files existing-infrastructure
```

Aufgelöste Compose-Dateien: `compose.yaml:compose.external-database.yaml:compose.caddy.yaml:compose.caddy-forwarded.yaml:compose.smtp-relay.yaml`.

## `full-self-hosted`

```sh
./recipe.sh files full-self-hosted
```

Aufgelöste Compose-Dateien: `compose.yaml:compose.caddy.yaml:compose.caddy-public.yaml:compose.stalwart.yaml`.

## `funnel`

```sh
./recipe.sh files funnel
```

Aufgelöste Compose-Dateien: `compose.yaml:compose.caddy.yaml:compose.caddy-forwarded.yaml:compose.smtp-relay.yaml`.

## `standard`

```sh
./recipe.sh files standard
```

Aufgelöste Compose-Dateien: `compose.yaml:compose.caddy.yaml:compose.caddy-public.yaml:compose.smtp-relay.yaml`.
