---
layout: home
hero:
  name: Courtside
  text: Court booking for sports clubs
  tagline: One club, one instance, its own rules.
  actions:
    - theme: brand
      text: What Courtside is
      link: "#what-courtside-is"
    - theme: alt
      text: A guide for members
      link: /en/member-guide
    - theme: alt
      text: A guide for boards
      link: /en/board-guide
    - theme: alt
      text: Source code
      link: https://github.com/jegr78/courtside
features:
  - title: The court plan belongs to the club
    details: Courts, opening hours, kinds of booking and the rules that govern them are rows in a database, not lines of code. What a board wants to change, a board changes.
  - title: Two bookings never collide
    details: That a court is not double-booked is guaranteed by PostgreSQL itself. It is not a check in the application that a concurrent request could overtake.
  - title: Every instance belongs to its club
    details: Courtside is AGPL-3.0 and ships as a container image with a reference deployment. There is no central service a club's data ends up in.
---

## What Courtside is {#what-courtside-is}

Courtside is court booking for sports clubs. Each club runs its own instance: one database, one
container, that club's members and nobody else.

## Guides

- [**A guide for members**](member-guide.md): signing in, finding a free court, booking, recording
  players and guests, cancelling, choosing notifications.
- [**A guide for boards**](board-guide.md): courts and opening hours, booking cards and rules,
  membership types, people and accounts, import, and the club's own records.

Anyone who wants to run Courtside today, or work on it, will find the technical documents in the
repository: the [reference deployment](https://github.com/jegr78/courtside/blob/main/deploy/README.md),
the [design specification](https://github.com/jegr78/courtside/blob/main/docs/design.md) and the
[data model](https://github.com/jegr78/courtside/blob/main/docs/data-model.md). Those are written
for developers; this site is for the people who run a club or play in one.
