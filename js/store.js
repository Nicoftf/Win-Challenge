// ============================================================
//  store.js – Datenzugriff (Firebase Realtime Database oder lokal)
// ============================================================
//
//  Einheitliche API für beide Modi:
//    store.mode                  'firebase' | 'local'
//    store.subscribe(path, cb)   cb(value|null, err?) sofort + bei jeder Änderung → unsubscribe()
//                                err nur bei Lesefehlern (z.B. PERMISSION_DENIED); danach kommt nichts mehr
//    store.get(path)             Promise<value|null>
//    store.set(path, value)      Promise<void>   (null = löschen)
//    store.update({path: value}) Promise<void>   mehrere Pfade atomar, absolute Pfade
//    store.push(path, value)     Promise<key>
//    store.remove(path)          Promise<void>
//    store.transaction(path, fn) Promise<bool>   fn(aktueller Wert) → neuer Wert, undefined = abbrechen.
//                                Firebase ruft fn erneut mit dem Serverstand auf, wenn jemand dazwischen
//                                geschrieben hat. true = geschrieben.
//    store.pendingSince()        Zeitpunkt (ms) des ältesten noch nicht vom Server bestätigten Schreibvorgangs, sonst null
//    store.now()                 geschätzte Serverzeit in ms
//    store.newKey()              neuer eindeutiger, zeitlich sortierbarer Schlüssel
//    store.onConnection(cb)      cb(true|false)
//
//  Pfade sind immer absolut, z.B. "rooms/ABC123/games/-N8x…".
//  Werte wie in Firebase: leere Objekte existieren nicht, undefined ist verboten.
//  Firebase bestätigt Schreibvorgänge erst nach Antwort des Servers. Offline bleiben sie im Speicher
//  der Seite und gehen beim Neuladen verloren (deshalb pendingSince).

const FIREBASE_VERSION = '12.19.0';
const FB = (m) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${m}.js`;

export async function createStore({ firebaseConfig } = {}) {
  if (firebaseConfig && firebaseConfig.databaseURL) {
    return createFirebaseStore(firebaseConfig);
  }
  return createLocalStore();
}

// ------------------------------------------------------------
//  Hilfen
// ------------------------------------------------------------

/** entfernt undefined rekursiv (Firebase verweigert undefined) */
export function clean(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clean);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = clean(v);
  }
  return out;
}

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
let lastRand = [];
/** Firebase-kompatible Push-ID: 20 Zeichen, chronologisch sortierbar */
export function generatePushId(now = Date.now()) {
  const duplicate = now === lastPushTime;
  lastPushTime = now;
  const ts = new Array(8);
  for (let i = 7; i >= 0; i--) {
    ts[i] = PUSH_CHARS.charAt(now % 64);
    now = Math.floor(now / 64);
  }
  if (!duplicate) {
    lastRand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
  } else {
    let i = 11;
    while (i >= 0 && lastRand[i] === 63) { lastRand[i] = 0; i--; }
    if (i >= 0) lastRand[i]++;
  }
  return ts.join('') + lastRand.map((r) => PUSH_CHARS.charAt(r)).join('');
}

function splitPath(path) {
  return String(path).split('/').filter(Boolean);
}

function getAt(root, path) {
  let cur = root;
  for (const seg of splitPath(path)) {
    if (cur === null || typeof cur !== 'object' || !(seg in cur)) return null;
    cur = cur[seg];
  }
  return cur === undefined ? null : cur;
}

function isEmptyObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0;
}

/** setzt value an path (null löscht) und entfernt leere Elternobjekte */
function setAt(root, path, value) {
  const segs = splitPath(path);
  if (segs.length === 0) {
    return value === null || isEmptyObject(value) ? {} : clone(value);
  }
  const stack = [root];
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (cur[seg] === null || typeof cur[seg] !== 'object') cur[seg] = {};
    cur = cur[seg];
    stack.push(cur);
  }
  const last = segs[segs.length - 1];
  if (value === null || value === undefined || isEmptyObject(value)) {
    delete cur[last];
  } else {
    cur[last] = clone(value);
  }
  // leere Eltern aufräumen
  for (let i = stack.length - 1; i > 0; i--) {
    if (isEmptyObject(stack[i])) delete stack[i - 1][segs[i - 1]];
    else break;
  }
  return root;
}

function clone(v) {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

// ------------------------------------------------------------
//  Lokaler Store (localStorage + BroadcastChannel für andere Tabs)
// ------------------------------------------------------------

function createLocalStore() {
  const KEY = 'wc.localdb';
  const subs = new Set();
  const connSubs = new Set();
  let data = load();
  let channel = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.error('localStorage', e); }
    try { channel && channel.postMessage('change'); } catch { /* ignore */ }
    notify();
  }
  function reload() { data = load(); notify(); }
  function notify() {
    for (const s of Array.from(subs)) {
      const v = getAt(data, s.path);
      const j = JSON.stringify(v);
      if (j !== s.last) { s.last = j; s.cb(clone(v)); }
    }
  }
  try {
    channel = new BroadcastChannel('wc-local');
    channel.onmessage = reload;
  } catch { /* kein BroadcastChannel */ }
  window.addEventListener('storage', (e) => { if (e.key === KEY) reload(); });

  return {
    mode: 'local',
    subscribe(path, cb) {
      const s = { path, cb, last: undefined };
      subs.add(s);
      queueMicrotask(() => {
        if (!subs.has(s)) return;
        const v = getAt(data, path);
        s.last = JSON.stringify(v);
        cb(clone(v));
      });
      return () => subs.delete(s);
    },
    async get(path) { return clone(getAt(data, path)); },
    async set(path, value) { data = setAt(data, path, clean(value)); persist(); },
    async update(map) {
      for (const [p, v] of Object.entries(map)) data = setAt(data, p, clean(v));
      persist();
    },
    async push(path, value) {
      const key = generatePushId();
      data = setAt(data, `${path}/${key}`, clean(value));
      persist();
      return key;
    },
    async remove(path) { data = setAt(data, path, null); persist(); },
    async transaction(path, fn) {
      const next = fn(clone(getAt(data, path)));
      if (next === undefined) return false;
      data = setAt(data, path, clean(next));
      persist();
      return true;
    },
    pendingSince() { return null; },
    now() { return Date.now(); },
    newKey() { return generatePushId(); },
    onConnection(cb) { connSubs.add(cb); queueMicrotask(() => cb(true)); return () => connSubs.delete(cb); },
  };
}

// ------------------------------------------------------------
//  Firebase Realtime Database
// ------------------------------------------------------------

async function createFirebaseStore(config) {
  const [{ initializeApp }, db] = await Promise.all([import(FB('app')), import(FB('database'))]);
  const app = initializeApp(config);
  const database = db.getDatabase(app);
  let offset = 0;
  db.onValue(db.ref(database, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });

  // noch nicht bestätigte Schreibvorgänge (Startzeitpunkte)
  const pending = new Set();
  const track = (promise) => {
    const entry = { t: Date.now() };
    pending.add(entry);
    return promise.finally(() => pending.delete(entry));
  };

  return {
    mode: 'firebase',
    subscribe(path, cb) {
      return db.onValue(
        db.ref(database, path),
        (snap) => cb(snap.val()),
        (err) => { console.error('Firebase subscribe', path, err); cb(null, err); }
      );
    },
    async get(path) { return (await db.get(db.ref(database, path))).val(); },
    set(path, value) { return track(db.set(db.ref(database, path), clean(value))); },
    update(map) {
      const cleaned = {};
      for (const [p, v] of Object.entries(map)) cleaned[p] = clean(v);
      return track(db.update(db.ref(database), cleaned));
    },
    async push(path, value) {
      const r = db.push(db.ref(database, path));
      await track(db.set(r, clean(value)));
      return r.key;
    },
    remove(path) { return track(db.remove(db.ref(database, path))); },
    transaction(path, fn) {
      const run = db.runTransaction(db.ref(database, path), (cur) => {
        const next = fn(cur);
        return next === undefined ? undefined : clean(next);
      });
      return track(run).then(
        (r) => r.committed,
        // "set": ein anderer Schreibvorgang auf denselben Pfad hat die Transaktion überholt
        (e) => { if (e?.message === 'set') return false; throw e; }
      );
    },
    pendingSince() {
      let oldest = null;
      for (const e of pending) if (oldest === null || e.t < oldest) oldest = e.t;
      return oldest;
    },
    now() { return Date.now() + offset; },
    newKey() { return db.push(db.ref(database, '_keys')).key; },
    onConnection(cb) {
      return db.onValue(db.ref(database, '.info/connected'), (s) => cb(s.val() === true));
    },
  };
}
