# A guide for members

This page describes Courtside from a member's point of view: signing in, finding a free court,
booking one, recording players, cancelling. It names no times, no deadlines and no limits, because
your club sets those in its own instance. Everything else here holds regardless.

## The court plan is public

Your club's home page shows court occupancy without signing in. You can see when each court is
taken. Booking is what needs an account.

The plan shows a week, or a single day on a narrow screen. *Previous week* and *Next week* move you
back and forth, *Return to current time* brings you back to now. The legend under the plan explains
the states: **Available**, **Occupied**, **Your booking**, **Unavailable** and **Past**. On a day
the club is closed, the plan says so instead of showing a grid.

Whether somebody else's booking shows the name of its kind or only *Occupied* is something your
club decides per kind of booking. How many people belong to a booking is public as well; who they
are is not. Names appear on the plan only on your own bookings.

## Signing in

Your board creates the account. The username and a one-time password then reach you by email rather
than through the board: nobody there sees or chooses your first password.

*Sign in* takes you to the form with username and password. If the sign-in is refused although you
typed everything correctly, the credentials may have expired or never arrived, or the account is
deactivated. Your board can help in all three cases.

After too many attempts in a short time Courtside says exactly that and makes you wait a while. It
counts the network connection the attempts come from, not your account: nobody can lock you out by
guessing your password often enough.

## Replacing the one-time password

The one-time password gets you to one page and no further: *Replace one-time password*. Until you
have chosen a password of your own, every page of the application leads back there. You do not have
unlimited time for it: how long an issued password stays valid is your club's setting, and after
that the board has to send a new one.

The new password needs at least twelve characters and at most 256. Courtside also refuses it if it
is on a list of common passwords shipped with the application, if it contains your name, your
username, your email address, the club name or a term your club added to that list, and if it
matches your current or the issued password.

On top of that, Courtside asks a public service whether this password has appeared in a known data
breach. Your password does not leave the instance for that: what travels is five characters of a
checksum, which the password cannot be recovered from. If the service does not answer, Courtside
refuses the change rather than storing something unchecked, and you try again later. Otherwise you
sign in once more and you are in.

## Creating a booking

On the court plan, click the free cell you want to play in. It names the court and the time, and
that becomes the start of your booking. The *Create booking* dialog then shows:

* **Duration**, as the lengths your club's rules allow.
* The **court** you clicked. The choice of several courts at once is offered only to an account
  holding a role beyond membership, for a training block across three courts for instance;
  everyone else is told which court they picked.
* **Kind of booking**, offering what your own role may use.
* **Members**: the search finds them and adds them as players.
* Under **More details**: guests, *What plays* and a note.

*Book now* creates the booking. Whether a court is still free at that moment is decided by the
database itself, not by a check the application ran first that a concurrent request could overtake.
If somebody beats you to it, Courtside tells you instead of placing two bookings side by side.

## What a kind of booking means

Everything that occupies a court is the same thing in Courtside: a member's game, a training block,
a league match, a closure. What tells them apart is their **kind of booking**.

The kind decides, among other things,

* how many players the booking records, and whether it records any at all,
* whether guests are allowed,
* whether the booking counts against your limit of open bookings,
* who may create one.

Kinds of booking are rows in your club's database, not a fixed list inside the program. What you
find in the dialog is what your board set up.

## Players and guests

If the chosen kind records players, the dialog shows how many of how many you have entered. There
are three sorts of player:

* **Members** you find by name and add. One member can occupy only one slot of the same booking.
* **Guests** you enter by name under *More details*. If a kind of booking allows no guests, it says
  so when you book.
* ***What plays*** covers anything that takes a player slot without being a person: a ball machine,
  say, or a "looking for a partner" notice. How many of them the club owns is the club's own
  setting, and it may leave the number open. If they are all taken at your time, Courtside names
  how many there are in total.

Whoever you enter is told, not asked: the member you recorded receives an email. They do not have
to agree, and they can take themselves out again.

## Recorded as a co-player

*My bookings* carries a section of its own: **Recorded as a co-player**. It holds the bookings
other members made with your name in them. Nobody asked you first, and that section is where you
take yourself out, without needing anyone's permission. Whoever made the booking is told; the
booking itself stays.

## When a rule refuses the booking

Booking rules are data rather than fixed lines in the program, and which ones apply to you follows
from your membership type. When you book, Courtside collects **every** violation and shows each one
next to the field it concerns. You do not correct one reason after another; you see at once what is
missing.

These refusals exist:

| What Courtside says | What lies behind it |
|---|---|
| The facility is closed on this day | The day has no opening time |
| Bookings are only possible between two times | Your time falls outside the opening hours |
| Bookings start on the minute grid | The start does not fit your club's grid |
| The duration must be a multiple of the grid | The duration does not fit the same grid |
| You can book at most so many days in advance | How far ahead you may book is limited |
| One booking may run at most so many minutes | The duration is limited |
| You already have so many of so many possible open bookings | That many at once is not foreseen |
| You must cancel at least so many minutes before the booking starts | Cancelling has a deadline |
| A booking cannot start in the past | The moment is behind you |
| Booking a court is not open to you | Your membership type does not book for itself |

How many days, how many minutes, how many bookings: that lives in your club's rules, and Courtside
names the number in the message itself.

## Cancelling

*My bookings* holds your **upcoming** and your **past** bookings. An upcoming one offers *Cancel*.
If your club's deadline has already passed, Courtside refuses the cancellation and says how long
beforehand it would have been possible.

A cancelled booking frees the court again immediately. That is also what the reminder before your
booking asks of you: if you cannot play, cancel, so that somebody else can.

## Series

A series is a recipe: first appointment, time, duration, weekdays, interval in weeks and one kind
of end. What it produces are ordinary bookings. The form for it sits under *My bookings*, and the
application shows it only to an account holding a role beyond membership, for training for
instance. A series records no players, so you are never entered in one; you meet it on the court
plan as occupied time.

Two things matter about them:

* **A series displaces no existing booking.** Where an appointment would fall on a court that is
  already taken at that time, that one appointment is not created at all. It is listed as skipped,
  and the rest of the series is created.
* **A single appointment can change without touching the series.** Whoever manages a series chooses
  between *This occurrence*, *This and following* and *Whole series* when cancelling or moving.
  Before a move, Courtside shows which occurrences would be affected and which of them cannot move,
  because their court would then be occupied or unavailable.

## When something under your booking changes

The ground your booking stands on can change afterwards: a court is taken out of service, a kind of
booking is no longer offered, the club closes on that day, or the opening hours no longer cover
your booking.

Courtside emails you and names the reason. That does not cancel your booking. What happens to it is
your club's decision.

## Notifications

Under *Notifications* you choose what the club sends you. Unchecked means you no longer get that
one message; everything else keeps arriving.

You can switch off:

* the confirmation of your booking,
* the reminder before your booking,
* the message that somebody withdrew from your booking.

Always sent are:

* your credentials for a new account,
* your credentials after a reset,
* the message that somebody recorded you as a player,
* the message that something under your booking has changed.

Without those four you could not reach your account, you would not hear about a closure under your
booking, and you would not hear that somebody recorded you in one. That is why they cannot be
switched off.

## Your account

Under *Account security* you change your password and see which browsers your account is signed in
on, since when, and when they were last active. Changing the password asks for your current one.
It then ends every session of your account, including the one you changed it in.

You can end a single session or all of them. If you end a session other than the one you are
working in, or all of them, and your sign-in is no longer recent, Courtside asks for your password
once more first. The session you are in ends without that question.

If the board mistyped your name or your username, that is not permanent: everything a club enters,
a club can correct.
