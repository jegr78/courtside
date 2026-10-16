# Datenschutz-Kit

Dieses Kit hilft einem Verein, den Betrieb seiner Courtside-Instanz datenschutzrechtlich zu
dokumentieren. Es enthält drei Vorlagen zum Anpassen: das Verzeichnis der Verarbeitungstätigkeiten,
die technischen und organisatorischen Maßnahmen und die Datenschutzerklärung der Anwendung.

::: warning Keine Rechtsberatung
Der Verein ist Verantwortlicher für die Daten seiner Mitglieder. Er entscheidet über
Rechtsgrundlagen, Aufbewahrungsfristen und den Betrieb. Courtside liefert Werkzeuge und diese
Vorlagen, aber keine Rechtsberatung. Prüfe die Texte mit deinem Vorstand und im Zweifel mit einer
fachkundigen Stelle, bevor du sie verwendest.
:::

## So nutzt du das Kit

1. Lies den Abschnitt [Was Courtside speichert](#was-courtside-speichert). Er beschreibt, was die
   Anwendung selbst ablegt, und gilt für jede Instanz.
2. Kopiere die Vorlagen in ein eigenes Dokument. Alles in eckigen Klammern ersetzt du durch die
   Angaben deines Vereins, zum Beispiel `[Name des Vereins]`.
3. Lege die Fristen fest und trage sie in der Verwaltung unter *Nachweise → Aufbewahrung* ein. Wie
   das geht, steht im [Handbuch für Vorstände](board-guide#nachweise-aufbewahrung). Eine Kategorie
   ohne Frist bleibt unberührt, Courtside löscht dort nichts von selbst.
4. Ergänze, was dein Verein außerhalb von Courtside tut: Hosting, Backups, Mailversand und wer
   Zugang zum Server hat.

## Was Courtside speichert

| Bereich | Daten | Zweck | Ende |
|---|---|---|---|
| Personen | Vor- und Nachname, E-Mail-Adresse | Mitgliederverwaltung, Zugang, Nachrichten | Frist *Ehemalige Mitglieder* nach dem Ende der Mitgliedschaft |
| Mitgliedschaft | Mitgliedsart, Beginn, Ende | Buchungsrechte, Statistik | mit der Person |
| Konten | Benutzername, Passwort als Argon2id-Hash, Sprache, Rollen, letzte Anmeldung | Anmeldung und Berechtigungen | mit der Person |
| Buchungen | Platz, Zeit, Karte, Status, buchendes Konto, Mitspielende, Namen von Gästen, Notizen | Platzbelegung | Frist *Buchungen* pseudonymisiert Personenbezug und Notizen, Zeit und Platz bleiben für die Auslastung |
| Wartelisten und offene Plätze | wer auf einen Platz wartet oder einen sucht | Platzvergabe | nach dem Termin |
| Anwesenheit | erschienen oder nicht erschienen, wer es erfasst hat | Regeln gegen Nichterscheinen | mit der Buchung pseudonymisiert |
| Nachrichten | Art, Status und Kennungen der betroffenen Buchung | Benachrichtigung, Versandnachweis | mit dem Konto |
| Änderungsprotokoll | Art der Änderung, betroffene Kennung, ausführendes Konto, Zeitpunkt; keine Namen und keine Freitexte | Nachvollziehbarkeit der Verwaltung | bleibt, nennt nach dem Entfernen einer Person nur noch eine Kennung |
| Sitzungen | Sitzungskennung, Konto, Zeitpunkte | angemeldet bleiben | nach Inaktivität oder Ablauf |
| Betriebsprotokolle | bereinigte Meldungen ohne Namen und E-Mail-Adressen | Fehlersuche | begrenzter rotierender Speicher |

Im Browser legt Courtside die gewählte Sprache und das Erscheinungsbild im lokalen Speicher ab und
hält die eigenen kommenden Buchungen für die Anzeige ohne Netz vor. Die Sitzung läuft über ein
Cookie, das allein der Anmeldung dient, und ein zweites Cookie schützt Formulare gegen gefälschte
Anfragen. Courtside bindet keine Tracking- oder Werbedienste ein.

Eine Auskunft über alle Daten einer Person erstellt die Verwaltung unter *Personen und Konten* mit
*Auskunft erzeugen*.

## Vorlage 1: Verzeichnis der Verarbeitungstätigkeiten

```text
Verantwortlicher: [Name des Vereins], [Anschrift], [E-Mail-Adresse]
Vertretung: [Vorstand nach Satzung]
Datenschutzbeauftragte Person: [Name und Kontakt, falls benannt, sonst "nicht benannt"]

Bezeichnung: Platzbuchung und Mitgliederzugang mit Courtside
Zwecke: Vergabe und Verwaltung der Plätze, Zugang der Mitglieder zur Buchung,
  Benachrichtigungen zu Buchungen, Auswertung der Platzauslastung
Rechtsgrundlage: [vom Verein festzulegen, zum Beispiel Mitgliedschaftsverhältnis nach Satzung]
Betroffene: Mitglieder, ehemalige Mitglieder, Gäste, die ein Mitglied mitbringt,
  Personen mit Verwaltungsrollen
Datenkategorien: siehe "Was Courtside speichert"
Empfänger: [Hosting-Anbieter], [Mail-Dienstleister], intern die Personen mit der Rolle
  Administrator und die Rollen, denen eine Buchungskarte die Verwaltung erlaubt
Übermittlung in Drittländer: [keine / Angabe des Landes und der Garantie]
Löschfristen:
  Buchungen: pseudonymisiert [Anzahl] Monate nach ihrem Ende
  Ehemalige Mitglieder: entfernt [Anzahl] Monate nach dem Ende der Mitgliedschaft
  Sitzungen: nach Inaktivität oder Ablauf, automatisch
  Betriebsprotokolle: [Aufbewahrung im eigenen Betrieb]
Technische und organisatorische Maßnahmen: siehe Vorlage 2
```

## Vorlage 2: Technische und organisatorische Maßnahmen

Die erste Liste beschreibt, was Courtside mitbringt. Die zweite füllt der Verein für seinen
Betrieb aus.

**Von Courtside bereitgestellt**

* Passwörter liegen nur als Argon2id-Hash vor. Fehlgeschlagene Anmeldungen werden begrenzt.
* Sitzungen liegen auf dem Server und enden nach Inaktivität oder Ablauf. Ein Konto kann alle
  eigenen Sitzungen beenden.
* Rollen begrenzen, wer die Verwaltung sieht. Kritische Schritte wie der Aufbewahrungslauf
  verlangen eine frische Passwortbestätigung.
* Formulare sind gegen gefälschte Anfragen geschützt.
* Das Änderungsprotokoll hält Verwaltungsänderungen ohne Namen und Freitexte fest.
* Anwendungsprotokolle enthalten keine Namen, E-Mail-Adressen oder Anfrageinhalte.
* Aufbewahrungsfristen setzt der Verein selbst. Jeder Lauf beginnt mit einer Vorschau und braucht
  eine ausdrückliche Bestätigung.

**Vom Verein auszufüllen**

```text
Betrieb des Servers: [eigener Server / Hosting-Anbieter, Vertrag zur Auftragsverarbeitung vom ...]
Verschlüsselung der Verbindung: [TLS über den mitgelieferten Reverse-Proxy / eigene Lösung]
Zugang zum Server: [Personen und Art des Zugangs]
Backups: [Ort, Häufigkeit, Verschlüsselung, Aufbewahrung]
Updates: [wer spielt Updates ein und wie oft]
Konten mit der Rolle Administrator: [Personen, Überprüfung mindestens jährlich]
Mailversand: [Dienstleister, Vertrag zur Auftragsverarbeitung]
Vorgehen bei einer Datenpanne: [zuständige Person, Meldeweg]
```

## Vorlage 3: Datenschutzerklärung der Anwendung

```text
Datenschutzhinweise zur Platzbuchung

Verantwortlich für die Platzbuchung ist [Name des Vereins], [Anschrift], [E-Mail-Adresse].
[Kontakt der datenschutzbeauftragten Person, falls benannt.]

Welche Daten wir verarbeiten
Für deine Mitgliedschaft speichern wir deinen Namen, deine E-Mail-Adresse, deine Mitgliedsart
und die Daten deiner Mitgliedschaft. Für die Anmeldung speichern wir deinen Benutzernamen, dein
Passwort als nicht umkehrbaren Hash, deine Sprache, deine Rollen und den Zeitpunkt der letzten
Anmeldung. Für die Platzbuchung speichern wir Platz, Zeit und Art deiner Buchungen, wer
mitspielt, die Namen von Gästen, die du einträgst, Notizen und ob eine Buchung wahrgenommen
wurde.

Wozu
Wir vergeben damit die Plätze, setzen die Buchungsregeln des Vereins durch, schicken dir
Nachrichten zu deinen Buchungen und werten die Auslastung der Anlage aus. Auswertungen nennen
keine Personen.

Rechtsgrundlage
[vom Verein festzulegen]

Wer die Daten sieht
Der Platzplan ist öffentlich und zeigt belegte Plätze mit der Zahl der Teilnehmenden, aber ohne
Namen. Namen siehst du nur bei deinen eigenen Buchungen. Personen mit Verwaltungsrollen sehen, was
ihre Aufgabe verlangt. [Hosting-Anbieter] und [Mail-Dienstleister]
verarbeiten Daten in unserem Auftrag.

Wie lange
Buchungen werden [Anzahl] Monate nach ihrem Ende pseudonymisiert: Name, Mitspielende, Gäste und
Notizen werden entfernt, Platz und Zeit bleiben für die Auslastung. Nach dem Ende deiner
Mitgliedschaft werden deine Daten nach [Anzahl] Monaten entfernt, sofern du dich in dieser Zeit
nicht angemeldet hast.

In deinem Browser
Die Anwendung speichert deine Sprache und dein Erscheinungsbild im Browser und hält deine kommenden
Buchungen für die Anzeige ohne Netz vor. Ein Cookie hält deine Anmeldung, ein zweites schützt
Formulare gegen gefälschte Anfragen. Es gibt keine Tracking- oder Werbedienste.

Deine Rechte
Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
Datenübertragbarkeit und Widerspruch sowie das Recht, dich bei einer Aufsichtsbehörde zu
beschweren. Wende dich dafür an [E-Mail-Adresse]. Dein Passwort änderst du selbst in der
Anwendung, alles andere korrigiert der Vorstand.

Stand: [Datum]
```
