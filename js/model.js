// ============================================================
//  model.js – Datenmodell, Timer-Logik, Voting-Auswertung
// ============================================================
//
//  Alles liegt unter  rooms/{ROOM}/ :
//
//  meta:      { name, createdAt }
//  players:   { [pid]: { name, color, createdAt } }
//  games:     { [gid]: { title, order, createdAt } }            gemeinsame Spieleliste
//  runs:      { [pid]: {                                         Fortschritt pro Spieler
//                total: { elapsed, startedAt|null, finished },
//                activeGame: gid|null,
//                games: { [gid]: { elapsed, startedAt|null, done, doneAt|null } } } }
//  overlay:   { [pid]: { ...OVERLAY_DEFAULTS } }                 Overlay-Einstellungen pro Spieler
//  voting:    { settings: { mustBudget, vetoBudget, targetCount, closed },
//               suggestions: { [sid]: { title, by, createdAt } },       sid = suggestionKey(title) oder Push-Key
//               votes: { [pid]: { [sid]: 'must'|'yes'|'meh'|'no'|'veto' } } }
//
//  Timer: elapsed = bisher gesammelte ms, startedAt = Serverzeit des Starts (null = pausiert).
//  Angezeigte Zeit = elapsed + (startedAt ? now - startedAt : 0)
//
//  Mehrere Geräte: Timer-Aktionen laufen als Transaktion auf runs/{pid}. Einzelne Felder (Name, Titel,
//  Reihenfolge) werden nur geschrieben, wenn der Eintrag noch existiert; database.rules.json weist zusätzlich
//  Teil-Einträge ohne Pflichtfelder ab (z.B. verspätete Schreibvorgänge eines Geräts, das offline war).

// Kein Rot (= Akzent/Veto); Gelb und Grün (= gewonnen) erst ab Spieler 5, Rosa (nah am Akzent) zuletzt
export const PLAYER_COLORS = ['#5b9cf6', '#3fc1c9', '#b07cf0', '#f28c4e', '#56c271', '#f2c14e', '#a3a3a8', '#e879a8'];

/** maximale Länge des Challenge-Namens (siehe database.rules.json) */
export const ROOM_NAME_MAX = 80;

export const VOTE_VALUES = ['must', 'yes', 'meh', 'no', 'veto'];
export const VOTE_INFO = {
  must: { label: 'Muss rein',    short: '!!', points: 3,  hint: 'Will ich unbedingt spielen (begrenzt)' },
  yes:  { label: 'Gerne',        short: '+',  points: 1,  hint: 'Fände ich gut' },
  meh:  { label: 'Egal',         short: '·',  points: 0,  hint: 'Kann, muss aber nicht' },
  no:   { label: 'Lieber nicht', short: '−',  points: -1, hint: 'Hätte ich lieber nicht drin' },
  veto: { label: 'Veto',         short: 'X',  points: 0,  hint: 'Auf keinen Fall – Spiel fliegt raus (begrenzt)' },
};

export const VOTING_DEFAULTS = { mustBudget: 5, vetoBudget: 2, targetCount: 15, closed: false };

export const OVERLAY_FONTS = [
  'IBM Plex Sans', 'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Rubik', 'Nunito',
  'Space Grotesk', 'Oswald', 'Bebas Neue', 'Anton', 'Teko', 'Press Start 2P', 'Pixelify Sans',
  'IBM Plex Mono', 'JetBrains Mono', 'Roboto Mono',
];

export const OVERLAY_DEFAULTS = {
  // Inhalt
  title: '',              // leer → Name der Challenge
  showTitle: true,
  showTotal: true,
  showProgress: true,     // "3 / 22"
  showNumbers: true,      // Nummerierung der Spiele
  showGameTimes: true,
  showDone: true,         // erledigte Spiele anzeigen
  doneStyle: 'strike',    // 'strike' | 'check' | 'dim'
  pinActive: true,        // aktives Spiel oben anpinnen
  activeLabel: 'Läuft',   // kleines Label am aktiven Spiel ('' = keins)
  // Größe & Form
  width: 320,
  maxHeight: 560,
  padding: 14,
  gap: 6,
  radius: 10,
  borderWidth: 1,
  shadow: true,
  // Farben
  bgColor: '#0a0a0a',
  bgOpacity: 0.92,           // rote Schrift bleibt auch über hellen Spielszenen lesbar
  borderColor: '#2a2a2e',
  textColor: '#ffffff',
  mutedColor: '#a3a3a8',
  accentColor: '#f54778',    // hellere Variante von #c70039, damit Zeiten/Label auf dem Stream lesbar bleiben
  doneColor: '#56c271',
  // Schrift
  fontFamily: 'IBM Plex Sans',
  fontSize: 16,
  titleSize: 18,
  timerFont: 'IBM Plex Mono', // Schrift für Zeiten; '' = wie Text
  // Verhalten
  scrollSpeed: 18,        // px pro Sekunde, 0 = kein Auto-Scroll
  scrollPause: 2.5,       // Sekunden Pause am Anfang jeder Runde
};

// ------------------------------------------------------------
//  Zeitformatierung
// ------------------------------------------------------------

/** ms → "mm:ss" bzw. "h:mm:ss" (ab 1h). hours:'always' erzwingt "h:mm:ss". */
export function fmtTime(ms, { hours = 'auto' } = {}) {
  ms = Math.max(0, Math.floor(ms || 0));
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (h > 0 || hours === 'always') return `${h}:${p(m)}:${p(sec)}`;
  return `${p(m)}:${p(sec)}`;
}

/** aktuelle Zeit eines Timers { elapsed, startedAt } */
export function timerValue(t, now) {
  if (!t) return 0;
  const base = t.elapsed || 0;
  return t.startedAt ? base + Math.max(0, now - t.startedAt) : base;
}
export function timerRunning(t) {
  return !!(t && t.startedAt);
}

// ------------------------------------------------------------
//  Lesen / Ableiten
// ------------------------------------------------------------

export function entries(obj) {
  return Object.entries(obj || {});
}

/** Spiele als sortiertes Array [{id, title, order, createdAt}]. Einträge ohne Titel werden ignoriert. */
export function sortedGames(room) {
  return entries(room?.games)
    .filter(([, g]) => typeof g?.title === 'string')
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/** Spieler als sortiertes Array [{id, name, color}]. Einträge ohne Namen werden ignoriert. */
export function sortedPlayers(room) {
  return entries(room?.players)
    .filter(([, p]) => typeof p?.name === 'string')
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function runOf(room, pid) {
  return room?.runs?.[pid] || { total: { elapsed: 0, startedAt: null, finished: false }, activeGame: null, games: {} };
}

/** Fortschritt eines Spielers: { done, total, allDone } */
export function progressOf(room, pid) {
  const games = sortedGames(room);
  const run = runOf(room, pid);
  const done = games.filter((g) => run.games?.[g.id]?.done).length;
  return { done, total: games.length, allDone: games.length > 0 && done === games.length };
}

export function overlaySettings(room, pid) {
  return { ...OVERLAY_DEFAULTS, ...(room?.overlay?.[pid] || {}) };
}

export function votingSettings(room) {
  return { ...VOTING_DEFAULTS, ...(room?.voting?.settings || {}) };
}

export function sortedSuggestions(room) {
  return entries(room?.voting?.suggestions)
    .filter(([, s]) => typeof s?.title === 'string')
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * Schlüssel eines Vorschlags aus dem Titel. Schlagen zwei Geräte gleichzeitig denselben Titel vor
 * (oder eins davon offline), landen beide im selben Eintrag statt in zwei Kopien mit geteilten Stimmen.
 * Verbotene Firebase-Zeichen (. # $ [ ] / Steuerzeichen) werden ersetzt; höchstens 480 Byte.
 */
export function suggestionKey(title) {
  return 't_' + Array.from(String(title).trim().toLowerCase().replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_')).slice(0, 120).join('');
}

/** Wie viele 'must' / 'veto' hat ein Spieler vergeben */
export function voteUsage(room, pid) {
  const votes = room?.voting?.votes?.[pid] || {};
  const suggestions = room?.voting?.suggestions || {};
  let must = 0, veto = 0, rated = 0;
  for (const [sid, v] of Object.entries(votes)) {
    if (!suggestions[sid]) continue; // Stimmen für gelöschte Vorschläge ignorieren
    rated++;
    if (v === 'must') must++;
    if (v === 'veto') veto++;
  }
  return { must, veto, rated };
}

/**
 * Voting-Auswertung.
 * Ergebnis: Array (sortiert, beste zuerst) von
 *   { id, title, by, score, counts: {must,yes,meh,no,veto}, votes: {pid: value},
 *     eliminated: bool, rank, inList: bool }
 * Regeln:
 *   - Punkte: must +3, yes +1, meh 0, no −1
 *   - veto: Spiel ist raus (eliminated), egal wie viele Punkte
 *   - Reihenfolge: Punkte ↓, must ↓, yes ↓, no ↑, älterer Vorschlag zuerst
 *   - inList: die oberen targetCount nicht-eliminierten (targetCount 0 = alle)
 *   - duplicate: gleicher Titel steht schon weiter oben (kein Rang, nicht in der Liste)
 */
export function votingResults(room) {
  const settings = votingSettings(room);
  const players = sortedPlayers(room);
  const allVotes = room?.voting?.votes || {};
  const rows = sortedSuggestions(room).map((s) => {
    const counts = { must: 0, yes: 0, meh: 0, no: 0, veto: 0 };
    const votes = {};
    let score = 0;
    for (const p of players) {
      const v = allVotes[p.id]?.[s.id];
      if (!v || !VOTE_INFO[v]) continue;
      votes[p.id] = v;
      counts[v]++;
      score += VOTE_INFO[v].points;
    }
    return { ...s, score, counts, votes, eliminated: counts.veto > 0 };
  });
  rows.sort((a, b) =>
    (a.eliminated - b.eliminated) ||
    (b.score - a.score) ||
    (b.counts.must - a.counts.must) ||
    (b.counts.yes - a.counts.yes) ||
    (a.counts.no - b.counts.no) ||
    ((a.createdAt ?? 0) - (b.createdAt ?? 0))
  );
  const target = settings.targetCount > 0 ? settings.targetCount : Infinity; // 0 = alle nicht-vetoten
  let rank = 0;
  const seen = new Set();   // gleicher Titel mehrfach (z.B. gleichzeitig vorgeschlagen) → nur der beste zählt
  for (const r of rows) {
    if (r.eliminated) { r.rank = null; r.inList = false; continue; }
    const key = r.title.trim().toLowerCase();
    if (seen.has(key)) { r.rank = null; r.inList = false; r.duplicate = true; continue; }
    seen.add(key);
    rank++;
    r.rank = rank;
    r.inList = rank <= target;
  }
  return rows;
}

// ------------------------------------------------------------
//  Aktionen (schreiben) – bindActions(store, roomKey, getRoom)
// ------------------------------------------------------------

export function roomPath(roomKey, sub = '') {
  return sub ? `rooms/${roomKey}/${sub}` : `rooms/${roomKey}`;
}

const ROOM_KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRoomKey(len = 20) {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => ROOM_KEY_CHARS[n % ROOM_KEY_CHARS.length]).join('');
}
export function isValidRoomKey(key) {
  return typeof key === 'string' && /^[A-Z0-9]{16,32}$/.test(key);
}

export function bindActions(store, roomKey, getRoom) {
  const P = (sub) => roomPath(roomKey, sub);
  const now = () => store.now();
  const room = () => getRoom() || {};

  /** Timer zum Zeitpunkt at stoppen → neuer Timer-Zustand */
  const stopped = (timer, at) => ({ ...(timer || {}), elapsed: timerValue(timer, at), startedAt: null });

  /**
   * runs/{pid} in einer Transaktion ändern. fn(run) ändert run direkt (total, activeGame, games sind immer da)
   * und gibt false zurück, wenn nichts zu tun ist. Firebase ruft fn erneut mit dem Serverstand auf, wenn ein
   * anderes Gerät dazwischen geschrieben hat – so überschreibt ein veralteter Stand keine neueren Zeiten.
   * create: auch ausführen, wenn es für den Spieler noch keinen Run gibt.
   */
  /**
   * Ein Titel-Schlüssel kann schon einmal vergeben gewesen sein. Stimmen, die noch darauf liegen (z.B. verspätet von
   * einem Gerät, das offline war), sollen beim neuen Vorschlag nicht wieder aufleben. Nur löschen, was hier sichtbar ist.
   */
  const clearStaleVotes = (r, sid, map) => {
    for (const [p, votes] of entries(r.voting?.votes)) {
      if (votes?.[sid] != null) map[P(`voting/votes/${p}/${sid}`)] = null;
    }
  };

  const changeRun = (pid, fn, { create = false } = {}) => store.transaction(P(`runs/${pid}`), (cur) => {
    if (!cur && !create) return undefined;
    const run = cur ? structuredClone(cur) : {};
    run.total = { elapsed: 0, startedAt: null, finished: false, ...run.total };
    run.activeGame = run.activeGame ?? null;
    run.games = run.games || {};
    if (fn(run) === false) return undefined;
    if (!Object.keys(run.games).length) delete run.games;   // leere Objekte gibt es in Firebase nicht
    return run;
  });

  const actions = {
    // ---------- Raum ----------
    async renameRoom(name) {
      await store.set(P('meta/name'), String(name || '').trim().slice(0, ROOM_NAME_MAX) || 'Win-Challenge');
    },

    // ---------- Spieler ----------
    /** id optional vorgeben, z.B. um den Spieler schon vor der Server-Bestätigung auszuwählen */
    async addPlayer(name, id = store.newKey()) {
      const existing = sortedPlayers(room());
      const color = PLAYER_COLORS[existing.length % PLAYER_COLORS.length];
      await store.set(P(`players/${id}`), { name: String(name).trim(), color, createdAt: now() });
      return id;
    },
    async renamePlayer(pid, name) {
      if (!room().players?.[pid]) return;   // inzwischen entfernt → nicht als halben Eintrag neu anlegen
      await store.set(P(`players/${pid}/name`), String(name).trim());
    },
    async setPlayerColor(pid, color) {
      if (!room().players?.[pid]) return;
      await store.set(P(`players/${pid}/color`), color);
    },
    async removePlayer(pid) {
      await store.update({
        [P(`players/${pid}`)]: null,
        [P(`runs/${pid}`)]: null,
        [P(`overlay/${pid}`)]: null,
        [P(`voting/votes/${pid}`)]: null,
      });
    },

    // ---------- Spiele ----------
    async addGame(title) {
      title = String(title || '').trim();
      if (!title) return null;
      const games = sortedGames(room());
      const order = games.length ? (games[games.length - 1].order ?? 0) + 1 : 0;
      const id = store.newKey();
      await store.set(P(`games/${id}`), { title, order, createdAt: now() });
      return id;
    },
    async renameGame(gid, title) {
      title = String(title || '').trim();
      if (!title || !room().games?.[gid]) return;
      await store.set(P(`games/${gid}/title`), title);
    },
    async removeGame(gid) {
      // Zeiten je Spieler per Transaktion aufräumen: ein normales update unter runs/{pid} würde noch
      // unbestätigte Timer-Transaktionen dieses Geräts abbrechen (z.B. offline geklickt). Alle starten, dann warten.
      const jobs = [store.set(P(`games/${gid}`), null)];
      for (const pid of Object.keys(room().runs || {})) {
        jobs.push(changeRun(pid, (run) => {
          if (!run.games[gid] && run.activeGame !== gid) return false;
          delete run.games[gid];
          if (run.activeGame === gid) run.activeGame = null;
        }));
      }
      await Promise.all(jobs);
    },
    /** neue Reihenfolge als Array von Spiel-IDs */
    async reorderGames(orderedIds) {
      const games = room().games || {};
      const map = {};
      orderedIds.filter((gid) => games[gid]).forEach((gid, i) => { map[P(`games/${gid}/order`)] = i; });
      if (!Object.keys(map).length) return;
      await store.update(map);
    },
    async moveGame(gid, delta) {
      const ids = sortedGames(room()).map((g) => g.id);
      const i = ids.indexOf(gid);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      ids.splice(i, 1);
      ids.splice(j, 0, gid);
      await actions.reorderGames(ids);
    },
    /** ganze Liste ersetzen (z.B. aus dem Voting). Setzt alle Runs zurück. */
    async replaceGames(titles) {
      const t = now();
      const games = {};
      titles.forEach((title, i) => { games[store.newKey()] = { title: String(title).trim(), order: i, createdAt: t + i }; });
      await store.update({ [P('games')]: games, [P('runs')]: null });
    },

    // ---------- Timer ----------
    // Zeitpunkt t = Klick. Wiederholt Firebase die Transaktion später (z.B. nach Offline-Phase), zählt trotzdem der Klick.
    async startGame(pid, gid) {
      const t = now();
      await changeRun(pid, (run) => {
        // Spiel inzwischen entfernt / Liste ersetzt, oder auf einem anderen Gerät schon gewonnen
        if (!room().games?.[gid] || run.games[gid]?.done) return false;
        // anderes laufendes Spiel pausieren
        for (const [otherId, tg] of Object.entries(run.games)) {
          if (otherId !== gid && timerRunning(tg)) run.games[otherId] = stopped(tg, t);
        }
        const g = run.games[gid] || {};
        // läuft es schon (z.B. auf einem anderen Gerät gestartet), bleibt der alte Startzeitpunkt
        run.games[gid] = { elapsed: g.elapsed || 0, startedAt: g.startedAt || t, done: false, doneAt: null };
        run.activeGame = gid;
        // Gesamtzeit automatisch mitstarten
        if (!timerRunning(run.total)) run.total = { elapsed: run.total.elapsed || 0, startedAt: t, finished: false };
      }, { create: true });
    },
    async pauseGame(pid, gid) {
      const t = now();
      await changeRun(pid, (run) => {
        if (!timerRunning(run.games[gid])) return false;
        run.games[gid] = stopped(run.games[gid], t);
      });
    },
    async finishGame(pid, gid) {
      const t = now();
      await changeRun(pid, (run) => {
        const games = sortedGames(room());
        if (!games.some((x) => x.id === gid)) return false;
        const g = run.games[gid] || {};
        if (g.done) return false;
        run.games[gid] = { ...stopped(g, t), done: true, doneAt: t };
        if (run.activeGame === gid) run.activeGame = null;
        // alle fertig? → Gesamtzeit stoppen
        if (games.every((x) => run.games[x.id]?.done)) run.total = { ...stopped(run.total, t), finished: true };
      }, { create: true });
    },
    async unfinishGame(pid, gid) {
      await changeRun(pid, (run) => {
        const g = run.games[gid];
        if (!g?.done) return false;
        run.games[gid] = { ...g, elapsed: g.elapsed || 0, startedAt: null, done: false, doneAt: null };
        run.total.finished = false;
      });
    },
    async resetGameTime(pid, gid) {
      const t = now();
      await changeRun(pid, (run) => {
        const g = run.games[gid];
        if (!g) return false;
        run.games[gid] = { elapsed: 0, startedAt: timerRunning(g) ? t : null, done: !!g.done, doneAt: g.doneAt || null };
      });
    },
    async startTotal(pid) {
      const t = now();
      await changeRun(pid, (run) => {
        if (timerRunning(run.total) || run.total.finished) return false;   // beendet → nur über resumeChallenge
        run.total = { elapsed: run.total.elapsed || 0, startedAt: t, finished: false };
      }, { create: true });
    },
    /** Pause: stoppt Gesamtzeit UND laufendes Spiel */
    async pauseTotal(pid) {
      const t = now();
      await changeRun(pid, (run) => {
        run.total = { ...stopped(run.total, t), finished: !!run.total.finished };
        for (const [gid, tg] of Object.entries(run.games)) {
          if (timerRunning(tg)) run.games[gid] = stopped(tg, t);
        }
      });
    },
    /** Challenge beenden: alles stoppen, finished = true */
    async finishChallenge(pid) {
      const t = now();
      await changeRun(pid, (run) => {
        run.total = { ...stopped(run.total, t), finished: true };
        run.activeGame = null;
        for (const [gid, tg] of Object.entries(run.games)) {
          if (timerRunning(tg)) run.games[gid] = stopped(tg, t);
        }
      }, { create: true });
    },
    async resumeChallenge(pid) {
      const t = now();
      await changeRun(pid, (run) => {
        if (timerRunning(run.total)) return false;
        run.total = { elapsed: run.total.elapsed || 0, startedAt: t, finished: false };
      }, { create: true });
    },
    /** kompletter Neustart für einen Spieler (alle Zeiten weg) */
    async resetRun(pid) {
      await store.remove(P(`runs/${pid}`));
    },

    // ---------- Overlay ----------
    async setOverlay(pid, patch) {
      const map = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in OVERLAY_DEFAULTS)) continue;
        map[P(`overlay/${pid}/${k}`)] = v;
      }
      await store.update(map);
    },
    async resetOverlay(pid) {
      await store.remove(P(`overlay/${pid}`));
    },
    /** Einstellungen eines anderen Spielers kopieren */
    async copyOverlay(fromPid, toPid) {
      const src = room().overlay?.[fromPid] || null;
      await store.set(P(`overlay/${toPid}`), src);
    },

    // ---------- Voting ----------
    async addSuggestion(title, pid) {
      title = String(title || '').trim();
      if (!title) return null;
      const r = room();
      const dup = sortedSuggestions(r).find((s) => s.title.toLowerCase() === title.toLowerCase());
      if (dup) return dup.id;
      // Schlüssel aus dem Titel; ist er schon vergeben (Vorschlag wurde umbenannt), ein neuer Push-Key
      let id = suggestionKey(title);
      if (r.voting?.suggestions?.[id]) id = store.newKey();
      const map = { [P(`voting/suggestions/${id}`)]: { title, by: pid || null, createdAt: now() } };
      clearStaleVotes(r, id, map);
      await store.update(map);
      return id;
    },
    async renameSuggestion(sid, title) {
      title = String(title || '').trim();
      if (!title || !room().voting?.suggestions?.[sid]) return;
      await store.set(P(`voting/suggestions/${sid}/title`), title);
    },
    async removeSuggestion(sid) {
      const map = { [P(`voting/suggestions/${sid}`)]: null };
      for (const pid of Object.keys(room().voting?.votes || {})) map[P(`voting/votes/${pid}/${sid}`)] = null;
      await store.update(map);
    },
    /** value: 'must'|'yes'|'meh'|'no'|'veto'|null (null = Stimme entfernen). Prüft Budgets. */
    async vote(pid, sid, value) {
      if (value !== null && !VOTE_INFO[value]) throw new Error('Ungültige Stimme');
      const r = room();
      const settings = votingSettings(r);
      if (settings.closed) throw new Error('Das Voting ist geschlossen');
      const usage = voteUsage(r, pid);
      const current = r.voting?.votes?.[pid]?.[sid] || null;
      if (value === 'must' && current !== 'must' && settings.mustBudget > 0 && usage.must >= settings.mustBudget) {
        throw new Error(`Du hast schon ${settings.mustBudget}× „Muss rein“ vergeben`);
      }
      if (value === 'veto' && current !== 'veto' && settings.vetoBudget > 0 && usage.veto >= settings.vetoBudget) {
        throw new Error(`Du hast schon ${settings.vetoBudget}× Veto vergeben`);
      }
      await store.set(P(`voting/votes/${pid}/${sid}`), value);
    },
    async setVotingSettings(patch) {
      const map = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in VOTING_DEFAULTS)) continue;
        map[P(`voting/settings/${k}`)] = v;
      }
      await store.update(map);
    },
    /** Ergebnis übernehmen: die Spiele mit inList=true werden die neue Spieleliste. */
    async applyVotingResult() {
      const rows = votingResults(room()).filter((x) => x.inList);   // doppelte Titel sind dort schon aussortiert
      await actions.replaceGames(rows.map((x) => x.title));
      return rows.length;
    },
    /** vorhandene Spiele der Liste als Vorschläge ins Voting übernehmen */
    async importGamesAsSuggestions(pid) {
      const r = room();
      const suggestions = r.voting?.suggestions || {};
      const existing = new Set(sortedSuggestions(r).map((s) => s.title.toLowerCase()));
      const t = now();
      const map = {};
      let n = 0;
      for (const g of sortedGames(r)) {
        const title = g.title.trim();
        if (!title || existing.has(title.toLowerCase())) continue;
        existing.add(title.toLowerCase());
        let id = suggestionKey(title);
        if (suggestions[id] || map[P(`voting/suggestions/${id}`)]) id = store.newKey();
        map[P(`voting/suggestions/${id}`)] = { title, by: pid || null, createdAt: t + n };
        clearStaleVotes(r, id, map);
        n++;
      }
      if (n) await store.update(map);
      return n;
    },
  };
  return actions;
}
