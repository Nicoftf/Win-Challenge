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
//               suggestions: { [sid]: { title, by, createdAt } },
//               votes: { [pid]: { [sid]: 'must'|'yes'|'meh'|'no'|'veto' } } }
//
//  Timer: elapsed = bisher gesammelte ms, startedAt = Serverzeit des Starts (null = pausiert).
//  Angezeigte Zeit = elapsed + (startedAt ? now - startedAt : 0)

export const PLAYER_COLORS = ['#f2c14e', '#5b9cf6', '#56c271', '#e5534b', '#b07cf0', '#f28c4e', '#3fc1c9', '#e879a8'];

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
  bgColor: '#101114',
  bgOpacity: 0.85,
  borderColor: '#2a2d34',
  textColor: '#ffffff',
  mutedColor: '#9a9ea8',
  accentColor: '#f2c14e',
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

/** Spiele als sortiertes Array [{id, title, order, createdAt}] */
export function sortedGames(room) {
  return entries(room?.games)
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/** Spieler als sortiertes Array [{id, name, color}] */
export function sortedPlayers(room) {
  return entries(room?.players)
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
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
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
  for (const r of rows) {
    if (r.eliminated) { r.rank = null; r.inList = false; continue; }
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

  /** Timer stoppen → neuer Timer-Zustand */
  const stopped = (t) => ({ ...(t || {}), elapsed: timerValue(t, now()), startedAt: null });

  const actions = {
    // ---------- Raum ----------
    async renameRoom(name) {
      await store.set(P('meta/name'), String(name || '').trim().slice(0, ROOM_NAME_MAX) || 'Win-Challenge');
    },

    // ---------- Spieler ----------
    async addPlayer(name) {
      const existing = sortedPlayers(room());
      const color = PLAYER_COLORS[existing.length % PLAYER_COLORS.length];
      const id = store.newKey();
      await store.set(P(`players/${id}`), { name: String(name).trim(), color, createdAt: now() });
      return id;
    },
    async renamePlayer(pid, name) {
      await store.set(P(`players/${pid}/name`), String(name).trim());
    },
    async setPlayerColor(pid, color) {
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
      if (!title) return;
      await store.set(P(`games/${gid}/title`), title);
    },
    async removeGame(gid) {
      const r = room();
      const map = { [P(`games/${gid}`)]: null };
      for (const pid of Object.keys(r.runs || {})) {
        map[P(`runs/${pid}/games/${gid}`)] = null;
        if (r.runs[pid].activeGame === gid) map[P(`runs/${pid}/activeGame`)] = null;
      }
      await store.update(map);
    },
    /** neue Reihenfolge als Array von Spiel-IDs */
    async reorderGames(orderedIds) {
      const map = {};
      orderedIds.forEach((gid, i) => { map[P(`games/${gid}/order`)] = i; });
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
    async startGame(pid, gid) {
      const run = runOf(room(), pid);
      const t = now();
      const map = {};
      // anderes laufendes Spiel pausieren
      for (const [otherId, tg] of Object.entries(run.games || {})) {
        if (otherId !== gid && timerRunning(tg)) map[P(`runs/${pid}/games/${otherId}`)] = stopped(tg);
      }
      const g = run.games?.[gid] || {};
      map[P(`runs/${pid}/games/${gid}`)] = { elapsed: g.elapsed || 0, startedAt: t, done: false, doneAt: null };
      map[P(`runs/${pid}/activeGame`)] = gid;
      // Gesamtzeit automatisch mitstarten
      if (!timerRunning(run.total)) {
        map[P(`runs/${pid}/total`)] = { elapsed: run.total?.elapsed || 0, startedAt: t, finished: false };
      }
      await store.update(map);
    },
    async pauseGame(pid, gid) {
      const run = runOf(room(), pid);
      const g = run.games?.[gid];
      if (!timerRunning(g)) return;
      await store.set(P(`runs/${pid}/games/${gid}`), stopped(g));
    },
    async finishGame(pid, gid) {
      const r = room();
      const run = runOf(r, pid);
      const t = now();
      const g = run.games?.[gid] || {};
      const map = {
        [P(`runs/${pid}/games/${gid}`)]: { ...stopped(g), done: true, doneAt: t },
      };
      if (run.activeGame === gid) map[P(`runs/${pid}/activeGame`)] = null;
      // alle fertig? → Gesamtzeit stoppen
      const games = sortedGames(r);
      const allDone = games.length > 0 && games.every((x) => x.id === gid || run.games?.[x.id]?.done);
      if (allDone) map[P(`runs/${pid}/total`)] = { ...stopped(run.total), finished: true };
      await store.update(map);
    },
    async unfinishGame(pid, gid) {
      const run = runOf(room(), pid);
      const g = run.games?.[gid] || {};
      await store.update({
        [P(`runs/${pid}/games/${gid}`)]: { ...g, elapsed: g.elapsed || 0, startedAt: null, done: false, doneAt: null },
        [P(`runs/${pid}/total/finished`)]: false,
      });
    },
    async resetGameTime(pid, gid) {
      const run = runOf(room(), pid);
      const g = run.games?.[gid] || {};
      await store.set(P(`runs/${pid}/games/${gid}`), {
        elapsed: 0, startedAt: timerRunning(g) ? now() : null, done: !!g.done, doneAt: g.doneAt || null,
      });
    },
    async startTotal(pid) {
      const run = runOf(room(), pid);
      if (timerRunning(run.total)) return;
      await store.set(P(`runs/${pid}/total`), { elapsed: run.total?.elapsed || 0, startedAt: now(), finished: false });
    },
    /** Pause: stoppt Gesamtzeit UND laufendes Spiel */
    async pauseTotal(pid) {
      const run = runOf(room(), pid);
      const map = { [P(`runs/${pid}/total`)]: { ...stopped(run.total), finished: !!run.total?.finished } };
      for (const [gid, tg] of Object.entries(run.games || {})) {
        if (timerRunning(tg)) map[P(`runs/${pid}/games/${gid}`)] = stopped(tg);
      }
      await store.update(map);
    },
    /** Challenge beenden: alles stoppen, finished = true */
    async finishChallenge(pid) {
      const run = runOf(room(), pid);
      const map = { [P(`runs/${pid}/total`)]: { ...stopped(run.total), finished: true }, [P(`runs/${pid}/activeGame`)]: null };
      for (const [gid, tg] of Object.entries(run.games || {})) {
        if (timerRunning(tg)) map[P(`runs/${pid}/games/${gid}`)] = stopped(tg);
      }
      await store.update(map);
    },
    async resumeChallenge(pid) {
      const run = runOf(room(), pid);
      await store.set(P(`runs/${pid}/total`), { elapsed: run.total?.elapsed || 0, startedAt: now(), finished: false });
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
      const dup = sortedSuggestions(room()).find((s) => s.title.toLowerCase() === title.toLowerCase());
      if (dup) return dup.id;
      const id = store.newKey();
      await store.set(P(`voting/suggestions/${id}`), { title, by: pid || null, createdAt: now() });
      return id;
    },
    async renameSuggestion(sid, title) {
      title = String(title || '').trim();
      if (!title) return;
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
      const rows = votingResults(room()).filter((x) => x.inList);
      await actions.replaceGames(rows.map((x) => x.title));
      return rows.length;
    },
    /** vorhandene Spiele der Liste als Vorschläge ins Voting übernehmen */
    async importGamesAsSuggestions(pid) {
      const r = room();
      const existing = new Set(sortedSuggestions(r).map((s) => s.title.toLowerCase()));
      const t = now();
      const map = {};
      let n = 0;
      for (const g of sortedGames(r)) {
        if (existing.has(g.title.toLowerCase())) continue;
        map[P(`voting/suggestions/${store.newKey()}`)] = { title: g.title, by: pid || null, createdAt: t + n };
        n++;
      }
      if (n) await store.update(map);
      return n;
    },
  };
  return actions;
}
