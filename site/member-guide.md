# Anleitung für Mitglieder

Diese Seite beschreibt Courtside aus der Sicht eines Mitglieds: anmelden, einen freien Platz
finden, buchen, Mitspieler eintragen, absagen. Sie nennt keine Uhrzeiten, keine Fristen und keine
Obergrenzen, denn das legt dein Verein in seiner eigenen Instanz fest. Alles andere hier gilt
unabhängig davon.

## Der Platzplan ist öffentlich

Die Startseite deiner Vereinsinstanz zeigt die Platzbelegung, auch ohne Anmeldung. Du siehst, wann
welcher Platz belegt ist. Buchen kannst du erst, wenn du angemeldet bist.

Der Plan zeigt eine Woche, auf einem schmalen Bildschirm einen Tag. Über *Vorherige Woche* und
*Nächste Woche* bewegst du dich vor und zurück, *Zur aktuellen Zeit* bringt dich zum Jetzt zurück.
Die Legende unter dem Plan erklärt die Zustände: **Frei**, **Belegt**, **Deine Buchung**,
**Nicht verfügbar** und **Vergangen**. An einem Tag ohne Öffnungszeit steht statt des Rasters,
dass die Anlage an diesem Tag geschlossen ist.

Ob bei einer fremden Buchung die Bezeichnung ihrer Buchungsart steht oder nur *Belegt*, entscheidet
dein Verein je Buchungsart. Öffentlich ist ausserdem, wie viele Personen zu einer Buchung gehören;
wer sie sind, ist es nicht. Namen stehen im Platzplan nur an deinen eigenen Buchungen.

## Anmelden

Dein Konto legt der Vorstand an. Benutzername und ein Einmalpasswort kommen anschliessend per
E-Mail zu dir, nicht über den Vorstand: niemand dort sieht oder wählt dein erstes Passwort.

Über *Anmelden* kommst du zum Formular mit Benutzername und Passwort. Wird die Anmeldung
abgelehnt, obwohl du dich nicht vertippt hast, können die Zugangsdaten abgelaufen oder nie
angekommen sein, oder das Konto ist deaktiviert. In allen drei Fällen hilft dein Vorstand weiter.

Nach zu vielen Versuchen in kurzer Zeit sagt Courtside das ausdrücklich und lässt eine Weile
warten. Gezählt wird dabei der Netzanschluss, von dem die Versuche kommen, nicht dein Konto:
niemand kann dich aussperren, indem er dein Passwort oft genug falsch rät.

## Das Einmalpasswort ersetzen

Mit dem Einmalpasswort kommst du nur an eine einzige Seite: *Einmalpasswort ersetzen*. Solange du
kein eigenes Passwort gesetzt hast, führt dich jede Seite der Anwendung dorthin zurück. Zeit hast
du dafür nicht unbegrenzt: wie lange ein zugeschicktes Passwort gilt, legt dein Verein fest, und
danach braucht es ein neues vom Vorstand.

Das neue Passwort braucht mindestens zwölf und höchstens 256 Zeichen. Courtside lehnt es ausserdem
ab, wenn es auf einer mitgelieferten Liste häufiger Passwörter steht, wenn es deinen Namen, deinen
Benutzernamen, deine E-Mail-Adresse, den Vereinsnamen oder einen Begriff enthält, den dein Verein
zusätzlich gesperrt hat, und wenn es dem aktuellen oder dem zugeschickten Passwort entspricht.

Dazu fragt Courtside einen öffentlichen Dienst, ob dieses Passwort schon einmal in einem Datenleck
aufgetaucht ist. Dein Passwort verlässt die Instanz dabei nicht: übertragen werden fünf Zeichen
eines Prüfwerts, aus denen es sich nicht zurückrechnen lässt. Antwortet der Dienst nicht, lehnt
Courtside die Änderung ab, statt ungeprüft zu speichern; dann versuchst du es später noch einmal.
Sonst meldest du dich einmal neu an und bist drin.

## Eine Buchung anlegen

Im Platzplan klickst du auf die freie Zelle, in der du spielen willst. Sie nennt Platz und Uhrzeit,
und daraus wird der Anfang deiner Buchung. Der Dialog *Buchung anlegen* zeigt dann:

* **Dauer**, als Auswahl der Längen, die die Regeln deines Vereins zulassen.
* Den **Platz**, den du angeklickt hast. Die Auswahl mehrerer Plätze auf einmal bietet die
  Anwendung nur einem Konto mit einer Rolle über die Mitgliedschaft hinaus an, etwa für ein
  Training über drei Plätze; allen anderen nennt sie den gewählten Platz.
* **Art der Buchung**. Zur Auswahl steht, was deine Rolle benutzen darf.
* **Mitglieder**: über die Suche findest du sie und trägst sie als Mitspieler ein.
* Unter **Weitere Angaben**: Gäste, *Was mitspielt* und eine Notiz.

*Jetzt buchen* legt die Buchung an. Ob ein Platz zu dieser Zeit noch frei ist, entscheidet die
Datenbank selbst und nicht eine vorherige Prüfung, die ein gleichzeitiger Zugriff überholen könnte.
Kommt dir jemand im selben Moment zuvor, sagt Courtside dir das, statt zwei Buchungen
nebeneinander zu stellen.

## Was eine Buchungsart bedeutet

Alles, was einen Platz belegt, ist in Courtside dieselbe Sache: das Spiel eines Mitglieds, ein
Training, ein Punktspiel, eine Sperrung. Was sie voneinander unterscheidet, ist ihre **Buchungsart**.

Die Buchungsart entscheidet mit,

* wie viele Spieler die Buchung erfasst, und ob sie überhaupt welche erfasst,
* ob Gäste erlaubt sind,
* ob die Buchung gegen deine Obergrenze offener Buchungen zählt,
* wer sie überhaupt anlegen darf.

Buchungsarten sind Zeilen in der Datenbank deines Vereins, keine feste Liste aus dem Programm. Was
du im Dialog zur Auswahl hast, hat dein Vorstand so eingerichtet.

## Mitspieler und Gäste

Erfasst die gewählte Art Spieler, zeigt der Dialog mit, wie viele von wie vielen du schon
eingetragen hast. Drei Arten von Mitspielern gibt es:

* **Mitglieder** suchst du über den Namen und fügst sie hinzu. Ein Mitglied kann nur einen Platz
  derselben Buchung belegen.
* **Gäste** trägst du unter *Weitere Angaben* mit Namen ein. Erlaubt eine Buchungsart keine Gäste,
  sagt sie das beim Buchen.
* ***Was mitspielt*** ist für alles, was einen Spielplatz belegt, ohne eine Person zu sein: eine
  Ballmaschine etwa, oder ein Aushang „Spielpartner gesucht“. Wie viele der Verein davon besitzt,
  legt er selbst fest, und er kann es auch offen lassen. Ist zu deiner Zeit schon alles vergeben,
  nennt Courtside die Anzahl, die es insgesamt gibt.

Wen du einträgst, erfährt davon: das eingetragene Mitglied bekommt eine E-Mail. Gefragt wird es
nicht, zustimmen muss es nicht, und es kann sich selbst wieder austragen.

## Als Mitspieler eingetragen

Unter *Meine Buchungen* steht ein eigener Abschnitt **Als Mitspieler eingetragen**. Dort landen die
Buchungen anderer Mitglieder, in denen dein Name steht. Niemand hat dich vorher gefragt, und genau
dort trägst du dich wieder aus, ohne jemanden um Erlaubnis zu bitten. Wer die Buchung angelegt hat,
bekommt eine Nachricht davon; die Buchung selbst bleibt bestehen.

## Wenn eine Regel die Buchung ablehnt

Buchungsregeln sind Daten, keine festen Zeilen im Programm, und welche für dich gelten, hängt an
deiner Mitgliedsart. Courtside sammelt beim Buchen **alle** Verstösse ein und zeigt jeden bei dem
Feld an, um das es geht. Du korrigierst also nicht einen Grund nach dem anderen, sondern siehst auf
einmal, was fehlt.

Diese Ablehnungen gibt es:

| Was Courtside sagt | Was dahinter steht |
|---|---|
| An diesem Tag ist die Anlage geschlossen | Der Tag hat keine Öffnungszeit |
| Buchungen sind nur zwischen zwei Uhrzeiten möglich | Deine Zeit liegt ausserhalb der Öffnungszeit |
| Buchungen beginnen im Minuten-Raster | Der Beginn passt nicht in das Raster deines Vereins |
| Die Buchungsdauer muss ein Vielfaches der Rasterlänge sein | Die Dauer passt nicht in dasselbe Raster |
| Du kannst höchstens so viele Tage im Voraus buchen | Der Vorlauf ist begrenzt |
| Eine Buchung darf höchstens so viele Minuten dauern | Die Dauer ist begrenzt |
| Du hast bereits so viele von so vielen möglichen offenen Buchungen | Mehr gleichzeitig offene Buchungen sind nicht vorgesehen |
| Du musst mindestens so viele Minuten vor Buchungsbeginn stornieren | Für das Stornieren gilt eine Frist |
| Eine Buchung darf nicht in der Vergangenheit beginnen | Der Zeitpunkt liegt hinter dir |
| Platzbuchungen sind für dich nicht freigegeben | Deine Mitgliedsart bucht nicht selbst |

Wie viele Tage, wie viele Minuten, wie viele Buchungen: das steht in den Regeln deines Vereins, und
Courtside nennt die Zahl in der Meldung selbst.

## Stornieren

Unter *Meine Buchungen* liegen deine **bevorstehenden** und deine **vergangenen** Buchungen. Bei
einer bevorstehenden gibt es *Stornieren*. Ist die Frist deines Vereins schon verstrichen, lehnt
Courtside die Stornierung ab und sagt, wie viele Minuten vor Buchungsbeginn sie möglich gewesen
wäre.

Eine stornierte Buchung gibt den Platz sofort wieder frei. Genau darum bittet dich auch die
Erinnerung vor deiner Buchung: wenn du nicht spielen kannst, storniere, damit jemand anders
spielen kann.

## Serientermine

Ein Serientermin ist ein Rezept: erster Termin, Uhrzeit, Dauer, Wochentage, Abstand in Wochen und
ein Ende. Daraus entstehen ganz normale Buchungen. Das Formular dafür steht unter *Meine
Buchungen*, und die Anwendung zeigt es nur einem Konto mit einer Rolle über die Mitgliedschaft
hinaus, etwa für ein Training. Eine Serie erfasst keine Spieler, also wirst du in ihr auch nicht
eingetragen; du begegnest ihr im Platzplan als belegte Zeit.

Zwei Dinge sind dabei wichtig:

* **Eine Serie verdrängt keine bestehende Buchung.** Fällt ein Termin auf einen Platz, der zu
  dieser Zeit schon belegt ist, entsteht dieser eine Termin gar nicht erst. Er wird beim Anlegen
  als übersprungen aufgeführt, der Rest der Serie entsteht.
* **Ein einzelner Termin ist änderbar, ohne die Serie anzufassen.** Wer eine Serie verwaltet, wählt
  beim Stornieren und Verschieben zwischen *Nur dieser Termin*, *Dieser und folgende Termine*
  und *Ganze Serie*. Vor dem Verschieben zeigt Courtside, welche Termine betroffen wären und welche
  davon nicht verschoben werden können, weil ihr Platz dann belegt oder nicht verfügbar ist.

## Wenn sich unter deiner Buchung etwas ändert

Es kann passieren, dass sich die Grundlage deiner Buchung nachträglich ändert: ein Platz wird
ausser Betrieb genommen, eine Buchungsart wird nicht mehr angeboten, der Verein schliesst an diesem
Tag, oder die Öffnungszeiten decken deine Buchung nicht mehr ab.

Courtside sagt dir das per E-Mail und nennt den Grund. Abgesagt ist deine Buchung damit nicht. Was
mit ihr geschieht, entscheidet dein Verein.

## Benachrichtigungen

Unter *Benachrichtigungen* entscheidest du, was der Verein dir schickt. Abgewählt heisst: diese
eine Nachricht bekommst du nicht mehr, alle anderen weiterhin.

Abwählen kannst du:

* die Bestätigung deiner Buchung,
* die Erinnerung vor deiner Buchung,
* die Nachricht, dass sich jemand aus deiner Buchung ausgetragen hat.

Immer geschickt werden:

* deine Zugangsdaten für ein neues Konto,
* deine Zugangsdaten nach einem Zurücksetzen,
* die Nachricht, dass jemand dich als Mitspieler eingetragen hat,
* die Nachricht, dass sich unter deiner Buchung etwas geändert hat.

Ohne diese vier kommst du nicht an dein Konto, erfährst nichts von einer Sperrung unter deiner
Buchung und nichts davon, dass jemand dich eingetragen hat. Deshalb lassen sie sich nicht
abschalten.

## Dein Konto

Unter *Kontosicherheit* änderst du dein Passwort und siehst, in welchen Browsern dein Konto
angemeldet ist, seit wann und wann sie zuletzt aktiv waren. Für die Änderung des Passworts gibst du
dein aktuelles mit ein. Sie beendet anschliessend alle Sitzungen deines Kontos, auch die, in der du
sie vorgenommen hast.

Du kannst eine einzelne Sitzung beenden oder alle auf einmal. Beendest du eine andere Sitzung als
die, in der du gerade arbeitest, oder alle, und liegt deine Anmeldung schon eine Weile zurück,
fragt Courtside vorher dein Passwort noch einmal ab. Die Sitzung, in der du gerade bist, beendest
du ohne diese Rückfrage.

Vertippt sich der Vorstand bei deinem Namen oder deinem Benutzernamen, ist das kein Dauerzustand:
alles, was ein Verein einträgt, kann er auch wieder korrigieren.
