# Courtside selbst betreiben

Diese Anleitung hilft dir, das passende Deployment-Rezept auszuwählen und eine Installation zu
prüfen. Die englischen Dateien im Release-Archiv bleiben die technische Referenz. Lade das Archiv
von der Release-Seite herunter und prüfe Attestierung und SHA-256-Prüfsumme, bevor du es entpackst.

## Das passende Rezept

| Situation | Rezept |
| --- | --- |
| Ein Linux-Host, mitgeliefertes PostgreSQL, externer SMTP-Relay | `standard` |
| Ein Linux-Host mit PostgreSQL und eigenem Stalwart-Mailserver | `full-self-hosted` |
| Vorhandener HTTPS-Eingang, PostgreSQL 18 und SMTP-Dienst | `existing-infrastructure` |
| Öffentlicher Zugang über Tailscale Funnel | `funnel` |

Die [generierten Rezeptbefehle](generated-operator-recipes.md) stammen aus denselben Rezeptdateien,
die auch die Deployment-CLI liest. Dadurch können Anleitung und tatsächlich gestartete
Compose-Dateien nicht unbemerkt auseinanderlaufen.

## Installation

Lege ein privates Zielverzeichnis an und starte den Launcher aus dem entpackten Archiv:

```sh
sudo install -d -m 0700 -o "$USER" /srv/courtside
./courtside --directory /srv/courtside init
```

`init` prüft deine Antworten, zeigt den Plan und wartet auf eine Bestätigung. Kennwörter gehören
nicht in eine Antwortdatei. Übergib sie nur als Umgebungsvariablen an den laufenden Prozess. Nutze
danach immer den installierten Launcher:

```sh
/srv/courtside/current/courtside doctor
/srv/courtside/current/courtside up
/srv/courtside/current/courtside status
```

Melde dich mit dem einmaligen Bootstrap-Kennwort an und ersetze es sofort. Erstelle anschließend
eine Recovery Unit, prüfe sie mit `restore-check` und entferne die Bootstrap-Werte mit
`finalize-bootstrap --yes`.

## Backups und Updates

```sh
/srv/courtside/current/courtside backup --retain 7
/srv/courtside/current/courtside restore-check --recovery <Recovery-Verzeichnis>
candidate=/srv/courtside/candidate/courtside-deployment-<Version>
"$candidate/courtside" --directory /srv/courtside update --archive "$candidate" --yes
```

Ein Update erstellt zuerst eine Recovery Unit. Es verspricht kein automatisches Datenbank-Downgrade,
falls eine neue Anwendungsmigration bereits gelaufen ist. Beim gebündelten Wechsel von PostgreSQL 17
auf 18 stellt der Launcher den Dump dagegen in einem neuen Volume wieder her und aktiviert bei einem
fehlgeschlagenen Zielstart automatisch das unangetastete PostgreSQL-17-Volume. Bewahre die vorherige
Release-Version auf und prüfe die Wiederherstellung regelmäßig auf einem leeren PostgreSQL-18-Ziel.

Alte Releases und Recovery Units räumt `prune` auf. Es behält die neuesten Recovery Units, sieben,
wenn `--retain` nichts anderes sagt. Eine Recovery Unit, die du selbst kopiert oder umbenannt hast,
lässt es stehen. Es behält das laufende Release, die Version vor dem letzten Update und jedes Release,
das eine verbleibende Recovery Unit zum Prüfen braucht. `--dry-run` zeigt vorher, was wegfiele:

```sh
/srv/courtside/current/courtside prune --retain 3 --dry-run
/srv/courtside/current/courtside prune --retain 3
```

Für Abnahmetests stellt jeder Nightly-Lauf, der ein neues Image baut und qualifiziert, 14 Tage lang
das Artefakt `nightly-deployment-archive` bereit. Lade es aus einem erfolgreichen Lauf auf `main`.
Seine Version `<Release-Kern>-nightly.<Lauf-ID>` kann der Launcher eindeutig mit späteren Nightlies
vergleichen. Artefakte aus Branch-Läufen dienen nur der Workflow-Prüfung und werden vom offiziellen
Launcher abgewiesen.

## Tailscale Funnel

Das Funnel-Rezept veröffentlicht ausschließlich den lokalen Caddy-Eingang:

```sh
tailscale funnel --bg http://127.0.0.1:8080
```

`--bg` hält den Dienst unabhängig von deiner Shell-Sitzung aktiv. Richte Funnel nie direkt auf den
Anwendungs- oder Management-Port. Sonst umgehst du Caddys Prüfung von Host, Anfragegröße,
Forwarding-Headern und Antwort-Headern und schaffst eine andere API- und Management-Grenze.

## Was Courtside prüfen kann

`doctor --json` trennt Fehler der Courtside-Konfiguration von Bedingungen, die du betreibst. Dazu
gehören öffentliches DNS, Firewall und Routing, Zertifikatsausstellung, externe Datenbanken,
SMTP-Anbieter und E-Mail-Reputation. Wenn eine solche Bedingung nicht messbar ist, lautet das
Ergebnis `WARN` oder `unknown`, niemals automatisch `PASS`.

Courtside installiert keine Pakete, ändert keine Firewall- oder DNS-Regel, lädt keine Diagnose hoch
und aktiviert keine Zeitsteuerung. Die Beispiele für systemd und cron im Archiv bleiben inaktiv,
bis du sie prüfst, kopierst und selbst einschaltest.
