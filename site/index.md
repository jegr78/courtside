---
layout: home
hero:
  name: Courtside
  text: Platzbuchung für Sportvereine
  tagline: Ein Verein, eine Instanz, die eigenen Regeln.
  actions:
    - theme: brand
      text: Was Courtside ist
      link: "#was-courtside-ist"
    - theme: alt
      text: Quellcode
      link: https://github.com/jegr78/courtside
features:
  - title: Der Platzplan gehört dem Verein
    details: Plätze, Öffnungszeiten, Buchungsarten und Regeln sind Zeilen in der Datenbank, keine Zeilen im Code. Was ein Vorstand ändern möchte, ändert er selbst.
  - title: Zwei Buchungen kollidieren nie
    details: Dass ein Platz nicht doppelt belegt wird, garantiert PostgreSQL selbst. Das ist keine Prüfung in der Anwendung, die ein gleichzeitiger Zugriff überholen könnte.
  - title: Jede Instanz gehört ihrem Verein
    details: Courtside steht unter der AGPL-3.0 und wird als Container-Image mit einer Referenz-Installation ausgeliefert. Es gibt keinen zentralen Dienst, bei dem die Daten eines Vereins landen.
---

## Was Courtside ist {#was-courtside-ist}

Courtside ist eine Platzbuchung für Sportvereine. Jeder Verein betreibt seine eigene Instanz: eine
Datenbank, ein Container, die Mitglieder des Vereins und niemand sonst.

## Diese Seite wird gerade geschrieben

Sie ist heute die Startseite und sonst nichts. Zwei Anleitungen fehlen und sind der Grund, aus dem
es die Seite überhaupt gibt:

- eine **Anleitung für Mitglieder** — buchen, absagen, Mitspieler eintragen, Benachrichtigungen
  ([Vorgang #94](https://github.com/jegr78/courtside/issues/94))
- eine **Anleitung für Vorstände** — Plätze, Regeln, Mitglieder, Konten, Import
  ([Vorgang #95](https://github.com/jegr78/courtside/issues/95))

Wer Courtside heute betreiben oder daran mitarbeiten will, findet die technischen Unterlagen im
Repository: die [Referenz-Installation](https://github.com/jegr78/courtside/blob/main/deploy/README.md),
die [Entwurfsspezifikation](https://github.com/jegr78/courtside/blob/main/docs/design.md) und das
[Datenmodell](https://github.com/jegr78/courtside/blob/main/docs/data-model.md). Diese Unterlagen
sind auf Englisch und richten sich an Entwicklerinnen und Entwickler; diese Seite richtet sich an
Menschen, die einen Verein betreiben oder in einem spielen.
