---
layout: home
hero:
  name: Courtside
  text: Platzbuchung für Sportvereine
  tagline: Jeder Verein betreibt seine eigene Instanz und legt seine Regeln selbst fest.
  actions:
    - theme: brand
      text: Was Courtside ist
      link: "#was-courtside-ist"
    - theme: alt
      text: Handbuch für Mitglieder
      link: /member-guide
    - theme: alt
      text: Handbuch für Vorstände
      link: /board-guide
    - theme: alt
      text: Quellcode
      link: https://github.com/jegr78/courtside
features:
  - title: Vom Verein konfiguriert
    details: Der Vorstand verwaltet Plätze, Öffnungszeiten, Buchungsarten und Regeln direkt in Courtside.
  - title: Gegen Doppelbelegungen geschützt
    details: PostgreSQL verhindert, dass zwei Buchungen denselben Platz zur selben Zeit belegen.
  - title: Als eigene Instanz betrieben
    details: Jeder Verein betreibt Courtside mit einer eigenen Datenbank. Die Software steht unter der AGPL-3.0.
---

## Was Courtside ist {#was-courtside-ist}

Courtside verwaltet Plätze und Buchungen für Sportvereine. Der Verein betreibt die Anwendung selbst
und entscheidet, welche Regeln für seine Mitglieder gelten.

## Anleitungen

- Im [Handbuch für Mitglieder](member-guide.md) erfährst du, wie du dich anmeldest, einen Platz
  buchst, Mitspieler und Gäste einträgst und Benachrichtigungen einstellst.
- Das [Handbuch für Vorstände](board-guide.md) erklärt die Einrichtung und Verwaltung von Plätzen,
  Buchungsarten, Regeln, Mitgliedern, Konten und Importen.

Die technischen Unterlagen richten sich an Betreiber und Entwickler. Beginne mit der
[Referenz-Installation](https://github.com/jegr78/courtside/blob/main/deploy/README.md). Details zur
Anwendung stehen in der [Entwurfsspezifikation](https://github.com/jegr78/courtside/blob/main/docs/design.md)
und im [Datenmodell](https://github.com/jegr78/courtside/blob/main/docs/data-model.md). Diese Dokumente
sind auf Englisch.
