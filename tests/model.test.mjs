// ============================================================
//  tests/model.test.mjs – Timer-, Voting- und Speicherlogik
// ============================================================
//  node tests/model.test.mjs     (keine Abhängigkeiten, kein Browser)
//  Testet js/model.js zusammen mit dem lokalen Store aus js/store.js.

// --- Minimale Browser-Shims für store.js (lokaler Modus) ---
const mem = {};
const shim = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
shim('localStorage', { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } });
shim('window', { addEventListener() {} });
shim('BroadcastChannel', class { postMessage() {} });

const { createStore } = await import(new URL('../js/store.js', import.meta.url));
const m = await import(new URL('../js/model.js', import.meta.url));

let fails = 0, passes = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { passes++; return; }
  fails++;
  console.log('FAIL', msg, '\n  bekommen:', JSON.stringify(a), '\n  erwartet:', JSON.stringify(b));
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// --- Zeitformat ---
eq(m.fmtTime(0), '00:00', 'fmt 0');
eq(m.fmtTime(65_000), '01:05', 'fmt 65s');
eq(m.fmtTime(3_600_000), '1:00:00', 'fmt 1h');
eq(m.fmtTime(0, { hours: 'always' }), '0:00:00', 'fmt immer mit Stunden');
eq(m.fmtTime(-5), '00:00', 'fmt negativ');

// --- Store + Aktionen mit steuerbarer Uhr ---
const store = await createStore({});
let fakeNow = 1_000_000;
store.now = () => fakeNow;
const KEY = m.generateRoomKey();
eq(m.isValidRoomKey(KEY), true, 'Raum-Code gültig');
let room = null;
store.subscribe(m.roomPath(KEY), (r) => { room = r; });
await store.set(m.roomPath(KEY, 'meta'), { name: 'Test', createdAt: fakeNow });
await tick();
const A = m.bindActions(store, KEY, () => room);

const p1 = await A.addPlayer('Nico'); await tick();
const p2 = await A.addPlayer('Tom'); await tick();
eq(m.sortedPlayers(room).map((p) => p.name), ['Nico', 'Tom'], 'Spieler');

const g1 = await A.addGame('Rocket League'); await tick();
const g2 = await A.addGame('Mario Kart'); await tick();
const g3 = await A.addGame('Tetris'); await tick();
eq(m.sortedGames(room).map((g) => g.title), ['Rocket League', 'Mario Kart', 'Tetris'], 'Reihenfolge');
await A.moveGame(g3, -1); await tick();
eq(m.sortedGames(room).map((g) => g.title), ['Rocket League', 'Tetris', 'Mario Kart'], 'moveGame hoch');
await A.reorderGames([g1, g2, g3]); await tick();
eq(m.sortedGames(room).map((g) => g.id), [g1, g2, g3], 'reorderGames');

// --- Timer ---
await A.startGame(g1); await tick();
let run = m.runOf(room);
eq(run.activeGame, g1, 'aktiv g1');
eq(m.timerRunning(run.total), true, 'Gesamtzeit startet mit');
fakeNow += 10_000;
eq(m.timerValue(run.games[g1], fakeNow), 10_000, 'g1 10s');
eq(m.timerValue(run.total, fakeNow), 10_000, 'gesamt 10s');
await A.startGame(g2); await tick();
run = m.runOf(room);
eq(m.timerRunning(run.games[g1]), false, 'g1 pausiert beim Start von g2');
eq(run.games[g1].elapsed, 10_000, 'g1 Zeit bleibt');
eq(run.activeGame, g2, 'aktiv g2');
fakeNow += 5_000;
await A.pauseGame(g2); await tick();
run = m.runOf(room);
eq(run.games[g2].elapsed, 5_000, 'g2 pausiert bei 5s');
eq(run.activeGame, g2, 'bleibt aktiv nach Pause');
eq(m.timerRunning(run.total), true, 'Gesamtzeit läuft nach Spiel-Pause weiter');
await A.pauseTotal(); await tick();
run = m.runOf(room);
eq(m.timerRunning(run.total), false, 'Gesamtzeit pausiert');
eq(run.total.elapsed, 15_000, 'Gesamtzeit 15s');
fakeNow += 100_000;
await A.startGame(g2); await tick();
eq(m.timerRunning(m.runOf(room).total), true, 'Gesamtzeit startet wieder mit Spiel');
fakeNow += 7_000;
await A.finishGame(g2); await tick();
run = m.runOf(room);
eq(run.games[g2].done, true, 'g2 gewonnen');
eq(run.games[g2].elapsed, 12_000, 'g2 insgesamt 12s');
eq(run.activeGame ?? null, null, 'aktives Spiel gelöscht');
eq(m.progressOf(room), { done: 1, total: 3, allDone: false }, 'Fortschritt 1/3');
await A.finishGame(g1); await tick();
await A.finishGame(g3); await tick();
run = m.runOf(room);
eq(run.total.finished, true, 'automatisch beendet');
eq(m.timerRunning(run.total), false, 'Gesamtzeit gestoppt');
eq(run.total.elapsed, 22_000, 'Gesamtzeit 22s');
await A.unfinishGame(g3); await tick();
eq(m.runOf(room).total.finished, false, 'Zurück hebt beendet auf');
await A.resetGameTime(g1); await tick();
eq(m.runOf(room).games[g1].elapsed, 0, 'Zeit zurücksetzen');
eq(m.runOf(room).games[g1].done, true, 'Zeit zurücksetzen behält Haken');
await A.startGame(g3); await tick();
await A.removeGame(g3); await tick();
run = m.runOf(room);
eq(run.activeGame ?? null, null, 'Entfernen löscht aktives Spiel');
eq(run.games[g3] ?? null, null, 'Entfernen löscht Spielzeit');
eq(Object.keys(room.runs || {}), [m.TEAM_RUN], 'Zeiten liegen gemeinsam unter runs/team');
// Zurücksetzen hinterlässt einen leeren gemeinsamen Stand (nicht „fehlt“), damit keine alte Basis zurückkommt
const emptyTeam = () => JSON.stringify(Object.keys(room.runs || {})) === JSON.stringify([m.TEAM_RUN])
  && !room.runs[m.TEAM_RUN].games && !room.runs[m.TEAM_RUN].total.elapsed && !m.timerRunning(room.runs[m.TEAM_RUN].total);
await A.resetRun(); await tick();
eq(emptyTeam(), true, 'resetRun: nur ein leerer gemeinsamer Stand');

// --- alte Zeiten je Spieler (vor runs/team) werden übernommen ---
await store.set(m.roomPath(KEY, 'runs'), null); await tick();   // Zustand wie vor der Umstellung
await A.pauseTotal(); await tick();
eq(room.runs ?? null, null, 'Pause ohne Stand legt nichts an');
eq(m.legacyRun({
  a: { total: { elapsed: 60_000, startedAt: null }, games: { x: { done: true } } },
  b: { total: { elapsed: 0, startedAt: Date.now() - 3_600_000 }, games: { y: { done: true } } },
}).total.elapsed, 0, 'bei gleich vielen Haken gewinnt die längere Gesamtzeit, laufender Anteil zählt mit');
const p3 = await A.addPlayer('Alt'); await tick();
await store.set(m.roomPath(KEY, `runs/${p3}`), { total: { elapsed: 5_000, startedAt: null, finished: false },
  games: { [g1]: { elapsed: 5_000, startedAt: null, done: true, doneAt: 1 }, [g2]: { elapsed: 1_000, startedAt: null, done: true, doneAt: 1 } } });
await store.set(m.roomPath(KEY, `runs/${p2}`), { total: { elapsed: 90_000, startedAt: null, finished: false } });
await tick();
eq(m.progressOf(room).done, 2, 'ohne runs/team: Stand mit den meisten Haken wird angezeigt');
await A.removePlayer(p3); await tick();
eq([m.progressOf(room).done, !!room.runs[p3]], [2, true], 'Spieler entfernen vor der Übernahme lässt den angezeigten Stand stehen');
await A.startTotal(); await tick();
eq([room.runs[m.TEAM_RUN].games[g1].done, room.runs[m.TEAM_RUN].total.elapsed, m.timerRunning(room.runs[m.TEAM_RUN].total)], [true, 5_000, true], 'erste Aktion übernimmt ihn nach runs/team');
eq(m.runOf(room), room.runs[m.TEAM_RUN], 'danach zählt nur runs/team');
await A.removeGame(g2); await tick();
eq([m.sortedGames(room).map((g) => g.id), !!room.runs[m.TEAM_RUN].games[g2], !!room.runs[p3].games[g2]], [[g1], false, true], 'Spiel entfernt aus runs/team, alte Einzelstände bleiben unverändert');
await A.resetRun(); await tick();
eq(emptyTeam(), true, 'Zurücksetzen löscht auch alte Einzelstände');

// --- Voting ---
await A.setVotingSettings({ mustBudget: 1, vetoBudget: 1, targetCount: 2 }); await tick();
const s1 = await A.addSuggestion('Alpha', p1); await tick();
const s2 = await A.addSuggestion('Beta', p1); await tick();
const s3 = await A.addSuggestion('Gamma', p2); await tick();
const s4 = await A.addSuggestion('Delta', p2); await tick();
eq(await A.addSuggestion('alpha', p2), s1, 'Duplikat wird zusammengelegt');
await A.vote(p1, s1, 'must'); await tick();
let err = null; try { await A.vote(p1, s2, 'must'); } catch (e) { err = e.message; }
eq(!!err, true, 'Muss-rein-Budget greift');
await A.vote(p1, s2, 'yes'); await tick();
await A.vote(p1, s3, 'no'); await tick();
await A.vote(p2, s1, 'yes'); await tick();
await A.vote(p2, s3, 'must'); await tick();
await A.vote(p2, s4, 'veto'); await tick();
await A.vote(p2, s2, 'meh'); await tick();
eq(m.voteUsage(room, p1), { must: 1, veto: 0, rated: 3 }, 'Budget-Nutzung p1');
eq(m.votingResults(room).map((r) => [r.title, r.score, r.rank, r.inList, r.eliminated]),
  [['Alpha', 4, 1, true, false], ['Gamma', 2, 2, true, false], ['Beta', 1, 3, false, false], ['Delta', 0, null, false, true]],
  'Auswertung');
await A.vote(p1, s1, null); await tick();
eq(m.voteUsage(room, p1).must, 0, 'Stimme entfernt');
await A.vote(p1, s1, 'must'); await tick();
await A.setVotingSettings({ targetCount: 0 }); await tick();
eq(m.votingResults(room).filter((r) => r.inList).length, 3, 'Zielanzahl 0 = alle ohne Veto');
await A.setVotingSettings({ targetCount: 2, closed: true }); await tick();
err = null; try { await A.vote(p1, s2, 'yes'); } catch (e) { err = e.message; }
eq(!!err, true, 'geschlossenes Voting sperrt');
await A.setVotingSettings({ closed: false }); await tick();
eq(await A.applyVotingResult(), 2, 'Ergebnis übernommen');
await tick();
eq(m.sortedGames(room).map((g) => g.title), ['Alpha', 'Gamma'], 'Spieleliste ersetzt');
eq(emptyTeam(), true, 'Zeiten zurückgesetzt');
eq(await A.importGamesAsSuggestions(p1), 0, 'Import ohne Duplikate');
await A.removeSuggestion(s1); await tick();
eq(room.voting.votes[p1][s1] ?? null, null, 'Stimmen mit Vorschlag entfernt');

// --- Mehrere Geräte / veraltete Stände ---
eq(store.pendingSince(), null, 'lokal nichts unbestätigt');
eq(await store.transaction(m.roomPath(KEY, 'runs/niemand'), () => undefined), false, 'Transaktion abbrechen');
const [ga, gb] = m.sortedGames(room).map((g) => g.id);
await A.startGame(ga); await tick();
const startedA = m.runOf(room).games[ga].startedAt;
fakeNow += 3_000;
await A.startGame(ga); await tick();
eq(m.runOf(room).games[ga].startedAt, startedA, 'Start auf laufendem Spiel behält Startzeit');
const doneAt = fakeNow;
await A.finishGame(gb); await tick();
fakeNow += 1_000;
await A.finishGame(gb); await tick();
eq(m.runOf(room).games[gb].doneAt, doneAt, 'zweites „Gewonnen“ ändert nichts');
await A.startGame(gb); await tick();
eq([m.runOf(room).games[gb].done, m.runOf(room).activeGame], [true, ga], 'Start auf gewonnenem Spiel ändert nichts');
await A.finishChallenge(); await tick();
await A.startTotal(); await tick();
eq([m.runOf(room).total.finished, m.timerRunning(m.runOf(room).total)], [true, false], '„Weiter“ startet beendete Challenge nicht');
await A.removeGame(gb); await tick();
await A.renameGame(gb, 'Geist'); await A.reorderGames([gb, ga]); await A.startGame(gb); await tick();
eq(room.games[gb] ?? null, null, 'veraltetes Umbenennen/Sortieren legt gelöschtes Spiel nicht neu an');
eq(m.runOf(room).games[gb] ?? null, null, 'Start eines gelöschten Spiels legt keine Zeit an');
eq(m.sortedGames({ games: { x: { order: 0 }, y: { title: 'Y', order: 1, createdAt: 1 } } }).map((g) => g.id), ['y'], 'Einträge ohne Titel ignoriert');
eq(m.suggestionKey(' Mario.Kart [8] / DX '), 't_mario_kart _8_ _ dx', 'Vorschlags-Schlüssel ohne verbotene Zeichen');
const sx = await A.addSuggestion('Zelda', p1); await tick();
eq(sx, 't_zelda', 'Vorschlag bekommt Schlüssel aus dem Titel');
await A.renameSuggestion(sx, 'Zelda BotW'); await tick();
const sy = await A.addSuggestion('zelda', p2); await tick();
eq(sy !== sx && room.voting.suggestions[sx].title === 'Zelda BotW', true, 'umbenannter Vorschlag wird nicht überschrieben');
await A.removeSuggestion(sy); await tick();
await A.renameSuggestion(sy, 'Geist'); await tick();
eq(room.voting.suggestions[sy] ?? null, null, 'veraltetes Umbenennen legt gelöschten Vorschlag nicht neu an');
const sc = await A.addSuggestion('Celeste', p1); await tick();
await A.removeSuggestion(sc); await tick();
await store.set(m.roomPath(KEY, `voting/votes/${p2}/${sc}`), 'veto'); await tick();   // verspätete Stimme eines Offline-Geräts
eq(await A.addSuggestion('Celeste', p1), sc, 'gleicher Titel → gleicher Schlüssel'); await tick();
eq(room.voting.votes?.[p2]?.[sc] ?? null, null, 'alte Stimme lebt beim neuen Vorschlag nicht wieder auf');
await store.set(m.roomPath(KEY, `voting/suggestions/${store.newKey()}`), { title: 'zelda botw', by: p2, createdAt: fakeNow }); await tick();
await A.setVotingSettings({ targetCount: 0 }); await tick();
eq(m.votingResults(room).filter((r) => r.duplicate).map((r) => [r.title, r.rank, r.inList]), [['zelda botw', null, false]], 'doppelter Titel markiert, ohne Rang');
await A.applyVotingResult(); await tick();
eq(m.sortedGames(room).filter((g) => g.title.toLowerCase() === 'zelda botw').length, 1, 'doppelte Titel nur einmal in der Liste');
await A.addGame('Neu'); await A.addGame('neu'); await tick();
eq(await A.importGamesAsSuggestions(p1), 1, 'gleiche Titel in der Spieleliste nur einmal als Vorschlag');
await A.addGame('Worms W.M.D'); await A.addGame('Worms W_M_D'); await tick();
eq(await A.importGamesAsSuggestions(p1), 2, 'Titel mit gleichem Schlüssel: beide importiert'); await tick();
eq(m.sortedSuggestions(room).filter((s) => s.title.startsWith('Worms')).length, 2, 'beide Worms-Vorschläge vorhanden');

// --- Overlay ---
await A.setOverlay(p1, { width: 400, bogus: 1, showTitle: false }); await tick();
eq(m.overlaySettings(room, p1).width, 400, 'Overlay-Breite');
eq(m.overlaySettings(room, p1).showTitle, false, 'Overlay-Boolean');
eq('bogus' in m.overlaySettings(room, p1), false, 'unbekannte Schlüssel ignoriert');
await A.copyOverlay(p1, p2); await tick();
eq(m.overlaySettings(room, p2).width, 400, 'Overlay kopiert');
await A.resetOverlay(p1); await tick();
eq(m.overlaySettings(room, p1).width, m.OVERLAY_DEFAULTS.width, 'Overlay zurückgesetzt');
// Vorlagen: „Balken“ = Standard, „Klassisch“ setzt dieselben Schlüssel, nur existierende
eq(Object.entries(m.OVERLAY_PRESETS.bar).filter(([k, v]) => m.OVERLAY_DEFAULTS[k] !== v), [], 'Vorlage Balken entspricht dem Standard');
eq(Object.keys(m.OVERLAY_PRESETS.classic).sort(), Object.keys(m.OVERLAY_PRESETS.bar).sort(), 'Vorlagen haben dieselben Schlüssel');
eq(Object.keys(m.OVERLAY_PRESETS.classic).filter((k) => !(k in m.OVERLAY_DEFAULTS) || typeof m.OVERLAY_PRESETS.classic[k] !== typeof m.OVERLAY_DEFAULTS[k]), [], 'Vorlagen-Schlüssel existieren mit gleichem Typ');
eq(['title', 'fontFamily', 'textColor', 'barColor', 'fontSize'].filter((k) => k in m.OVERLAY_PRESETS.bar), [], 'Vorlagen setzen weder Titel, Schrift noch Farben');

// --- Raum / Spieler ---
await A.renameRoom('x'.repeat(200)); await tick();
eq(room.meta.name.length, m.ROOM_NAME_MAX, 'Name auf Maximallänge gekürzt');
await A.removePlayer(p2); await tick();
eq(m.sortedPlayers(room).length, 1, 'Spieler entfernt');
eq(room.voting.votes[p2] ?? null, null, 'Stimmen mit Spieler entfernt');
eq(JSON.stringify(JSON.parse(mem['wc.localdb'])).includes('{}'), false, 'keine leeren Objekte gespeichert');

console.log(fails ? `\n${fails} FEHLER, ${passes} ok` : `\nAlle ${passes} Prüfungen bestanden`);
process.exit(fails ? 1 : 0);
