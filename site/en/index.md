---
layout: home
hero:
  name: Courtside
  text: Court booking for sports clubs
  tagline: Each club runs its own instance and sets its own rules.
  actions:
    - theme: brand
      text: What Courtside is
      link: "#what-courtside-is"
    - theme: alt
      text: Member handbook
      link: /en/member-guide
    - theme: alt
      text: Board handbook
      link: /en/board-guide
    - theme: alt
      text: Source code
      link: https://github.com/jegr78/courtside
features:
  - title: Configured by the club
    details: The board manages courts, opening hours, booking types and rules in Courtside.
  - title: Protected against double bookings
    details: PostgreSQL prevents two bookings from occupying the same court at the same time.
  - title: Run as a separate instance
    details: Each club runs Courtside with its own database. The software is licensed under AGPL-3.0.
---

## What Courtside is {#what-courtside-is}

Courtside manages courts and bookings for sports clubs. The club runs the application and decides
which rules apply to its members.

## Guides

- The [member handbook](member-guide.md) explains how to sign in, book a court, record other players
  and guests, and configure notifications.
- The [board handbook](board-guide.md) covers setup and administration of courts, booking types,
  rules, members, accounts and imports.

The technical documents are for operators and developers. Start with the
[reference deployment](https://github.com/jegr78/courtside/blob/main/deploy/README.md). Application
details are in the [technical specification](https://github.com/jegr78/courtside/blob/main/docs/design.md)
and the [data model](https://github.com/jegr78/courtside/blob/main/docs/data-model.md).
