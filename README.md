# Win-Challenge

Eine kleine Website für eure Win-Challenge: gemeinsame Spieleliste, Voting, Zeitmessung pro Spieler und ein Overlay für OBS.
Läuft komplett im Browser – keine Installation, kein Build, kein eigener Server. Der Abgleich zwischen euch läuft über
eine kostenlose Firebase Realtime Database; zum Ausprobieren geht es auch ohne (lokaler Modus).

**Online:** https://nicoftf.github.io/Win-Challenge/

## Seiten

| Seite | Datei | Zweck |
|---|---|---|
| Spiele | `index.html` | Spieleliste, Gesamtzeit, Zeit pro Spiel, „Gewonnen“-Haken, Spieler verwalten, Overlay-URL |
| Voting | `voting.html` | Spiele vorschlagen, abstimmen, Ergebnis als Spieleliste übernehmen |
| Overlay | `overlay.html` | Browser-Quelle für OBS (nur mit `?room=…&player=…` sinnvoll) |
| Overlay-Editor | `overlay-editor.html` | Aussehen des Overlays einstellen, Live-Vorschau, OBS-URL kopieren |

Spieleliste und Voting sind gemeinsam. Zeiten und Overlay-Einstellungen hat jeder Spieler für sich.

## Schnellstart lokal (ausprobieren)

Die Seite lädt JavaScript-Module und braucht deshalb einen Webserver. Doppelklick auf `index.html` funktioniert nicht.

1. Terminal im Projektordner öffnen.
2. `npm run serve` (braucht Node.js ab Version 22). Alternativ mit Python: `python3 -m http.server 8000`,
   unter Windows `py -m http.server 8000`.
3. Im Browser http://localhost:8000 öffnen.

Solange in `js/config.js` kein Firebase eingetragen ist, läuft die Seite im **lokalen Modus** (Hinweis „Lokaler Modus“ oben).
Alles wird nur in diesem Browser gespeichert: kein Abgleich mit den anderen, kein OBS-Overlay. Zum Kennenlernen reicht das.

## Firebase einrichten (für den echten Einsatz)

Du brauchst ein Google-Konto. Alles Folgende ist kostenlos (Tarif „Spark“), ohne Kreditkarte.

### 1. Projekt anlegen

1. https://console.firebase.google.com öffnen und anmelden.
2. „Projekt hinzufügen“ (bzw. „Projekt erstellen“). Name z. B. `win-challenge`.
3. Google Analytics **ausschalten** (Schalter aus) – wird nicht gebraucht.
4. „Projekt erstellen“ und kurz warten.

### 2. Realtime Database anlegen

Wichtig: **Realtime Database**, nicht „Firestore“. Das ist ein anderes Produkt und funktioniert mit dieser Seite nicht.

1. Im linken Menü „Realtime Database“ öffnen. Je nach Version der Konsole steht der Eintrag unter „Databases & Storage“
   oder (ältere Ansicht) unter „Build“ bzw. „Erstellen“ – ggf. die Kategorie erst aufklappen.
2. „Datenbank erstellen“.
3. Standort: `Belgium (europe-west1)`.
4. Sicherheitsregeln: „Im gesperrten Modus starten“ → „Aktivieren“.

### 3. Regeln einfügen

1. Auf der Realtime-Database-Seite den Reiter „Regeln“ öffnen.
2. Den vorhandenen Text komplett löschen und den gesamten Inhalt von `database.rules.json` einfügen.
3. „Veröffentlichen“.

Was die Regeln tun: Alles ist gesperrt, außer `rooms/RAUMCODE` – und dort darf jeder lesen und schreiben, der den Code kennt
(16–32 Zeichen, nur A–Z und 0–9). Der Name der Challenge ist auf 80 Zeichen begrenzt. Spieler, Spiele und Vorschläge
müssen vollständig sein: Schickt ein Gerät nach einer Offline-Phase veraltete Änderungen zu einem inzwischen gelöschten
Eintrag, entsteht kein halber Eintrag ohne Namen. Mehr prüfen die Regeln nicht.
Das ist bewusst einfach gehalten: kein Login, keine Konten. Der lange Zufallscode ist das Passwort (siehe „Sicherheit“).

**Ändert sich `database.rules.json` später** (z. B. nach einem Update der Seite), die Regeln genauso neu einfügen und
veröffentlichen. Die Datei im Repository wirkt nicht von selbst.

### 4. Web-App registrieren und Config kopieren

1. Oben links auf „Projektübersicht“ (Haus-Symbol).
2. Auf das Symbol `</>` („Web“) klicken.
3. App-Spitzname z. B. `win-challenge-web`. „Firebase Hosting“ **nicht** ankreuzen. „App registrieren“.
4. Es erscheint ein Codeblock mit `const firebaseConfig = { … };`. Nur diesen Block brauchst du – kopieren.
5. „Weiter zur Konsole“.

### 5. In `js/config.js` eintragen

`js/config.js` in einem Texteditor öffnen. Die Zeile

```js
export const firebaseConfig = null;
```

ersetzen durch deine Werte (Beispiel – deine Werte sehen ähnlich aus).

**Wichtig:** Vor `const` muss `export ` stehen. Der aus Firebase kopierte Block hat das nicht – bitte von Hand ergänzen.
Die alte Zeile `export const firebaseConfig = null;` muss danach weg sein. Das auskommentierte Beispiel unten in der
Datei (zwischen `/*` und `*/`) kann stehen bleiben, aber nicht zusätzlich „einkommentieren“.

```js
export const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "win-challenge-xxxx.firebaseapp.com",
  databaseURL: "https://win-challenge-xxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "win-challenge-xxxx",
  storageBucket: "win-challenge-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
```

**`databaseURL` muss enthalten sein.** Fehlt sie, startet die Seite ohne Fehlermeldung im lokalen Modus.
Wenn der kopierte Block keine `databaseURL` hat: Realtime Database → Reiter „Daten“. Oben steht die Adresse der Datenbank
(`https://…firebasedatabase.app`). Diese Adresse als `databaseURL: "…",` in den Block eintragen.

Prüfen: Seite neu laden. Der Hinweis „Lokaler Modus“ oben muss weg sein. Sobald du einen Raum anlegst, taucht er in der
Firebase-Konsole unter „Daten“ → `rooms` auf. Kommt beim „Anlegen“ die Meldung „Die Datenbank hat das abgelehnt“ oder
„Keine Leseberechtigung“: Regeln aus Schritt 3 prüfen (siehe FAQ).

### Kosten und Limits

Tarif „Spark“: kostenlos, keine Kreditkarte, kein Ablaufdatum. Limits der Realtime Database: 1 GB gespeicherte Daten,
10 GB Download pro Monat, 100 gleichzeitige Verbindungen. Eine Challenge belegt ein paar Kilobyte; vier Spieler plus
OBS sind ein paar Verbindungen. Ihr kommt nicht in die Nähe der Grenzen.

## Auf GitHub Pages veröffentlichen

> Für dieses Repository ist GitHub Pages schon eingerichtet: https://nicoftf.github.io/Win-Challenge/
> Änderungen (z. B. die Firebase-Werte in `js/config.js`) einfach committen und pushen, Zeile für Zeile
> (Windows PowerShell 5.1 kennt kein `&&`):
> ```bash
> git add -A
> git commit -m "Firebase eingetragen"
> git push
> ```
> Meldet `git commit` „nothing to commit“, war schon alles hochgeladen – dann wurde auch nichts Neues veröffentlicht.
> Nach ca. einer Minute ist die neue Version online. Die Schritte unten brauchst du nur für ein eigenes, neues Repository.

Damit alle die gleiche Adresse benutzen (und OBS von überall darauf zugreift), legst du die Dateien auf GitHub Pages ab.

1. Auf https://github.com ein neues Repository anlegen: „New repository“, Name z. B. `Win-Challenge`, „Public“, „Create“.
2. Alle Dateien und Ordner des Projektordners hochladen. Im Browser: Auf der noch leeren Repository-Seite auf den Link
   „uploading an existing file“ klicken (bei einem Repository mit Dateien: „Add file“ → „Upload files“), den Inhalt des
   Ordners hineinziehen, „Commit changes“. Oder per Git im Projektordner:
   ```bash
   git init -b main
   git add .
   git commit -m "Win-Challenge"
   git remote add origin https://github.com/DEIN-NAME/Win-Challenge.git
   git push -u origin main
   ```
   Die leere Datei `.nojekyll` muss mit (sie verhindert, dass GitHub die Seite umbaut). Versteckte Dateien sind im
   Dateimanager meist ausgeblendet – ggf. „Versteckte Dateien anzeigen“ einschalten.
3. Im Repository: „Settings“ → links „Pages“.
4. Unter „Build and deployment“: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → „Save“.
5. Nach 1–2 Minuten ist die Seite unter `https://DEIN-NAME.github.io/Win-Challenge/` erreichbar (steht oben auf der Pages-Seite).

Änderungen (z. B. an `js/config.js`) hochladen wie in Schritt 2 – nach wenigen Minuten sind sie online.
`js/config.js` mit den Firebase-Werten darf öffentlich sein (siehe „Sicherheit“).

### Alternativen zu GitHub Pages

- **Netlify Drop**: https://app.netlify.com/drop – Projektordner in die Fläche ziehen, fertig. Kostenlos, kein Git nötig.
- **Cloudflare Pages**: Dashboard → „Workers & Pages“ → „Create“ → „Pages“ → „Upload assets“ → Ordner hochladen.

Die Seite benutzt nur relative Pfade und läuft deshalb auch in einem Unterordner wie `/Win-Challenge/`.

## Benutzung

### Raum anlegen und Freunde einladen

1. Seite öffnen → „Neue Challenge anlegen“ → Name eingeben → „Anlegen“. Der Raum bekommt einen zufälligen Code
   (20 Zeichen). Er steckt im Einladungslink und in der Overlay-URL. Einzeln kopieren kannst du ihn über das
   Drei-Punkte-Menü in der Kopfzeile (ganz oben rechts, neben „Einladen“) → „Raum-Code kopieren“.
2. Die Seite fragt direkt „Wer bist du?“ → deinen Namen eintippen → „Los“ (siehe „Spieler wählen“).
3. Erst danach gibt es die Kopfzeile. Dort „Einladen“ klicken (auf dem Handy nur das Ketten-Symbol): kopiert den
   Einladungslink (`…/index.html?room=CODE`).
   Link an die anderen schicken.
4. Die anderen öffnen den Link und sind direkt im Raum. Alternativ: Seite öffnen → „Challenge beitreten“ → Code oder
   Link einfügen → „Beitreten“ (Groß-/Kleinschreibung und Leerzeichen sind egal).

Der Browser merkt sich den Raum. Beim nächsten Besuch landest du direkt wieder darin. Nach dem Öffnen entfernt die Seite
den Code aus der Adresszeile – zum Einladen deshalb immer den Button „Einladen“ benutzen, nicht die Adresse kopieren.

### Spieler wählen

Nach dem Anlegen oder Beitreten fragt die Seite „Wer bist du?“. Vorhandenen Namen anklicken oder neuen Namen eintippen → „Los“.
Jeder Spieler bekommt automatisch eine Farbe. Auf diesem Bildschirm gibt es auch „Anderen Raum wählen“.

**Challenge umbenennen oder andere Challenge öffnen:** Drei-Punkte-Menü in der Kopfzeile (ganz oben rechts, neben „Einladen“). Der Name darf höchstens 80 Zeichen lang sein.

**Spieler wechseln:** Auswahlfeld mit deinem Namen in der Kopfzeile. Die Wahl gilt nur für diesen Browser –
jeder wählt auf seinem Gerät sich selbst. Wer am selben PC sitzt, wechselt vor dem Starten kurz zu sich.

Spieler umbenennen, hinzufügen, entfernen: Spiele-Seite, Bereich „Spieler“. Entfernen löscht auch dessen Zeiten,
Overlay-Einstellungen und Voting-Stimmen.

### Voting

1. Voting-Seite → Spiele vorschlagen. Mehrere auf einmal: je Zeile eins oder mit Semikolon trennen.
   Gleiche Titel werden zusammengelegt (Groß-/Kleinschreibung egal). Andere Schreibweisen wie „MarioKart 8“ statt
   „Mario Kart 8“ bleiben getrennte Vorschläge.
2. Jeder gibt jedem Vorschlag eine Stimme (Regeln unter „Voting-System“).
3. Die Ergebnis-Tabelle aktualisiert sich live. Sie zeigt Rang, Spiel, Punkte, pro Spieler eine Spalte mit dessen
   Stimme und den Status („drin“, „knapp draußen“, „draußen“, „Veto“). Die Farbe eines Kästchens zeigt die Stimme
   (Kürzel siehe „Voting-System“), ein gestricheltes Kästchen heißt „noch nicht abgestimmt“. Eine Linie markiert die
   Grenze. Unter „Einstellungen“: Zielanzahl, Budgets, „Voting geschlossen“.
4. „Ergebnis als Spieleliste übernehmen“: die Spiele über der Grenze werden die neue Spieleliste.
   **Das ersetzt die vorhandene Liste und löscht die Zeiten aller Spieler.**

### Spiele und Zeiten

- „Challenge starten“ startet deine Gesamtzeit. Sie läuft unabhängig davon, ob gerade ein Spiel läuft.
- „Start“ an einem Spiel startet dessen Zeit. Läuft schon ein anderes Spiel, wird es automatisch pausiert – es läuft
  immer nur ein Spiel. Die Gesamtzeit startet mit, falls sie noch nicht läuft.
- „Pause“ am Spiel stoppt nur dieses Spiel, die Gesamtzeit läuft weiter. „Pause“ oben stoppt Gesamtzeit und Spiel.
- „Gewonnen“ stoppt das Spiel und hakt es ab. Geht auch, wenn das Spiel nie gestartet wurde (Zeit bleibt dann 00:00).
  Ist das letzte Spiel abgehakt, stoppt die Gesamtzeit automatisch und die Challenge gilt als beendet.
- „Zurück“ nimmt den Haken wieder weg (die Zeit bleibt). „Zeit zurücksetzen“ stellt die Zeit eines Spiels auf 00:00.
- „Challenge beenden“ stoppt alles. „Wieder aufnehmen“ lässt die Gesamtzeit weiterlaufen.
- „Meinen Fortschritt zurücksetzen“ (Drei-Punkte-Menü in der Gesamtzeit-Karte, rechts neben „Challenge starten“ bzw.
  „Pause“ – nicht das in der Kopfzeile) setzt deinen Fortschritt komplett zurück:
  Gesamtzeit, alle Spielzeiten **und alle „Gewonnen“-Haken**. Das betrifft nur dich – Spieleliste und die
  anderen Spieler bleiben.
- Umbenennen, Sortieren (Ziehen am Griff oder Menü „nach oben / nach unten“) und Entfernen gelten für alle.
  Entfernen löscht auch die Zeiten aller Spieler für dieses Spiel.

### Overlay in OBS

Overlay-Editor → Aussehen einstellen → URL „Kopieren“ → in OBS als Browser-Quelle einfügen. Details unter „OBS“.

### Overlay-Einstellungen

Alles im Overlay-Editor, jede Änderung ist sofort gespeichert und live in Vorschau und OBS. Die Einstellungen gelten
nur für dein Overlay. „Zurücksetzen“ stellt alles auf Standard, „Einstellungen übernehmen von“ kopiert das Aussehen
eines Mitspielers.

- **Stil**: Vorlage *Balken* (Standard: Titel im farbigen Balken, Spielnamen fett, zu lange Namen als Laufschrift,
  keine Nummern und Einzelzeiten, Gesamtzeit mit Status wie „– PAUSIERT“ zentriert unter der Liste, eckige Box ohne
  Rahmen und Schatten) oder *Klassisch* (Titel als Text, Nummern, Zeit je Spiel, Fortschritt, Gesamtzeit oben rechts,
  Namen mit „…“ gekürzt, abgerundete Box mit Rahmen und Schatten). Eine Vorlage setzt nur Aufbau und Form – Titeltext,
  Schriftart, Größen und Farben bleiben. Danach lässt sich alles einzeln ändern: „Titel als“ farbiger Balken oder Text,
  Titelgröße, „Gesamtzeit steht“ unter der Liste oder oben rechts, Gesamtzeit zentrieren und Status an/aus (beides nur
  bei Gesamtzeit unten), Namen fett, „Zu lange Spielnamen“: *Laufschrift* (die Zeile bleibt einzeilig; alle langen Namen
  stehen 2 Sekunden, laufen dann gemeinsam und gleich schnell los, jeder bleibt an seinem Ende stehen; ist auch der
  längste durch, springen nach 2 Sekunden alle zusammen an den Anfang – kein Zurückfahren, kein Ausblenden; kurze
  Namen stehen still), *umbrechen* oder *mit … kürzen*.
  Schriften mit nur einem Schnitt (z. B. Bebas Neue) werden nicht künstlich fett gerechnet.
- **Inhalt**: Titel (leer = Name der Challenge), Titel / Gesamtzeit / Fortschritt „3 / 22“ / Nummern / Zeit je Spiel
  ein- oder ausblenden. „Erledigte Spiele anzeigen“ aus = gewonnene Spiele verschwinden aus der Liste.
  „Erledigte darstellen als“: *Durchgestrichen* (Titel durchgestrichen in der Erledigt-Farbe), *Häkchen davor*
  (Häkchen in der Erledigt-Farbe vor dem Titel) oder *Abgeblendet* (gedämpfte Farbe, halb durchsichtig).
  „Aktives Spiel oben anpinnen“: Das laufende bzw. zuletzt gestartete Spiel steht als eigener Block direkt unter dem
  Kopf und scrollt nicht mit. Aus = es bleibt an seinem Platz in der Liste (trotzdem hervorgehoben).
  „Label am aktiven Spiel“: kleiner Text neben dem aktiven Spiel (Standard „Läuft“, leer = kein Label). Ist das Spiel
  pausiert, steht dort automatisch „Pausiert“.
- **Größe**: Breite und maximale Höhe der Box, Innenabstand, Zeilenabstand, Eckenradius, Rahmenbreite. Die Box wächst
  mit der Liste bis zur maximalen Höhe. „Schatten unter der Box“ braucht rechts und unten 16 px Platz: Die empfohlene
  Größe der OBS-Quelle ist dann 16 px breiter und höher als die Box (der Editor zeigt die passende Größe an).
- **Farben**: Hintergrund mit Deckkraft (unter 100 % scheint die Szene durch), *Titelbalken* (auch die Linie über der
  Gesamtzeit) und *Schrift im Titelbalken*, Rahmen, Text, *Gedämpft* („Pausiert“ am aktiven Spiel, abgeblendete
  Spiele, Nummern, Fortschritt, Zeiten 00:00), *Akzent* (aktives Spiel, laufende Zeit), *Erledigt* (gewonnene Spiele,
  Gesamtzeit nach dem Ende, Haken, Zeiten erledigter Spiele, Fortschrittsbalken).
- **Schrift**: Die Schriften aus der Liste lädt das Overlay automatisch von Google Fonts (OBS braucht dafür Internet).
  „Eigene …“ nimmt eine Schrift, die **auf dem OBS-Rechner installiert** sein muss – sie wird nicht nachgeladen; fehlt
  sie dort, zeigt OBS eine Standardschrift. Dazu Schriftgröße (Spielnamen, Gesamtzeit; die Titelgröße steht unter „Stil“) und „Schrift für Zeiten“ („wie Text“ oder
  eine Monospace-Schrift, damit die Ziffern beim Ticken nicht springen).
- **Verhalten**: Auto-Scroll läuft **nur, wenn die Liste nicht in die maximale Höhe passt**. Dann scrollt sie endlos
  nach oben (nach dem letzten Spiel kommt wieder das erste). „Scroll-Tempo“ in Pixel pro Sekunde, 0 = kein Auto-Scroll
  (die Liste wird dann unten abgeschnitten). „Pause pro Runde“: So viele Sekunden steht die Liste am Anfang jeder Runde
  still.

## Voting-System

Jeder Spieler gibt jedem Vorschlag eine von fünf Stimmen:

| Stimme | Kürzel | Farbe | Punkte | Bedeutung |
|---|---|---|---|---|
| Muss rein | `!!` | weiß | +3 | Will ich unbedingt spielen – **begrenzt**, Standard 5 pro Spieler |
| Gerne | `+` | grün | +1 | Fände ich gut |
| Egal | `·` | grau | 0 | Kann, muss aber nicht |
| Lieber nicht | `−` | rot umrandet | −1 | Hätte ich lieber nicht drin |
| Veto | `X` | rot gefüllt | 0 | Auf keinen Fall – das Spiel fliegt raus. **Begrenzt**, Standard 2 pro Spieler |

Die Kürzel stehen in der Ergebnis-Tabelle und auf dem Handy auf den Stimm-Buttons. Die Erklärung „So funktioniert das
Voting“ oben auf der Voting-Seite zeigt sie ebenfalls.

So wird ausgewertet:

- **Punkte** eines Spiels = Summe der Punkte aller Stimmen. Keine Stimme zählt wie 0.
- **Veto**: Ein einziges Veto reicht, das Spiel ist raus – egal, wie viele Punkte es hat. Es bekommt keinen Rang und
  steht ganz unten in der Tabelle.
- **Reihenfolge**: Punkte absteigend. Bei Gleichstand gewinnt das Spiel mit mehr „Muss rein“, dann mehr „Gerne“,
  dann weniger „Lieber nicht“, zuletzt der ältere Vorschlag.
- **Zielanzahl** (Standard 15): Die oberen 15 nicht-vetoten Spiele sind „drin“. Bis zu 3 Plätze hinter der Grenze
  (Platz 16–18) steht „knapp draußen“, danach „draußen“. Zielanzahl 0 = alle nicht-vetoten Spiele kommen rein.
- **Budgets**: „Muss rein“ und Veto sind pro Spieler begrenzt (Standard 5 und 2). 0 = unbegrenzt. Ist das Budget
  voll, kommt eine Fehlermeldung – erst eine bestehende „Muss rein“- bzw. Veto-Stimme ändern. Nochmal auf die
  aktive Stimme klicken entfernt sie.
- **Geschlossen**: Ist „Voting geschlossen“ aktiv, kann niemand mehr abstimmen, vorschlagen oder Vorschläge
  umbenennen bzw. entfernen. Das Ergebnis bleibt sichtbar.
- Stimmen für gelöschte Vorschläge und Stimmen entfernter Spieler zählen nicht.
- **Übernehmen**: „Ergebnis als Spieleliste übernehmen“ macht genau die Spiele mit Status „drin“ (in dieser Reihenfolge)
  zur neuen Spieleliste. Die alte Liste und **alle Zeiten aller Spieler** werden dabei gelöscht.
- Umgekehrt geht auch: „Spieleliste als Vorschläge übernehmen“ holt vorhandene Spiele ins Voting (ohne Doppelte).

## Sicherheit

- **Der Raum-Code ist das Passwort.** 20 zufällige Zeichen, praktisch nicht zu erraten. Wer den Code oder den
  Einladungslink hat, kann alles im Raum lesen, ändern und löschen – auch die Zeiten der anderen.
- Einladungslink nur direkt an die Mitspieler schicken. Nicht in öffentliche Discord-Kanäle, in den Stream-Chat oder
  auf Social Media posten.
- Die Overlay-URL enthält den Code ebenfalls. Beim Einrichten von OBS nicht live zeigen.
- Die Firebase-Config in `js/config.js` (`apiKey` usw.) ist **kein** Geheimnis. Sie sagt nur, welches Projekt gemeint
  ist. Der Schutz sind die Datenbank-Regeln plus der Raum-Code. Die Config darf mit auf GitHub.
- Die Regeln in `database.rules.json` sind bewusst einfach: kein Login, keine Nutzerkonten, kaum Prüfung der
  einzelnen Felder (nur die Länge des Challenge-Namens und dass Spieler, Spiele und Vorschläge vollständig sind).
  Für eine Runde unter Freunden reicht das.
  Keine persönlichen Daten in den Raum schreiben.
- Code weitergegeben oder aus Versehen gezeigt? **Zuerst** den alten Raum in der Firebase-Konsole löschen:
  Realtime Database → „Daten“ → `rooms` → Eintrag mit dem Code → löschen (Symbol bzw. Menü am Eintrag).
  Spieleliste, Voting und Zeiten dieses Raums sind damit weg. Die Seite meldet danach „Diesen Raum gibt es nicht (mehr)“
  und zeigt „Neue Challenge anlegen“ – dort den neuen Raum anlegen und den neuen Einladungslink verschicken.
  Hängt die Seite noch im alten Raum, kommst du auch über das Drei-Punkte-Menü in der Kopfzeile (ganz oben rechts, neben „Einladen“) → „Andere Challenge öffnen“ zu
  „Neue Challenge anlegen“. Das ersetzt aber nicht das Löschen: Ohne Löschen bleibt der alte Raum für jeden mit dem
  Code zugänglich.
- Backup: Realtime Database → „Daten“ → Menü mit den drei Punkten → „JSON exportieren“.

## OBS

1. Overlay-Editor öffnen, Aussehen einstellen. Die Vorschau rechts zeigt das echte Overlay.
2. In der OBS-Karte auf „Kopieren“ (URL). Die empfohlene Größe (Breite × Höhe) steht darunter, Standard 320 × 560
   (genau die Box; mit „Schatten unter der Box“ 16 px breiter und höher).
3. OBS: „Quellen“ → „+“ → „Browser“ → Namen vergeben → „OK“.
4. URL einfügen, Breite und Höhe wie im Editor angezeigt eintragen, alles andere lassen → „OK“.

Hinweise:

- Das Overlay hat einen transparenten Hintergrund. Die Box selbst bekommt Farbe und Deckkraft aus deinen Einstellungen.
- Änderungen im Overlay-Editor erscheinen sofort in OBS. Kein Neuladen nötig.
- Die Option „Seite neu laden, wenn Szene aktiv wird“ (Name je nach OBS-Version leicht anders) kann eingeschaltet
  bleiben; nötig ist sie nicht.
- Jeder Spieler hat seine eigene Overlay-URL (mit seiner `player=`-Kennung) und sieht darin nur seine Zeiten.
- OBS braucht Internet: Die Daten kommen aus Firebase, die Schriften von Google Fonts.
- Im lokalen Modus zeigt OBS nichts – OBS ist ein eigener Browser und sieht die lokal gespeicherten Daten nicht.
- Testen ohne OBS: Overlay-URL im normalen Browser öffnen. Mit `&preview=1` am Ende werden Beispielspiele angezeigt,
  falls die Liste noch leer ist.

## Technik

- Statische Dateien: HTML, CSS, JavaScript (ES-Module). Kein Build, keine npm-Pakete, kein Server-Code.
  `package.json` enthält nur Befehle für Entwicklung und Tests, die Website braucht sie nicht.
- Templates mit **lit-html 3.3.3** (liegt in `vendor/`).
- Online-Modus: **Firebase JS SDK 12.19.0** wird beim Laden von `www.gstatic.com` nachgeladen. Lokaler Modus:
  `localStorage`; offene Tabs im selben Browser gleichen sich per BroadcastChannel ab.
- Schriften: IBM Plex Sans / IBM Plex Mono über Google Fonts (Overlay: wählbare Google Fonts).
- Zeiten: Gespeichert werden die bisher gesammelten Millisekunden plus der Startzeitpunkt (Serverzeit). Die Anzeige
  rechnet lokal weiter, deshalb tickt sie flüssig und stimmt auf allen Geräten überein.

Dateien:

| Pfad | Inhalt |
|---|---|
| `index.html`, `voting.html`, `overlay-editor.html`, `overlay.html` | Seiten |
| `js/config.js` | Firebase-Config (oder `null` = lokaler Modus) |
| `js/store.js` | Datenzugriff: Firebase Realtime Database oder localStorage |
| `js/model.js` | Datenmodell, Timer-Logik, Voting-Auswertung, alle Aktionen |
| `js/shell.js` | Gemeinsamer Rahmen: Raum/Spieler-Onboarding, Kopfzeile, Dialoge |
| `js/icons.js` | Icons |
| `js/pages/` | Logik der einzelnen Seiten |
| `css/` | Styles (`base.css` gemeinsam, je Seite eine Datei) |
| `vendor/lit-html/` | lit-html |
| `database.rules.json` | Regeln für die Realtime Database |
| `.nojekyll` | leer; verhindert Umbauen durch GitHub Pages |
| `scripts/serve.mjs` | kleiner Webserver für die Entwicklung (Node, ohne Cache) |
| `tests/` | automatische Tests (Logik und kompletter Ablauf im Browser) |
| `CLAUDE.md` | Projektwissen für Claude Code (Aufbau, Regeln, offene Punkte) |

Datenmodell in der Datenbank (alles unter `rooms/CODE/`): `meta` (Name), `players`, `games` (gemeinsame Liste),
`runs` (Zeiten je Spieler), `overlay` (Einstellungen je Spieler), `voting` (Einstellungen, Vorschläge, Stimmen).
Details stehen als Kommentar oben in `js/model.js`.

### Entwicklung und Tests

Braucht nur Node.js ab Version 22.4 (https://nodejs.org), keine Installation von Paketen.

```bash
npm run serve          # Website auf http://localhost:8000
npm test               # Logik-Tests (Timer, Voting, Speicher)
npm run test:browser   # alle Seiten im unsichtbaren Chrome/Edge durchklicken
```

Der Browser-Test findet Chrome, Edge oder Chromium selbst (sonst Pfad in der Umgebungsvariable `CHROME` angeben)
und legt Screenshots in `tests/.shots/` ab. Er läuft nur im lokalen Modus: Ist Firebase in `js/config.js`
eingetragen, bricht er ab, damit keine Testdaten in eurer echten Datenbank landen.

## FAQ

**Die Zeiten weichen zwischen zwei Geräten ab.**
Timer speichern den Startzeitpunkt als Firebase-Serverzeit; jedes Gerät rechnet mit seiner Uhr plus einer Korrektur,
die Firebase liefert. Abweichungen unter einer Sekunde direkt nach dem Verbinden sind normal. Bei mehr: Uhrzeit des
Geräts auf „automatisch“ stellen. Im lokalen Modus zählt nur die Uhr des PCs.

**Die Seite zeigt wieder „Neue Challenge anlegen“ (ohne Fehlermeldung) – ist der Raum weg?**
Nein. Der Browser hat nur vergessen, welcher Raum deiner ist (Browserdaten gelöscht, Inkognito-Fenster, anderer
Browser oder anderes Gerät). Einladungslink erneut öffnen oder bei „Challenge beitreten“ einfügen (der ganze Link
geht, der Code steckt darin). Deshalb: Einladungslink irgendwo aufheben. Ist er weg, kann ihn ein Mitspieler per
„Einladen“ neu kopieren.

**Wie wechsle ich in einen anderen Raum?**
Drei-Punkte-Menü in der Kopfzeile (ganz oben rechts, neben „Einladen“) → „Andere Challenge öffnen“. Danach „Challenge beitreten“ (Code oder Link einfügen)
oder „Neue Challenge anlegen“. Oder direkt den Einladungslink des anderen Raums öffnen (`…?room=CODE`).
Der Browser merkt sich immer nur einen Raum – den alten erreichst du über seinen Einladungslink wieder.

**Wie wechsle ich den Spieler?**
Auswahlfeld in der Kopfzeile. Die Auswahl gilt nur für diesen Browser.

**Firebase ist eingetragen, trotzdem steht oben „Lokaler Modus“.**
Meist fehlt `databaseURL` in `js/config.js` oder der Name ist anders geschrieben (genau so: `databaseURL`).
Oder der Browser hat die alte Datei noch: Strg+F5.

**Die Seite bleibt komplett leer (nicht einmal „Lade …“).**
Meist ein Fehler in `js/config.js`. Die häufigsten: `export ` vor `const firebaseConfig` fehlt, `firebaseConfig` steht
zweimal in der Datei (alte `= null`-Zeile nicht gelöscht), oder ein Tippfehler (fehlendes Komma, Anführungszeichen
oder Klammer). Dann startet keins der Skripte. Im Browser F12 → „Konsole“ zeigt den Fehler mit Zeilennummer.

**„Keine Leseberechtigung – sind die Regeln aus database.rules.json veröffentlicht?“**
Die Datenbank lässt die Seite den Raum nicht lesen. Prüfen: Sind die Regeln aus „3. Regeln einfügen“ wirklich
veröffentlicht (Reiter „Regeln“ muss den Inhalt von `database.rules.json` zeigen)? Die Seite versucht es alle
10 Sekunden neu, nach dem Veröffentlichen ist die Meldung also von selbst weg (OBS genauso).

**„Die Datenbank hat das abgelehnt – vielleicht hat es gerade jemand gelöscht.“**
Einmalig: Jemand hat den Eintrag (Spiel, Spieler, Vorschlag) gerade entfernt, während du ihn geändert hast – nichts zu
tun. Kommt die Meldung bei jeder Aktion, auch beim „Anlegen“: Regeln wie oben prüfen. Im Browser F12 → „Konsole“
steht dann ein Fehler mit `permission_denied`.

**„Kein Raum mit diesem Code gefunden.“**
Code oder Link beim Beitreten prüfen (am besten den ganzen Einladungslink einfügen).

**„Diesen Raum gibt es nicht (mehr).“**
Der gespeicherte Raum wurde gelöscht, oder der Browser kennt noch einen Raum aus dem lokalen Modus – den gibt es in
Firebase nicht. Einfach neu anlegen oder mit dem Einladungslink beitreten.

**Beim „Beitreten“ kommt „Keine Verbindung zur Datenbank“.**
Keine Verbindung zu Firebase (Internet, Adblocker oder Firewall blockt `firebasedatabase.app`). Siehe „Keine Verbindung“.
„Anlegen“ klappt auch offline: Der Raum erscheint sofort und wird gespeichert, sobald die Verbindung da ist – Seite bis
dahin offen lassen.

**„Firebase konnte nicht geladen werden.“**
Das Firebase-SDK ließ sich nicht laden (kein Internet, Adblocker/Firewall blockt `gstatic.com`), oder ein Wert in
`js/config.js` ist ungültig (z. B. `databaseURL` ist keine richtige Adresse).

**Oben steht „Keine Verbindung“.**
Die Seite erreicht die Datenbank nicht: Du bist offline, oder ein Adblocker/Firewall blockt `firebasedatabase.app`.
Wird die Seite in dem Zustand geladen, bleibt sie meist bei „Lade …“ stehen (der Hinweis erscheint dann nach 3 Sekunden).
Änderungen ohne Verbindung werden nachgetragen, sobald die Verbindung zurück ist, aber nur, solange der Tab offen
bleibt. Neu laden, Schließen oder ein Wechsel auf eine andere Seite (Spiele/Voting/Overlay) verwirft sie – der Browser
fragt deshalb vorher nach („Seite verlassen?“). Dort „Abbrechen“ wählen und warten, bis der Hinweis weg ist.

**OBS zeigt nichts.**
Reihenfolge prüfen: Läuft die Seite im Online-Modus (kein Hinweis „Lokaler Modus“ oben)? Enthält die URL `room=` und `player=`?
Sind Breite und Höhe in der Browser-Quelle größer als 0? Danach in OBS bei der Quelle auf „Aktualisieren“ klicken.

**Kann jemand Fremdes unsere Daten sehen?**
Nur mit dem Raum-Code. Ohne Code lässt die Datenbank nichts durch – auch keine Liste aller Räume.

**GitHub meldet „Secrets detected – Google API Key“ in `js/config.js`.**
Erwartet und kein Leck: Das ist der `apiKey` der Firebase-Web-Config. Er muss im Code der Website stehen (jeder Browser
bekommt ihn ohnehin) und öffnet nichts – der Schutz sind die Datenbank-Regeln und der Raum-Code. Im Spark-Tarif ohne
Zahlungsmittel können auch keine Kosten entstehen. Einen neuen Schlüssel zu erzeugen bringt nichts, er wäre genauso
öffentlich. Optional den Schlüssel auf eure Seite beschränken: Google Cloud Console → „APIs & Dienste“ → „Anmeldedaten“
→ „Browser key (auto created by Firebase)“ → Anwendungseinschränkungen „Websites“ → `https://nicoftf.github.io/*`
eintragen → Speichern (die Datenbank-Verbindung nutzt den Schlüssel nicht, dadurch geht nichts kaputt). Danach die
Meldung auf GitHub schließen: Repository → „Security“ → „Secret scanning“ → Meldung öffnen → „Close as“ → „Won't fix“.

**Mehr als vier Spieler?**
Geht. Es gibt acht Farben, danach wiederholen sie sich.

**Alles löschen und neu anfangen?**
Drei-Punkte-Menü in der Kopfzeile (ganz oben rechts, neben „Einladen“) → „Andere Challenge öffnen“ → „Neue Challenge anlegen“. Der alte Raum bleibt dabei in
der Datenbank. Ganz löschen: Firebase-Konsole → Realtime Database → „Daten“ → `rooms` → Eintrag mit dem Code → löschen.
Nur deinen eigenen Fortschritt zurücksetzen: Spiele-Seite → Drei-Punkte-Menü in der Gesamtzeit-Karte → „Meinen
Fortschritt zurücksetzen“. Das löscht deine Gesamtzeit, alle deine Spielzeiten und alle deine „Gewonnen“-Haken – das muss
jeder Spieler selbst machen. Nur die Zeit eines einzelnen Spiels: Menü am Spiel → „Zeit zurücksetzen“. Die Zeiten
aller Spieler auf einmal löscht nur „Ergebnis als Spieleliste übernehmen“ auf der Voting-Seite.
