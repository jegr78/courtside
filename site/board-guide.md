# Anleitung für Vorstände

Diese Seite beschreibt, was ein Vorstand in Courtside einrichtet und pflegt: die Anlage, die
Buchungsregeln, die Mitglieder und ihre Zugänge. Sie richtet sich an jemanden mit einem Abend Zeit,
nicht an eine Administratorin von Beruf.

Zahlen stehen hier keine. Öffnungszeiten, Fristen, Obergrenzen und Raster legt Ihr Verein selbst
fest — die Anleitung sagt, wo, und was die Einstellung bewirkt.

## Wer die Verwaltung sieht

Die Verwaltung öffnet sich nur einem Konto mit der Rolle **Administrator**. Wer sie hat, findet
*Verwaltung* in der Navigation; alle anderen sehen sie nicht und kommen auch über die Adresse nicht
hinein.

Innerhalb der Verwaltung führt eine Leiste an der linken Seite durch vier Gruppen:

| Gruppe | Was darin liegt |
|---|---|
| **Verein** | Einrichtung, Konfiguration |
| **Anlage** | Plätze, Öffnungszeiten, Buchungskarten, Platzfüller |
| **Mitglieder** | Personen und Konten, Mitgliedsarten, Import |
| **Nachweise** | Auslastung, Datenexport, Änderungsprotokoll, Nachrichtenprotokoll |

Der Weg zurück zum Platzplan steht in derselben Leiste.

## Der geführte Weg: Einrichtung

*Verein → Einrichtung* ist die Übersicht für den Anfang. Sie liest den aktuellen Stand der Instanz
und zeigt je Schritt, ob er abgeschlossen, noch offen oder optional ist:

1. **Verein konfigurieren** — die Werkseinstellungen durch Name, Darstellung, Sprache, Zeitzone und
   Kontoeinstellungen ersetzen.
2. **Anlage vorbereiten** — mindestens ein aktiver Platz und ein geöffneter Wochentag machen den
   Platzplan nutzbar.
3. **Mitgliedsarten anbieten** — sie verbinden Personen mit ihren Buchungsregeln und Kontorechten.
4. **Mitglieder aufnehmen** — abgeschlossen, sobald eine Person eine laufende Mitgliedschaft hat.
5. **Mitglieder importieren** — optional, und nur sinnvoll, wenn eine bestehende
   Mitgliederverwaltung die Liste führt.

Sie können jeden Schritt öffnen und später hierher zurückkehren; die Übersicht merkt sich nichts,
sondern liest jedes Mal neu, was tatsächlich da ist.

## Verein → Konfiguration

Hier steht alles, was den ganzen Verein betrifft.

**Verein und Darstellung.** Vereinsname, Primär- und Akzentfarbe, Logo. Neben jeder Farbe zeigt
Courtside, ob sie mit dunklem oder hellem Text den Kontrast 4,5:1 erreicht — die Schwelle, ab der
Text auch für schwache Augen und auf schlechten Bildschirmen lesbar bleibt. Das Logo laden Sie als
PNG oder JPEG hoch, höchstens 1 MiB und 2048 mal 2048 Pixel; solange keine Datei hochgeladen ist,
gilt die Logo-URL.

**Impressum und Datenschutz** sind zwei URLs. Sie zeigen auf die Seiten Ihres Vereins, denn
Courtside kennt Ihre Rechtsform nicht.

**Standardsprache** ist die Sprache für alle, die keine eigene gewählt haben.

**Zeitzone** wird gegen die Zeitzonendatenbank geprüft, ein Tippfehler wird also sofort abgelehnt.
Ändern lässt sie sich nur, solange es keine zukünftige Buchung gibt — sonst würde eine bestehende
Buchung ihre Uhrzeit wechseln.

**Buchungsraster in Minuten** bestimmt das Raster des Platzplans und die zulässigen Anfangszeiten.

**Erinnerung vor einer Buchung** in Stunden. Der Wert 0 schaltet Erinnerungen ab; sonst bekommen
alle in einer Buchung so viele Stunden vorher eine Nachricht.

**Gültigkeit ausgestellter Zugangsdaten**, getrennt für ein neues Konto und für ein zurückgesetztes
Passwort. Danach ist das Einmalpasswort wertlos und muss neu ausgestellt werden.

**Regelsatz für Personen ohne Beitragsart** greift, wenn jemand gerade keine Mitgliedsart hat, etwa
nach dem Ende einer Mitgliedschaft. Ohne Regelsatz bindet diese Person keine mitgliedschaftsbezogene
Regel; Öffnungszeiten und Raster gelten trotzdem.

## Anlage → Plätze

Ein Platz hat eine Nummer und einen Namen; die Nummer ist eindeutig, eine bereits vergebene wird
abgelehnt. Nummer und Name lassen sich jederzeit ändern.

Statt einen Platz zu löschen, deaktivieren Sie ihn. Er verschwindet aus dem Platzplan, seine
Vergangenheit bleibt in den Auswertungen, und bestehende Buchungen darauf sind nicht plötzlich
verschwunden — betroffene Mitglieder bekommen eine Nachricht, dass ein Platz ihrer Buchung ausser
Betrieb genommen wurde.

## Anlage → Öffnungszeiten

Je Wochentag tragen Sie eine Öffnungs- und eine Schliesszeit ein oder markieren den Tag als
geschlossen. Ein Tag mit nur einer der beiden Zeiten wird nicht gespeichert; Courtside markiert die
Zeile und sagt, was fehlt.

Für die übliche Woche gibt es *Gleiche Zeiten übernehmen*: Zeiten eintragen, die Tage auswählen,
übernehmen, und die ganze Woche mit einem Klick speichern.

Ausserhalb der Öffnungszeit ist keine Buchung möglich, und eine nachträgliche Verkürzung meldet sich
bei den Mitgliedern, deren Buchung dadurch nicht mehr abgedeckt ist.

## Anlage → Buchungskarten

Alles, was einen Platz belegt, ist in Courtside dieselbe Sache — ein Mitgliederspiel, ein Training,
ein Punktspiel, eine Sperrung. Was sie unterscheidet, ist die **Buchungskarte**. Eine neue Art von
Belegung ist deshalb eine neue Karte, keine neue Version der Anwendung.

Eine Karte trägt:

* **Bezeichnung und Farbe** — so erscheint sie im Platzplan, mit Vorschau im Formular.
* **Berechtigte Rollen** — wer auf dieser Karte buchen darf. Eine der gewählten Rollen genügt. Ohne
  Auswahl darf jede angemeldete Person buchen; die Administration darf immer.
* **Verantwortliche Rollen** — wer jede Buchung auf dieser Karte öffnen, die Namen der Teilnehmenden
  sehen und sie stornieren darf. Ohne Auswahl nur die Administration.
* **Erlaubte Spielerzahlen** — genau diese Zahlen darf eine Buchung haben. Ohne Angabe hält die
  Karte keine Teilnehmenden fest; so ist es beim Training und bei einer Sperrung.
* **Zählt gegen Buchungslimits** — ob eine Buchung auf dieser Karte auf die Obergrenze offener
  Buchungen des Mitglieds angerechnet wird.
* **Gäste erlaubt** — ob ein namentlich genannter Gast einen Spielerplatz füllen darf.
* **Im Platzplan neutral als gebucht anzeigen** — ob Fremde die Bezeichnung der Karte sehen oder nur
  *Belegt*.

Zur Verfügbarkeit gilt dasselbe wie beim Platz: deaktivieren statt löschen.

## Anlage → Platzfüller

Ein Platzfüller belegt einen Spielplatz, ohne eine Person zu sein — eine Ballmaschine etwa, oder ein
Aushang „Spielpartner gesucht“. Die Anzahl sagt, wie viele davon der Verein besitzt; leer heisst
beliebig viele. Ist zur gebuchten Zeit alles vergeben, sagt Courtside dem buchenden Mitglied, wie
viele es insgesamt gibt.

## Buchungsregeln

Die Regeln stehen in *Verein → Konfiguration*, und die Mitgliedsarten verweisen darauf. Regeln sind
Daten: ein **Regelwerk** ist eine benannte Sammlung, und jede Regel darin hat höchstens einen
Eintrag.

Zwei Regeln gelten für den ganzen Verein und stehen nicht im Regelwerk: die **Öffnungszeiten** unter
*Anlage → Öffnungszeiten* und das **Zeitraster** in dieser Konfiguration. Das Regelwerk verlinkt
beide an ihren Platz. Die übrigen Regeln gehören hinein:

| Regel | Was sie einstellt |
|---|---|
| Buchungsvorlauf | Wie viele Tage im Voraus höchstens gebucht werden darf |
| Offene Buchungen | Wie viele Buchungen gleichzeitig offen sein dürfen |
| Maximale Buchungsdauer | Wie viele Minuten eine Buchung höchstens dauert |
| Stornierungsfrist | Wie viele Minuten vor Beginn spätestens storniert wird |
| Buchen gesperrt | Keine Einstellung: wer nach diesem Regelwerk gemessen wird, bucht und verschiebt nicht selbst. Die Administration bucht weiterhin auch für andere |

Zu jeder Zahl nennt das Formular den erlaubten Bereich. Beim Buchen prüft Courtside **alle** Regeln
und zeigt dem Mitglied jeden Verstoss auf einmal, nicht einen nach dem anderen.

Ein Regelwerk wird **stillgelegt**, nicht gelöscht. Zeigt keine Mitgliedsart darauf, ändert das für
niemanden etwas; zeigen welche darauf, nimmt Stilllegen es nur aus der Auswahl — für diese Mitglieder
gelten die Regeln unverändert weiter, bis Sie ihnen ein anderes Regelwerk zuweisen. Courtside sagt
Ihnen vorher, welcher Fall vorliegt.

## Mitglieder → Mitgliedsarten

Eine Mitgliedsart verbindet drei Dinge: eine Bezeichnung, ein Regelwerk und die Frage, ob ein Import
für diese Art einen Zugang anlegt.

**Stilllegen** verhindert nur neue Zuordnungen. Wer die Art hält, behält sie, und ihre Buchungsregeln
gelten für diese Mitglieder unverändert weiter.

**Zugang beim Import anlegen** heisst: führen Sie einen Import aus, bekommt jedes Mitglied dieser Art
einen Zugang und sein Einmalpasswort per E-Mail. Bestehende Zugänge bleiben unberührt.

## Mitglieder → Personen und Konten

Die Liste zeigt Name, Benutzername, Kontostatus und Mitgliedsart, mit Suche und Filter. Eine Person
legen Sie mit Vorname, Nachname und E-Mail-Adresse an; alles davon ist später korrigierbar.

Öffnen Sie eine Person, finden Sie drei Bereiche:

**Person** — die Stammdaten und die Sprache, in der Benachrichtigungen an sie gehen.

**Mitgliedschaft** — Mitgliedsart, Beginn, Ende. Eine Mitgliedschaft wird **beendet**, nicht
gelöscht: sie endet mit dem gewählten Datum, der Eintrag bleibt, und das Datum lässt sich danach
korrigieren.

**Konto** — Benutzername, Rollen und die Zugangsdaten. Ein Konto braucht eine E-Mail-Adresse, denn
über sie wird es erreicht; fehlt sie, sagt Courtside das und lässt kein Konto anlegen.

Der Zustand des Zugangs steht immer dabei: noch nichts ausgestellt, Zugangsdaten unterwegs,
ausgestellte Zugangsdaten abgelaufen, oder das Mitglied hat ein eigenes Passwort gewählt. *Zugangsdaten
senden* stellt ein Einmalpasswort aus, **das an das Mitglied geht und das niemand im Vorstand sieht
oder wählt.** Courtside nennt vorher die Adresse und sagt, wenn mehrere Personen auf derselben
Adresse liegen.

Hat das Mitglied bereits ein eigenes Passwort, warnt Courtside vor dem Senden: neue Zugangsdaten
löschen das gewählte Passwort und beenden alle laufenden Sitzungen. Das ist der Weg für jemanden, der
nicht mehr hineinkommt — und nur dafür.

Verlässt jemand den Verein, wird sein Konto **deaktiviert**, nicht gelöscht: die Schaltfläche
daneben schaltet es ab und ebenso wieder an. Ein deaktiviertes Konto meldet sich nicht mehr an, und
alles, was die Person gebucht hat, bleibt in den Auswertungen richtig.

Weiter finden Sie dort: die Sitzungen dieses Kontos beenden, alle Sitzungen der Instanz beenden
(auch Ihre eigene), die Änderungen an dieser Person im Protokoll, und die **Auskunft über
gespeicherte Daten**. Fragt ein Mitglied, was der Verein über es gespeichert hat, erzeugt diese
Schaltfläche die Antwort als Datei: die Person, ihr Konto, ihre Mitgliedschaft, ihre Buchungen,
Mitgliedsnummern aus einem Import und das Änderungsprotokoll. Über andere Personen steht nichts
darin, und dass die Auskunft erzeugt wurde, steht danach im Protokoll.

Die ganze Liste lässt sich als CSV exportieren, wahlweise mit den Mitgliedsnummern einer Importquelle.

## Mitglieder → Import

Führt Ihr Verein die Mitglieder anderswo, liest Courtside deren Export ein, statt dass jemand
abtippt. Der Weg hat drei Schritte, und die Anwendung führt Sie durch sie hindurch.

**Quelle beschreiben.** Eine Quelle ist die Beschreibung *einer* Mitgliederverwaltung: Bezeichnung,
Trennzeichen und Zeichensatz des Exports, die Zuordnung der Spalten und der Kategorien zu
Mitgliedsarten, und die Felder, die diese Quelle führt. Ein geführtes Feld überschreibt jede
Momentaufnahme; was Sie nicht ankreuzen, gehört dem Verein und bleibt unangetastet. Ausserdem
stellen Sie hier die Schwelle ein, ab welchem Anteil wegfallender Mitgliedschaften nachgefragt wird.

Zum Zuordnen der Spalten wählen Sie eine Beispieldatei aus. **Diese Datei bleibt in Ihrem Browser**
und wird nur gelesen, um Ihnen Ihre eigenen Spalten anzubieten.

**Datei einlesen.** Der Upload erzeugt eine Vorschau, keine Änderung: Dateiname, Zeilenzahl und
Prüfsumme, dann die Änderungsmenge nach Art getrennt — neu, geändert, Mitgliedschaft endet —, die
übersprungenen Zeilen, die möglichen Dubletten und die geteilten Postfächer. Dazu steht dort, wie
viele Zugänge angelegt würden und warum ein Zugang gegebenenfalls ausbleibt.

Zwei Dinge muss die Vorschau von Ihnen wissen:

* **Was die Datei bedeutet.** Eine *Teilliste* ändert nur, was in ihr steht; wer fehlt, bleibt
  unangetastet. Eine *vollständige Liste* ist die ganze Wahrheit dieser Quelle — wessen Zeile fehlt,
  dessen Mitgliedschaft endet.
* **Wer schon da ist.** Eine Momentaufnahme erkennt eine Person an ihrer Mitgliedsnummer, nie am
  Namen. Wen Sie eingetragen haben, bevor Sie diese Quelle einlesen, ist der Datei unbekannt —
  verknüpfen Sie beide von Hand, sonst legt der Import eine zweite Person an.

Bei möglichen Dubletten unternimmt Courtside nichts: zwei Mitglieder heissen wirklich manchmal
gleich, und nur Sie können das unterscheiden. Bei geteilten Postfächern ebenso — ein Elternteil
meldet seine Kinder an, das ist gewollt; wer das Postfach liest, erhält aber jedes dorthin gesendete
Einmalpasswort, und ein erstes Passwort genügt, um einen Zugang zu behalten.

**Import ausführen.** Die geprüfte Änderungsmenge wird in einem Zug geschrieben. Liegt der Anteil
endender Mitgliedschaften über Ihrer Schwelle, verlangt Courtside eine ausdrückliche Bestätigung —
eine abgeschnittene Ausfuhr sieht genau so aus wie ein Verein, der geschrumpft ist. Ein erneutes
Ausführen macht nichts rückgängig. Jeder Lauf steht danach mit seinem Ergebnis in der Liste der
bisherigen Läufe.

## Nachweise

**Auslastung** zeigt, wie viel bestätigte Spielzeit jeder Platz in einem Zeitraum gehalten hat.
Plätze ohne Buchung stehen mit dabei; sie sind Teil der Antwort.

**Datenexport** gibt die Listen des Vereins als CSV. Trennzeichen und Zeichensatz entscheiden
darüber, ob Ihre Tabellenkalkulation die Datei richtig öffnet. Der Buchungsexport nennt Platz,
Zeitfenster und Buchungsart Tag für Tag — wer gebucht hat, steht nicht in der Datei.

**Änderungsprotokoll** führt die administrativen Änderungen mit Zeitpunkt, Änderung, betroffenem
Gegenstand und ausführender Person. Wer eine Platznummer ändert, eine Regel setzt oder eine
Mitgliedschaft beendet, findet es hier wieder.

**Nachrichtenprotokoll** zeigt, was die Instanz verschickt hat, wahlweise nur das, was schiefging.
Hier lohnt eine Feinheit: *übergeben* heisst, Courtside hat die Nachricht an den Mailserver des
Vereins übergeben und der hat sie angenommen. Ob sie zugestellt wurde, weiss diese Anwendung nicht —
das steht im Protokoll des Mailservers.

## Zwei Regeln, die überall gelten

**Nichts wird gelöscht, was der Verein einmal eingetragen hat.** Plätze, Karten, Regelwerke und
Mitgliedsarten werden deaktiviert oder stillgelegt, Mitgliedschaften beendet. Die Vergangenheit
bleibt lesbar, und die Auswertungen bleiben richtig.

**Alles, was Sie eintragen, können Sie korrigieren.** Ein Tippfehler im Namen, ein falscher
Benutzername, ein falsches Enddatum: dafür braucht es keine Datenbankkonsole und keine Anfrage bei
uns.
