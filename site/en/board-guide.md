# A guide for boards

This page describes what a board sets up and maintains in Courtside: the facility, the booking
rules, the members and their accounts. It is written for somebody with an evening to spare, not for
a professional administrator.

It names no numbers. Opening hours, deadlines, limits and the time grid are your club's own
settings — this guide says where they live and what each one does.

## Who sees the administration

The administration opens only for an account holding the **Administrator** role. Those who hold it
find *Administration* in the navigation; everybody else does not see it and cannot reach it by
typing the address either.

Inside, a bar down the left leads through four groups:

| Group | What it holds |
|---|---|
| **Club** | Setup, Configuration |
| **Facility** | Courts, Opening hours, Booking cards, Slot fillers |
| **People** | People and accounts, Membership types, Import |
| **Records** | Utilisation, Data export, Change log, Message log |

The way back to the court plan sits in the same bar.

## The guided path: Setup

*Club → Setup* is the overview for the beginning. It reads the instance's current state and shows,
per step, whether it is complete, still to do, or optional:

1. **Configure the club** — replace the factory settings with the club's name, appearance, language,
   time zone and account settings.
2. **Prepare the facility** — at least one active court and one open weekday make the court plan
   usable.
3. **Offer membership types** — they connect people to their booking rules and account rights.
4. **Add members** — complete once at least one person holds a current membership.
5. **Import members** — optional, and worth it only when an existing membership system holds the
   list.

Open any step and return here later; the overview remembers nothing and reads what is actually
there each time.

## Club → Configuration

Everything that concerns the whole club lives here.

**Club and appearance.** Club name, primary and accent colour, logo. Beside each colour Courtside
shows whether it reaches a contrast of 4.5:1 with dark or with light text — the threshold at which
text stays readable for weaker eyes and on poor screens. The logo is a PNG or JPEG, up to 1 MiB and
2048 by 2048 pixels; the logo URL is used while no file is uploaded.

**Imprint and privacy policy** are two URLs. They point at your club's own pages, because Courtside
does not know your legal form.

**Default language** is the language for everybody who has not chosen one.

**Time zone** is checked against the time-zone database, so a typo is refused where it is typed. It
can only be changed while no future booking exists — otherwise an existing booking would move.

**Booking grid in minutes** sets the grid of the court plan and the start times a booking may have.

**Reminder before a booking**, in hours. 0 switches reminders off; otherwise everybody in a booking
is written to that many hours before it starts.

**How long issued credentials stay valid**, separately for a new account and for a reset password.
After that the one-time password is worthless and has to be issued again.

**Rule set for people without a membership type** applies to somebody who currently holds none, for
example after a membership ended. Without one, no membership-scoped rule binds them; opening hours
and the grid still do.

## Facility → Courts

A court has a number and a name; the number is unique and one already taken is refused. Both can be
changed at any time.

Rather than deleting a court, deactivate it. It leaves the court plan, its past stays in the
reports, and bookings on it do not simply vanish — the members holding them are written to and told
that a court of their booking was taken out of service.

## Facility → Opening hours

Per weekday you enter an opening and a closing time, or mark the day closed. A day carrying only one
of the two is not saved; Courtside marks the row and says what is missing.

For the ordinary week there is *Apply the same times*: enter the times, pick the days, apply, and
save the week with one click.

Outside the opening hours no booking is possible, and shortening them afterwards writes to the
members whose booking is no longer covered.

## Facility → Booking cards

Everything that occupies a court is the same thing in Courtside — a members' game, a training block,
a league match, a closure. What tells them apart is the **booking card**. A new kind of occupancy is
therefore a new card, not a new version of the application.

A card carries:

* **Label and colour** — how it appears in the court plan, with a preview in the form.
* **Allowed roles** — who may book on this card. Any selected role is sufficient. With none
  selected, every signed-in person may book; administrators may always.
* **Managing roles** — who may open every booking made on this card, see the participant names and
  cancel it. With none selected, only administrators may.
* **Allowed player counts** — exactly these counts are allowed. With none given, the card records no
  participants at all; that is the case for training and for a closure.
* **Counts against booking limits** — whether a booking on this card counts towards the member's
  limit of open bookings.
* **Guests allowed** — whether a named guest may fill a player slot.
* **Show as neutrally booked in the court plan** — whether strangers see the card's label or only
  *Occupied*.

Availability works as it does for a court: deactivate rather than delete.

## Facility → Slot fillers

A slot filler takes a player slot without being a person — a ball machine, say, or a "looking for a
partner" notice. The count is how many of them the club owns; empty means any number. When they are
all taken at the booked time, Courtside tells the booking member how many there are in total.

## Booking rules

The rules live in *Club → Configuration*, and the membership types point at them. Rules are data: a
**rule set** is a named collection, and each rule appears in it at most once.

Two rules apply to the whole club and are not in the rule set: the **opening hours** under
*Facility → Opening hours* and the **time grid** in this configuration. The rule set links to both
where they belong. The rest go into the set:

| Rule | What it sets |
|---|---|
| Advance booking window | How many days ahead a booking may be made |
| Open bookings | How many bookings may be open at once |
| Maximum booking duration | How many minutes a booking may run |
| Cancellation deadline | How many minutes before the start a cancellation must arrive |
| Booking barred | No setting: whoever is measured by this set books and moves nothing themselves. Administrators still book and move on somebody else's behalf |

Each number's form names the range it accepts. When a member books, Courtside checks **every** rule
and shows all violations at once, not one after another.

A rule set is **retired**, not deleted. If no membership type points at it, retiring changes nothing
for anybody; if some do, retiring only takes it out of the choices — their rules keep applying
unchanged until you point them at another set. Courtside tells you which case you are in before you
act.

## People → Membership types

A membership type ties three things together: a name, a rule set, and whether an import opens an
account for that type.

**Retiring** only stops new assignments. Whoever holds the type keeps it, and its booking rules keep
applying to those members unchanged.

**Open an account on import** means: when an import runs, every member of this type is given an
account and mailed their own one-time password. Accounts that already exist are left alone.

## People → People and accounts

The list shows name, username, account status and membership type, with a search and a filter. You
create a person with a first name, a last name and an email address; all of it can be corrected
later.

Opening a person shows three areas:

**Person** — the details, and the language notifications to them are written in.

**Membership** — type, start, end. A membership is **ended**, not deleted: it ends on the date you
choose, the record stays, and the date can be corrected afterwards.

**Account** — username, roles and credentials. An account needs an email address, because that is
how it is reached; without one Courtside says so and opens no account.

The state of the access is always shown: nothing issued yet, credentials out, issued credentials
expired, or the member has chosen a password of their own. *Send credentials* issues a one-time
password **that goes to the member and that nobody on the board sees or chooses.** Courtside names
the address beforehand and says when several people hold it.

If the member already chose a password, Courtside warns before sending: new credentials delete that
password and end every session they have open. That is the route for somebody who can no longer get
in, and only for that.

The same page ends this account's sessions, ends every session in the instance (yours included),
links to this person's changes in the log, and produces the **answer to a data-access request**.
When a member asks what the club holds about them, that button produces the answer as a file: the
person, their account, their membership, their bookings, member numbers from an import, and the
change log. It holds nothing about anybody else, and that the answer was produced is itself written
to the log.

The whole list exports as CSV, optionally carrying the member numbers of an import source.

## People → Import

If your club holds its members elsewhere, Courtside reads that system's export instead of somebody
retyping it. The path has three steps and the application walks you through them.

**Describe the source.** A source is the description of *one* membership system: a name, the
separator and character set of its export, the mapping of its columns and of its categories onto
membership types, and the fields that source owns. An owned field is overwritten by every snapshot;
what you leave unticked belongs to the club and stays untouched. Here you also set the share of
ending memberships above which Courtside asks before executing.

To map the columns you pick an example file. **That file stays in your browser** and is read only to
offer you your own columns.

**Read the file.** The upload produces a preview, not a change: file name, row count and checksum,
then the change set by kind — new, changed, membership ends — the skipped rows, the possible
duplicates and the shared mailboxes. Beside it stands how many accounts would be opened, and why one
would not be.

Two things the preview needs from you:

* **What the file means.** A *partial list* changes only what it contains; whoever is missing is left
  alone. A *complete list* is the whole truth about this source — whoever is missing has their
  membership ended.
* **Who is already there.** A snapshot recognises a person by their member number, never by their
  name. Anyone you entered before reading this source in is unknown to the file — link the two by
  hand, or the import creates a second person.

About possible duplicates Courtside does nothing: two members really are called the same sometimes,
and only you can tell the difference. Shared mailboxes likewise — a parent registering for their
children is deliberate; but whoever reads that mailbox receives every one-time password sent to it,
and a first password is enough to keep an account.

**Run the import.** The reviewed change set is written in one transaction. If the share of ending
memberships is above your threshold, Courtside demands an explicit confirmation — a truncated export
looks exactly like a club that shrank. Running it again does not undo it. Every run is then listed
with its result.

## Records

**Utilisation** shows how much confirmed playing time each court held over a period. Courts nobody
booked are listed too; they are part of the answer.

**Data export** gives the club's lists as CSV. The separator and character set decide whether your
spreadsheet opens the file correctly. The booking export names the court, the slot and the kind of
booking day by day — who booked is not in the file.

**Change log** carries the administrative changes with their time, the change, the subject and the
person who made it. Changing a court number, setting a rule, ending a membership: all of it is here.

**Message log** shows what the instance sent, optionally only what went wrong. One subtlety is worth
knowing: *handed over* means Courtside passed the message to the club's mail server and it accepted
it. Whether it was delivered is something this application cannot know — that is in the mail
server's own log.

## Two rules that hold everywhere

**Nothing a club once entered is deleted.** Courts, cards, rule sets and membership types are
deactivated or retired, memberships are ended. The past stays readable and the reports stay right.

**Everything you enter, you can correct.** A typo in a name, a wrong username, a wrong end date:
none of it needs a database console or a request to us.
