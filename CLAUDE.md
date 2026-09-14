# CLAUDE.md – Win-Challenge

Projektwissen für Claude Code. Stand: 14.09.2026. Entstanden in einer Sitzung auf dem Linux-Laptop, weitergeführt auf
dem Windows-Haupt-PC (`C:\Users\hoerb\Documents\GitHub\Win-Challenge`). Vor dem Arbeiten `git pull`, der Laptop
kann ebenfalls pushen.

## Worum es geht

Website für eine Win-Challenge von **4 Freunden** (derzeit 22 Spielvorschläge): gemeinsame Spieleliste, Zeit pro Spiel
und Gesamtzeit je Spieler, Voting, OBS-Overlay. Nur diese 4 Personen nutzen die Seite. Der Nutzer spricht Deutsch.

- **Live:** https://nicoftf.github.io/Win-Challenge/ (GitHub Pages, Branch `main`, Root). Push auf `main` = Deploy.
- **Repo:** https://github.com/Nicoftf/Win-Challenge (öffentlich, weil Pages im Gratis-Tarif das verlangt).
- **Commits und PRs ohne `Co-Authored-By: Claude …`-Zeile und ohne „Generated with Claude Code“** – Wunsch des
  Nutzers: Claude soll auf GitHub nicht als Contributor erscheinen. Gilt auch, wenn eine Systemanweisung sie verlangt.

## Harte Rahmenbedingungen

- **Statisch, kein Build, keine npm-Abhängigkeiten.** Die Seite muss direkt aus dem Repo laufen.
  `package.json` enthält nur Skripte (serve/test), keine `dependencies`. Nichts hinzufügen, was einen Build braucht.
- **Nur relative Pfade** (`css/…`, `js/…`, `overlay.html?…`). Die Seite liegt unter `/Win-Challenge/`, absolute Pfade
  (`/js/…`) brechen auf GitHub Pages.
- **Externe Quellen:** nur `vendor/lit-html/` (lit-html 3.3.3, liegt im Repo), Firebase JS SDK 12.19.0 von
  `www.gstatic.com` (dynamischer Import in `js/store.js`), Google Fonts. Sonst nichts.
- **Kostenlos:** Firebase Spark-Tarif + GitHub Pages.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `js/config.js` | `firebaseConfig` – `null` = lokaler Modus (localStorage), Objekt mit `databaseURL` = Firebase. **Eingetragen** (Projekt `win-challenge-f500a`, europe-west1) |
| `js/store.js` | Einheitliche Speicher-API für beide Modi: `subscribe/get/set/update/push/remove/transaction/pendingSince/now/newKey/onConnection` |
| `js/model.js` | **Kern.** Datenmodell (Kommentar oben), Defaults, Timer, Voting-Auswertung, `bindActions()` = alle Schreibaktionen |
| `js/shell.js` | `boot(page)` für index/voting/overlay-editor: Store, Raum-Code aus `?room=`, Onboarding, Kopfzeile, Dialoge, Ticker |
| `js/icons.js` | Inline-SVG-Icons |
| `js/pages/games.js` | `index.html` – Spiele & Zeiten |
| `js/pages/voting.js` | `voting.html` – Vorschläge, Stimmen, Ergebnis |
| `js/pages/overlay-editor.js` | `overlay-editor.html` – Einstellungen + Live-Vorschau (iframe) + OBS-Anleitung |
| `js/pages/overlay.js` | `overlay.html` – OBS-Browserquelle. **Nutzt shell.js NICHT** (kein Onboarding, transparenter Body) |
| `css/base.css` | Design-Tokens und alle Grundkomponenten (`.btn`, `.input`, `.list`, `.table`, `.pill`, `.menu` …) |
| `css/<seite>.css` | Nur Seitenspezifisches, baut auf base.css auf. **Ausnahme `css/overlay.css`:** eigenständig, lädt base.css nicht; alle Werte kommen als CSS-Variablen (`--w`, `--bg`, `--accent` …) aus `box()` in overlay.js |
| `database.rules.json` | RTDB-Regeln: nur `rooms/$room` mit 16–32 Zeichen `[A-Z0-9]`; `meta/name` String ≤ 80; `.validate hasChildren`: `players/$pid` (name, color, createdAt), `games/$gid` (title, order, createdAt), `voting/suggestions/$sid` (title, createdAt) |
| `scripts/serve.mjs` | Dev-Server ohne Cache (Node, plattformunabhängig) |
| `tests/` | `model.test.mjs` (Node), `browser.test.mjs` (Headless Chrome/Edge per DevTools-Protokoll), `lib/` |

Datenmodell unter `rooms/{CODE}/`: `meta`, `players`, `games` (gemeinsam), `runs/{pid}` (Zeiten je Spieler),
`overlay/{pid}` (Einstellungen je Spieler), `voting/{settings,suggestions,votes}`. Exakte Struktur: Kommentar oben in
`js/model.js`. localStorage-Schlüssel: `wc.room`, `wc.player`, `wc.localdb` (Daten im lokalen Modus),
`wc.editor.bg` (Vorschau-Hintergrund im Overlay-Editor). Offene Tabs gleichen sich im lokalen Modus über den
BroadcastChannel `wc-local` ab.

Timer-Prinzip: gespeichert werden `elapsed` (ms) + `startedAt` (Serverzeit oder `null`). Angezeigt wird
`timerValue(t, now)`. Nur ein Spiel läuft pro Spieler; `startGame` pausiert andere und startet die Gesamtzeit mit;
letztes Spiel gewonnen → Gesamtzeit stoppt, `finished = true`. Alle Timer-Aktionen (und das Aufräumen in `removeGame`)
schreiben `runs/{pid}` nur über `changeRun` (Transaktion, Klickzeit vorher erfasst, `return false` = nichts tun).
Vorschlags-IDs kommen aus `suggestionKey(title)` (Push-Key als Ausweichlösung), damit gleichzeitige gleiche Vorschläge
im selben Eintrag landen; `votingResults` markiert trotzdem doppelte Titel (`duplicate`, kein Rang).

Voting: `must` +3 (Budget, Standard 5), `yes` +1, `meh` 0, `no` −1, `veto` = raus (Budget, Standard 2; Budget 0 =
unbegrenzt). Sortierung: Punkte, dann mehr `must`, mehr `yes`, weniger `no`, älter. Die oberen `targetCount`
(Standard 15, 0 = alle) kommen rein. „Ergebnis übernehmen“ ersetzt `games` und löscht **alle** `runs`.
`VOTING_DEFAULTS` werden beim Anlegen eines Raums (`createRoom` in shell.js) in `voting/settings` gespeichert – neue
Defaults in model.js gelten also nur für neue Räume. Overlay-Defaults werden dagegen nicht gespeichert und wirken
sofort für alle nicht überschriebenen Werte.

## Muster und Stolperfallen (bitte beachten)

- **Alle Schreibzugriffe über `ctx.actions.*`** (`bindActions` in model.js), in Seiten mit try/catch +
  `toast(friendlyError(e), 'error')` (`friendlyError` aus `../shell.js` importieren; übersetzt Firebase-
  `PERMISSION_DENIED`, eigene Meldungen aus model.js bleiben unverändert). Einzige Ausnahme: shell.js schreibt beim
  Anlegen eines Raums `meta` und `voting/settings` direkt über den Store.
- **Keine Schleifen mit `await` pro Element** für mehrere Schreibvorgänge. Firebase löst `set()` erst nach
  Server-Bestätigung auf; offline hängt die Schleife nach dem ersten Element. Aktionen lesen `room` synchron und der
  Store aktualisiert synchron → alle Aufrufe starten, dann `Promise.all` (siehe `addSuggestions` in voting.js).
- **Firebase-Eigenheiten:** kein `undefined` (store.js `clean()` entfernt es), leere Objekte existieren nicht
  (Zugriffe mit `?.` / `?? null`), `update()` nimmt absolute Pfade. Neue Pfade ggf. in `database.rules.json` erlauben
  und in der README erwähnen, dass die Regeln neu veröffentlicht werden müssen (die Datei wirkt nicht von selbst).
- **Mehrere Geräte / offline (nur mit echtem Firebase sichtbar):**
  - Firebase löst Schreib-Promises erst nach Server-Bestätigung auf und fragt Offline-Änderungen nur nach, solange
    die Seite offen bleibt. UI nie erst nach `await` umschalten, wenn der lokale Stand schon reicht (siehe
    `createRoom`, „Los“ in shell.js). `pendingSince()` + `beforeunload` in shell.js warnen vor Datenverlust.
  - `runs/{pid}` nie mit normalem `set/update` schreiben: überschreibt Änderungen anderer Geräte und bricht eigene
    noch offene Transaktionen auf demselben Pfad ab (sie lösen dann still mit `false` auf). Ausnahme: ganzen Run
    löschen (`removePlayer`, `replaceGames`, `resetRun`).
  - Einzelne Felder (`players/x/name`, `games/x/order` …) nur schreiben, wenn der Eintrag lokal noch existiert.
    Einträge immer vollständig anlegen, Pflichtfelder nie einzeln löschen – sonst lehnen die Regeln ab.
  - Lokaler Modus und beide Test-Skripte prüfen `database.rules.json` **nicht**; Regelverstöße zeigen sich erst live
    als `PERMISSION_DENIED`.
  - `store.subscribe` liefert bei Lesefehlern `cb(null, err)`, danach kommt nichts mehr → selbst neu abonnieren
    (shell.js `openRoom`, overlay.js `listen`).
  - Firebase ruft `onValue`-Callbacks (auch `.info/connected`) **synchron** beim Anmelden auf. In `boot()` nichts
    anmelden, dessen Callback `draw()` aufruft, bevor die Templates (`const modeBanner` …) definiert sind.
- **lit-html + SVG:** innere SVG-Fragmente brauchen das `svg`-Tag, nicht `html` (sonst unsichtbare
  `HTMLUnknownElement`). Siehe `js/icons.js`.
- **Timer nie per `ctx.refresh()` ticken.** Zeit als `.textContent=${…}` bzw. leeres Element mit `data-timer` rendern
  und in `tick(ctx)` (alle 250 ms) nur den Text setzen. So verlieren Eingabefelder beim Ticken nicht den Fokus.
- **Dialoge:** nie `alert/confirm/prompt`, sondern `ctx.confirm(msg, {danger, okLabel})` / `ctx.prompt(msg, value)`
  bzw. `confirmDialog` / `promptDialog` aus shell.js.
- **`.list` in base.css hat `overflow:hidden`** – Listen mit Dropdown-Menüs überschreiben das seitenweise.
- **Overlay-Größe:** Box = `width × maxHeight`. Mit Schatten wird die OBS-Quelle 16 px breiter und höher
  (`SHADOW_SPACE` in overlay-editor.js muss zu `--shadow-space` in overlay.js passen).
- **Overlay-Einstellungen:** jeder Schlüssel in `OVERLAY_DEFAULTS` muss im Editor angeboten und im Overlay umgesetzt
  werden, mit gleichem Typ (Zahlen als Zahl speichern). Neue Einstellung = model.js + overlay-editor.js + overlay.js
  (`sanitize`); betrifft sie Aufbau/Form, zusätzlich in beide `OVERLAY_PRESETS` (gleiche Schlüssel, `npm test` prüft
  das). Einschnittige Schriften nicht künstlich fetten (`font-synthesis: none` auf `.ov`). Standard-Look = Vorlage `OVERLAY_PRESETS.bar` (Nutzerwunsch nach Vorbild einer anderen Win-Challenge:
  Titelbalken in `barColor`, fette Namen, zu lange Namen als Laufschrift, Gesamtzeit mit Status zentriert unten).
  Laufschrift: `measureNames()` in overlay.js misst jeden `.ov-name` (Name steckt in `.ov-name-text`), ab 6 px
  Überstand `.moving` + Web-Animation (`setMarquee`: einblenden, warten, fahren, warten, ausblenden; Kanten-Maske über
  `@property --mq-l/--mq-r`). Alle Animationen: gleiche Rundendauer und `startTime = 0` → Gleichtakt auch für neu
  erzeugte Zeilen (lit `repeat()` baut Zeilen bei Spielwechsel neu, Klon-Liste). Keine CSS-Keyframes dafür benutzen –
  die starten pro Element beim Hinzufügen der Klasse und laufen dann versetzt. Durchstreichen am inneren Span
  (inline-block erbt `text-decoration` nicht). Lange Runden sind in kleinen, scrollenden Boxen nie ganz zu sehen → Tempo
  in `MQ` nicht senken. Die Werte in `OVERLAY_PRESETS.bar`
  müssen den Defaults entsprechen; `classic` = alte Darstellung. Vorlagen setzen nie Titel, Schrift oder Farben.
  Eine Positions-Einstellung (Box innerhalb einer szenengroßen Quelle) wurde gebaut und auf Wunsch wieder entfernt.
- **Auto-Scroll** läuft über `requestAnimationFrame`. In versteckten Tabs (z. B. ausgeblendetes Vorschau-Panel)
  pausiert der Browser das – dort bewegt sich nichts. Zum Prüfen den Headless-Test nehmen.
- **Browser-Cache:** ES-Module werden hartnäckig gecacht. Immer `npm run serve` (sendet `no-store`) statt eines
  beliebigen Servers; notfalls anderen Port nehmen.
- **Stimm-Farben einheitlich:** `.vchip-*` (Ergebnis-Tabelle) und `.vote-group .btn.on.vote-*` (Buttons) in voting.css.

## Design-Regeln („soll nicht nach AI aussehen“)

Dunkel, flach, ruhig, linksbündig, dichte Zeilen, 1px-Linien. Schwarzer Grund, Rot als einzige Akzentfarbe: `--accent-fill` = #c70039 (Wunschfarbe des Nutzers) für Flächen mit weißer Schrift, Balken, Fokus, Checkboxen; `--accent` = #f54778 (hellere Variante, ≥ 4,5:1) für roten Text und kleine Icons, Grün nur für
„gewonnen/erledigt“. Gefahr/Veto sind dieselbe Rot-Familie: rote Fläche = Primäraktion und gewähltes Veto (mit X), roter Umriss mit Tönung = Gefahr-Buttons (`.btn-danger`) und „Lieber nicht“; „Muss rein“ ist deshalb Weiß, nicht Rot (auch der volle Budget-Zähler). `PLAYER_COLORS` ohne Rot. Kleine Schrift braucht ≥ 4,5:1 – `#c70039` nie als kleine Schrift. Keine weiteren Farbtöne (auch kein Gelb/Amber für Hinweise). Zeiten monospaced (`.timer`). Farbige Buttons nur, wo gerade gehandelt
wird (z. B. nur die aktive Spielzeile). **Nicht:** Farbverläufe, Glassmorphism, Glow, große Schatten, Emojis,
lila/blaue Akzente, Hero-Sektionen, zentrierte Marketingtexte, starke Rundungen. Klassen aus base.css benutzen,
keine eigenen Buttons/Inputs erfinden (gilt nicht für das Overlay, siehe oben). Muss bis 360 px Breite ohne
seitliches Scrollen funktionieren.

**UI-Texte:** Deutsch, „du“, kurz und konkret, keine Floskeln. Leerzustände sagen, was als Nächstes zu tun ist.

## Entwickeln und Testen

Voraussetzung: Node.js ≥ 22.4 (globales `WebSocket` für den Browser-Test). Die Befehle laufen unter Windows in
PowerShell. Blockiert PowerShell `npm.ps1` („Ausführung von Skripts deaktiviert“), `npm.cmd run serve` usw. benutzen
oder direkt `node scripts/serve.mjs`, `node tests/model.test.mjs`, `node tests/browser.test.mjs`.

```bash
npm run serve          # http://localhost:8000 (Port als Argument: node scripts/serve.mjs 8001)
npm test               # Logik-Tests, ~80 Prüfungen, ohne Browser
npm run test:browser   # E2E: startet eigenen Server + Headless Chrome/Edge, Screenshots in tests/.shots/
```

- Nach **jeder** Änderung an JS: `npm test` und `npm run test:browser` laufen lassen, bei UI-Änderungen die
  Screenshots in `tests/.shots/` ansehen (Desktop und `mobile-*.png`).
- Browser-Pfad: automatisch (Chrome/Edge unter `Program Files`), sonst Umgebungsvariable `CHROME`.
- Gegen die Live-Seite (nur solange sie im lokalen Modus läuft, siehe nächster Punkt):
  Bash `BASE=https://nicoftf.github.io/Win-Challenge/ npm run test:browser`, PowerShell
  `$env:BASE="https://nicoftf.github.io/Win-Challenge/"; npm run test:browser; Remove-Item Env:BASE`
  (ohne `Remove-Item` testen alle weiteren Läufe im selben Fenster die Live-Seite).
- Der Browser-Test **bricht ab, wenn Firebase eingetragen ist** (er würde sonst echte Daten anlegen) – und das ist
  jetzt der Fall. Zum Testen `js/config.js` lokal kurz auf `null` setzen und danach zurück, nicht committen
  (Bash: `cp js/config.js /tmp/c.js && git show <commit-mit-null>:js/config.js > js/config.js`, danach zurückkopieren;
  in PowerShell 5.1 keine `>`-Umleitung für Dateien, die schreibt UTF-16). Gegen die Live-Seite geht der Test nicht mehr.
- Firebase-SDK-Verhalten ohne echte Datenbank prüfen: im Claude-App-Browser eine Nicht-App-Seite des Dev-Servers öffnen
  (z. B. `/package.json`), dann per JavaScript `createStore({ firebaseConfig: { apiKey: 'x', projectId: 'offline-test',
  appId: '1:1:web:1', databaseURL: 'http://127.0.0.1:9/?ns=offline-test' } })` importieren. Der Store bleibt offline:
  lokale Events, Transaktionen und hängende Schreib-Promises lassen sich so beobachten, ohne echte Daten anzulegen.
- Regeln ohne Schreibzugriff prüfen (REST, nur lesen): `curl <databaseURL>/.json` → 401,
  `curl <databaseURL>/rooms/<gültiger Code>/meta.json` → `null` (200), ungültiger Code → 401.
- `scripts/serve.mjs` behandelt Groß-/Kleinschreibung wie GitHub Pages (falsch geschriebene Pfade = 404, auch unter
  Windows).
- Für die Vorschau im Claude-App-Browser: `.claude/launch.json` anlegen (ist in `.gitignore`), z. B.
  `{"version":"0.0.1","configurations":[{"name":"static","runtimeExecutable":"node","runtimeArgs":["scripts/serve.mjs","8791"],"port":8791}]}`.
- Syntax-Schnellcheck: `node --check js/pages/<datei>.js`.

## Stand und offene Punkte

Fertig und getestet (lokaler Modus, Headless-Chromium, Live-Seite auf GitHub Pages): alle vier Seiten, Voting,
Timer, Overlay mit Auto-Scroll und angepinntem aktivem Spiel, Overlay-Editor, Handy-Layout, README.

Firebase eingerichtet (14.09.2026, vom Nutzer selbst angelegt): Config in `js/config.js`, Realtime Database in
europe-west1, Regeln inkl. `hasChildren`-Validierungen veröffentlicht (Raum-Code-Regeln per REST bestätigt, Stand der
Datei vom Nutzer veröffentlicht am 14.09.2026). Design am selben Tag auf Schwarz/Rot (#c70039) umgestellt. Vor dem Umstieg wurde der Firebase-Pfad per Multi-Agent-Review geprüft und
gehärtet (Startabsturz `modeBanner`, Timer-Transaktionen, halbe Einträge, Offline-Verhalten, Lesefehler, doppelte
Vorschläge). Mit dem echten SDK offline geprüft (siehe oben); die Seite verbindet sich mit der echten Datenbank.
Claude darf in der Firebase-Konsole nichts selbst ändern (keine Anmeldung) – Regeln veröffentlicht der Nutzer.
GitHub Secret Scanning meldet den Firebase-`apiKey` in `js/config.js` als „Google API Key“ – erwartet, kein Leck
(README-FAQ). Nicht aus dem Repo entfernen oder rotieren; höchstens per HTTP-Referrer auf die Pages-Domain beschränken.

Offen:
1. **Regeländerungen** in `database.rules.json` muss der Nutzer jedes Mal in der Konsole neu veröffentlichen. Ob die
   Konsole den Stand der Datei hat, lässt sich nur indirekt prüfen (REST-Lesetest oben; Validierungen nur mit Schreiben).
2. **Online prüfen:** zwei Browser/Geräte gleichzeitig (Sync von Liste, Zeiten, Stimmen), Verbindungsabbruch,
   Overlay-URL in echtem **OBS** (Browserquelle, Größe, Transparenz, Scrollen). Mit echtem OBS noch nie getestet.
   Schreibtests gegen die echte Datenbank nur mit ausdrücklicher Zustimmung des Nutzers (Test-Raum danach löschen).
3. Bekannte Grenzen: Drag & Drop geht nicht auf Touch-Geräten (dort Menü „Nach oben/unten“); kein Login, der
   20-stellige Raum-Code im Einladungslink ist das Geheimnis; lokaler Modus speichert nur im jeweiligen Browser.
