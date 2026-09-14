// ============================================================
//  overlay.js – OBS Browser-Source
//  URL: overlay.html?room=KEY&player=PID[&preview=1]
//  Eigenständig (keine shell.js): Store → Raum abonnieren → Box rendern.
//  Timer ticken alle 250 ms nur als Textknoten; Liste per lit-html (repeat).
//  Auto-Scroll nur bei Überlauf: Liste dupliziert, translateY per rAF.
// ============================================================

import { html, render, nothing } from '../../vendor/lit-html/lit-html.js';
import { repeat } from '../../vendor/lit-html/directives/repeat.js';
import { classMap } from '../../vendor/lit-html/directives/class-map.js';
import { styleMap } from '../../vendor/lit-html/directives/style-map.js';
import { createStore } from '../store.js';
import { firebaseConfig } from '../config.js';
import * as model from '../model.js';
import { icons } from '../icons.js';

const D = model.OVERLAY_DEFAULTS;
const app = document.getElementById('app');

// ---------- URL-Parameter ----------
const params = new URLSearchParams(location.search);
const roomKey = (params.get('room') || '').trim().toUpperCase();
const playerId = (params.get('player') || '').trim();
const previewParam = params.get('preview');
const preview = previewParam !== null && previewParam !== '0' && previewParam !== 'false';

// ---------- Zustand ----------
let store = null;
let room = null;
let loaded = false;          // erste Daten vom Store angekommen
let fatal = '';              // harter Fehler (z.B. Firebase lädt nicht)
let showConnectHint = false; // nach 3 s ohne Daten
let view = null;             // abgeleitete Anzeige-Daten des letzten Renders
const ui = { overflow: false };
let sample = null;           // Beispieldaten (preview=1), einmal erzeugt

const now = () => (store ? store.now() : Date.now());

// ------------------------------------------------------------
//  Google Fonts dynamisch nachladen
// ------------------------------------------------------------

const FONTS_WITH_WEIGHTS = new Set([
  'IBM Plex Sans', 'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Rubik', 'Nunito',
  'Space Grotesk', 'Oswald', 'Teko', 'Pixelify Sans', 'IBM Plex Mono', 'JetBrains Mono', 'Roboto Mono',
]);
const MONO_FONTS = new Set(['IBM Plex Mono', 'JetBrains Mono', 'Roboto Mono', 'Press Start 2P']);
const loadedFonts = new Set();

function ensureFont(name) {
  name = String(name || '').trim();
  if (!name || loadedFonts.has(name) || !model.OVERLAY_FONTS.includes(name)) return;
  loadedFonts.add(name);
  const fam = encodeURIComponent(name).replace(/%20/g, '+');
  const spec = FONTS_WITH_WEIGHTS.has(name) ? `${fam}:wght@400;600` : fam;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

function fontStack(name) {
  name = String(name || '').trim().replace(/["\\]/g, '');
  const mono = MONO_FONTS.has(name) || /mono|code|consolas|menlo|courier/i.test(name);
  const fallback = mono
    ? 'ui-monospace, Menlo, Consolas, monospace'
    : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  return name ? `"${name}", ${fallback}` : fallback;
}

// ------------------------------------------------------------
//  Hilfen
// ------------------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function color(v, def) {
  const s = String(v || '').trim();
  return HEX.test(s) ? s : def;
}
function rgba(hex, alpha) {
  let h = color(hex, '#000000').slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const a = Math.min(1, Math.max(0, Number(alpha)));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number.isFinite(a) ? a : 1})`;
}
function num(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function bool(v, def) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return def;
}

/** Settings absichern (Bereiche, Farben, Typen) */
function sanitize(s) {
  return {
    title: String(s.title ?? '').trim(),
    showTitle: bool(s.showTitle, D.showTitle),
    showTotal: bool(s.showTotal, D.showTotal),
    showProgress: bool(s.showProgress, D.showProgress),
    showNumbers: bool(s.showNumbers, D.showNumbers),
    showGameTimes: bool(s.showGameTimes, D.showGameTimes),
    showDone: bool(s.showDone, D.showDone),
    doneStyle: ['strike', 'check', 'dim'].includes(s.doneStyle) ? s.doneStyle : D.doneStyle,
    pinActive: bool(s.pinActive, D.pinActive),
    activeLabel: String(s.activeLabel ?? D.activeLabel).trim(),
    width: num(s.width, D.width, 120, 2000),
    maxHeight: num(s.maxHeight, D.maxHeight, 60, 3000),
    padding: num(s.padding, D.padding, 0, 80),
    gap: num(s.gap, D.gap, 0, 60),
    radius: num(s.radius, D.radius, 0, 100),
    borderWidth: num(s.borderWidth, D.borderWidth, 0, 20),
    shadow: bool(s.shadow, D.shadow),
    bgColor: color(s.bgColor, D.bgColor),
    bgOpacity: num(s.bgOpacity, D.bgOpacity, 0, 1),
    borderColor: color(s.borderColor, D.borderColor),
    textColor: color(s.textColor, D.textColor),
    mutedColor: color(s.mutedColor, D.mutedColor),
    accentColor: color(s.accentColor, D.accentColor),
    doneColor: color(s.doneColor, D.doneColor),
    fontFamily: String(s.fontFamily || D.fontFamily).trim() || D.fontFamily,
    fontSize: num(s.fontSize, D.fontSize, 6, 120),
    titleSize: num(s.titleSize, D.titleSize, 6, 160),
    timerFont: String(s.timerFont ?? D.timerFont).trim(),
    scrollSpeed: num(s.scrollSpeed, D.scrollSpeed, 0, 1000),
    scrollPause: num(s.scrollPause, D.scrollPause, 0, 60),
  };
}

// ------------------------------------------------------------
//  Beispieldaten (preview=1, wenn der Raum keine Spiele hat)
// ------------------------------------------------------------

const SAMPLE_TITLES = [
  'Rocket League', 'Mario Kart 8', 'Fall Guys', 'Tetris 99', 'Trackmania',
  'Overcooked 2', 'Celeste', 'Portal 2', 'Hades', 'Slay the Spire',
];

function sampleData() {
  if (sample) return sample;
  const t = now();
  const games = SAMPLE_TITLES.map((title, i) => ({ id: `sample-${i + 1}`, title, order: i, createdAt: t + i }));
  const g = {
    'sample-1': { elapsed: 12 * 60000 + 34000, startedAt: null, done: true, doneAt: t },
    'sample-2': { elapsed: 5 * 60000 + 21000, startedAt: null, done: true, doneAt: t },
    'sample-3': { elapsed: 3 * 60000 + 2000, startedAt: t - 41000, done: false, doneAt: null },
    'sample-5': { elapsed: 48000, startedAt: null, done: false, doneAt: null },
  };
  const run = {
    total: { elapsed: 22 * 60000 + 10000, startedAt: t - 41000, finished: false },
    activeGame: 'sample-3',
    games: g,
  };
  sample = { games, run };
  return sample;
}

// ------------------------------------------------------------
//  Anzeige-Daten ableiten
// ------------------------------------------------------------

function buildView() {
  const settings = sanitize(model.overlaySettings(room, playerId));
  let games = model.sortedGames(room);
  let run = model.runOf(room, playerId);
  let name = room?.meta?.name || 'Win-Challenge';
  let isSample = false;
  if (preview && games.length === 0) {
    const s = sampleData();
    games = s.games;
    run = s.run;
    isSample = true;
    if (!room) name = 'Vorschau';
  }
  const runGames = run.games || {};
  const activeId = run.activeGame && games.some((g) => g.id === run.activeGame) && !runGames[run.activeGame]?.done
    ? run.activeGame : null;
  const doneCount = games.filter((g) => runGames[g.id]?.done).length;
  return { settings, games, run, name, isSample, activeId, doneCount, total: games.length };
}

// ------------------------------------------------------------
//  Templates
// ------------------------------------------------------------

function hint(text, sub = '') {
  return html`
    <div class="ov-hint" role="status">
      <div class="ov-hint-title">Win-Challenge Overlay</div>
      <div>${text}</div>
      ${sub ? html`<div class="ov-hint-sub">${sub}</div>` : nothing}
    </div>`;
}

function row(v, g, idx, pinned = false) {
  const s = v.settings;
  const t = v.run.games?.[g.id];
  const done = !!t?.done;
  const running = model.timerRunning(t);
  const isActive = g.id === v.activeId;
  const val = model.timerValue(t, now());
  const labelText = isActive ? (running ? s.activeLabel : 'Pause') : '';
  const cls = {
    'ov-row': true,
    active: isActive,
    pinned,
    paused: isActive && !running,
    done,
    [`done-${s.doneStyle}`]: done,
  };
  const tcls = { 'ov-time': true, done, running, zero: !running && !done && val === 0 };
  return html`
    <div class=${classMap(cls)}>
      ${s.showNumbers ? html`<span class="ov-num">${idx}</span>` : nothing}
      ${done && s.doneStyle === 'check' ? html`<span class="ov-check">${icons.check()}</span>` : nothing}
      <span class="ov-name">${g.title}</span>
      ${labelText ? html`<span class="ov-label">${labelText}</span>` : nothing}
      ${s.showGameTimes
        ? html`<span class=${classMap(tcls)} data-timer="game:${g.id}"></span>`
        : nothing}
    </div>`;
}

function head(v) {
  const s = v.settings;
  if (!s.showTitle && !s.showTotal && !s.showProgress) return nothing;
  const finished = !!v.run.total?.finished;
  const pct = v.total ? Math.round((v.doneCount / v.total) * 100) : 0;
  return html`
    <div class="ov-head">
      ${s.showTitle || s.showProgress ? html`
        <div class="ov-head-main">
          ${s.showTitle ? html`<div class="ov-title">${s.title || v.name}</div>` : nothing}
          ${s.showProgress ? html`<div class="ov-progress">${v.doneCount} / ${v.total}</div>` : nothing}
        </div>` : nothing}
      ${s.showTotal ? html`
        <div class=${classMap({ 'ov-total': true, finished })} data-timer="total"></div>` : nothing}
    </div>
    ${s.showProgress && v.total ? html`<div class="ov-bar"><span style="width:${pct}%"></span></div>` : nothing}`;
}

function box(v) {
  const s = v.settings;
  const style = {
    '--w': `${s.width}px`,
    '--maxh': `${s.maxHeight}px`,
    '--pad': `${s.padding}px`,
    '--gap': `${s.gap}px`,
    '--radius': `${s.radius}px`,
    '--bw': `${s.borderWidth}px`,
    '--bc': s.borderColor,
    '--bg': rgba(s.bgColor, s.bgOpacity),
    '--text': s.textColor,
    '--muted': s.mutedColor,
    '--line': rgba(s.mutedColor, 0.25),
    '--accent': s.accentColor,
    '--accent-soft': rgba(s.accentColor, 0.14),
    '--done': s.doneColor,
    '--font': fontStack(s.fontFamily),
    '--fs': `${s.fontSize}px`,
    '--ts': `${s.titleSize}px`,
    '--tf': fontStack(s.timerFont || s.fontFamily),
    // Schatten nur rechts/unten sichtbar (Box sitzt oben links). --shadow-space ist der
    // Platz dafür: Der Editor gibt die Quellengröße als width/maxHeight + 16 px an
    // (SHADOW_SPACE in overlay-editor.js), die Box selbst bleibt width × maxHeight.
    '--shadow': s.shadow ? '0 4px 12px rgba(0, 0, 0, 0.45)' : 'none',
    '--shadow-space': s.shadow ? '16px' : '0px',
  };

  // Position im Gesamt-Array (1-basiert) bleibt auch bei ausgeblendeten Zeilen erhalten
  const indexed = v.games.map((g, i) => ({ g, idx: i + 1 }));
  const active = v.activeId ? indexed.find((x) => x.g.id === v.activeId) : null;
  const pinActive = !!(active && s.pinActive);
  const rows = indexed.filter((x) => {
    if (pinActive && x.g.id === v.activeId) return false;
    if (!s.showDone && v.run.games?.[x.g.id]?.done) return false;
    return true;
  });
  const list = (clone) => html`
    <div class="ov-list" aria-hidden=${clone ? 'true' : nothing}>
      ${repeat(rows, (x) => x.g.id, (x) => row(v, x.g, x.idx))}
    </div>`;

  return html`
    <div class="ov" style=${styleMap(style)}>
      ${head(v)}
      ${pinActive ? row(v, active.g, active.idx, true) : nothing}
      ${v.games.length === 0
        ? html`<div class="ov-empty">Noch keine Spiele</div>`
        : (rows.length ? html`
          <div class="ov-scroll">
            <div class="ov-track">
              ${list(false)}
              ${ui.overflow ? list(true) : nothing}
            </div>
          </div>` : nothing)}
    </div>`;
}

// ------------------------------------------------------------
//  Rendern
// ------------------------------------------------------------

function draw() {
  let tpl;
  view = null;
  const editorHint = 'Kopiere die Overlay-URL im Overlay-Editor (overlay-editor.html).';
  if (fatal) {
    tpl = hint(fatal, 'Prüfe js/config.js und die Internetverbindung.');
  } else if (!roomKey) {
    tpl = hint('In der URL fehlt der Raum-Code (?room=…).', editorHint);
  } else if (!model.isValidRoomKey(roomKey)) {
    tpl = hint('Der Raum-Code in der URL ist ungültig.', editorHint);
  } else if (!playerId) {
    tpl = hint('In der URL fehlt der Spieler (&player=…).', editorHint);
  } else if (!loaded) {
    tpl = showConnectHint
      ? hint('Verbinde …', 'Wenn das länger dauert: Internetverbindung und js/config.js prüfen.')
      : nothing;
  } else if (!room && !preview) {
    tpl = hint('Raum nicht gefunden.', store?.mode === 'local'
      ? 'Lokaler Modus: Daten liegen nur im Browser, in dem sie angelegt wurden. Für OBS Firebase in js/config.js eintragen.'
      : 'Prüfe die URL oder kopiere sie neu aus dem Overlay-Editor.');
  } else if (room && !room.players?.[playerId] && !preview) {
    tpl = hint('Spieler nicht gefunden.', 'Vielleicht wurde er entfernt. ' + editorHint);
  } else {
    view = buildView();
    tpl = box(view);
  }
  render(tpl, app);
  afterRender();
}

let measureDepth = 0; // Schutz gegen draw()↔measure()-Endlosschleife
function afterRender() {
  if (!view) { stopAnim(); anim.track = null; observe(null, null); return; }
  ensureFont(view.settings.fontFamily);
  ensureFont(view.settings.timerFont);
  tick(); // Timer-Texte sofort füllen (Spans werden ohne lit-Binding gerendert, s.u.)
  observe(app.querySelector('.ov-scroll'), app.querySelector('.ov-list'));
  measure();
}

/** Von außen angestoßenes Neurendern/-messen: Rekursionszähler zurücksetzen */
function redraw() { measureDepth = 0; draw(); }
function remeasure() { measureDepth = 0; measure(); }

// ------------------------------------------------------------
//  Timer-Tick (nur Textknoten)
//  Wichtig: Die [data-timer]-Elemente enthalten KEIN lit-Binding, sonst
//  würde textContent den lit-Marker zerstören und der nächste Render
//  scheitern. Text kommt ausschließlich von hier (auch direkt nach Render).
// ------------------------------------------------------------

function tick() {
  if (!view) return;
  const t = now();
  const els = app.querySelectorAll('[data-timer]');
  for (const el of els) {
    const key = el.dataset.timer;
    let text;
    if (key === 'total') {
      text = model.fmtTime(model.timerValue(view.run.total, t), { hours: 'always' });
    } else if (key.startsWith('game:')) {
      text = model.fmtTime(model.timerValue(view.run.games?.[key.slice(5)], t));
    } else continue;
    if (el.textContent !== text) el.textContent = text;
  }
}
setInterval(tick, 250);

// ------------------------------------------------------------
//  Auto-Scroll (Endlos-Loop nach oben, nur bei Überlauf)
// ------------------------------------------------------------

const anim = { raf: 0, running: false, y: 0, phase: 'pause', until: 0, last: 0, loopH: 0, track: null };
const obs = { ro: null, scroll: null, list: null };

function observe(scrollEl, listEl) {
  if (obs.scroll === scrollEl && obs.list === listEl) return;
  if (obs.ro) { obs.ro.disconnect(); obs.ro = null; }
  obs.scroll = scrollEl; obs.list = listEl;
  if (!scrollEl || !listEl || typeof ResizeObserver === 'undefined') return;
  obs.ro = new ResizeObserver(remeasure);
  obs.ro.observe(scrollEl);
  obs.ro.observe(listEl);
}

function applyTransform() {
  if (anim.track) anim.track.style.transform = anim.y ? `translate3d(0, ${anim.y.toFixed(2)}px, 0)` : '';
}

function measure() {
  if (!view) return;
  const scroll = app.querySelector('.ov-scroll');
  const list = app.querySelector('.ov-list');
  anim.track = app.querySelector('.ov-track');
  if (!scroll || !list) { stopAnim(); anim.y = 0; return; }
  const s = view.settings;
  const viewH = scroll.clientHeight;
  const listH = list.offsetHeight;
  const overflow = s.scrollSpeed > 0 && listH > viewH + 1;
  anim.loopH = listH + s.gap;
  if (overflow !== ui.overflow && measureDepth < 3) {
    // Klon ein-/ausblenden → neu rendern, danach erneut messen
    ui.overflow = overflow;
    measureDepth++;
    draw();
    return;
  }
  if (!overflow) {
    stopAnim();
    anim.y = 0;
    applyTransform();
    return;
  }
  // Position beibehalten, nur an neue Höhe anpassen
  if (anim.y < -anim.loopH) anim.y = -((-anim.y) % anim.loopH);
  applyTransform();
  startAnim();
}

function startAnim() {
  if (anim.running) return;
  anim.running = true;
  const t = performance.now();
  anim.last = t;
  anim.phase = 'pause';
  anim.until = t + (view ? view.settings.scrollPause : D.scrollPause) * 1000;
  anim.raf = requestAnimationFrame(frame);
}
function stopAnim() {
  if (!anim.running) return;
  anim.running = false;
  cancelAnimationFrame(anim.raf);
  anim.phase = 'pause';
}
function frame(t) {
  if (!anim.running) return;
  if (!view) { stopAnim(); return; }
  const s = view.settings;
  const dt = Math.min(100, Math.max(0, t - anim.last));
  anim.last = t;
  if (anim.phase === 'pause') {
    if (t >= anim.until) anim.phase = 'scroll';
  } else {
    anim.y -= (s.scrollSpeed * dt) / 1000;
    if (anim.y <= -anim.loopH) {
      anim.y = 0;
      anim.phase = 'pause';
      anim.until = t + s.scrollPause * 1000;
    }
  }
  applyTransform();
  anim.raf = requestAnimationFrame(frame);
}

if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', remeasure);
}

// ------------------------------------------------------------
//  Start
// ------------------------------------------------------------

async function main() {
  draw(); // zeigt sofort Hinweise bei fehlenden Parametern
  if (!roomKey || !model.isValidRoomKey(roomKey) || !playerId) return;
  // Timer vor createStore starten: im Firebase-Modus lädt createStore erst das SDK
  // (gstatic.com) – auch das zählt als „Verbinde …“.
  const connectTimer = setTimeout(() => { if (!loaded && !fatal) { showConnectHint = true; redraw(); } }, 3000);
  try {
    store = await createStore({ firebaseConfig });
  } catch (e) {
    clearTimeout(connectTimer);
    console.error(e);
    fatal = 'Verbindung zur Datenbank fehlgeschlagen.';
    redraw();
    return;
  }
  store.onConnection((on) => { if (!on) console.info('Overlay: keine Verbindung – Timer laufen lokal weiter.'); });
  store.subscribe(model.roomPath(roomKey), (data) => {
    clearTimeout(connectTimer);
    loaded = true;
    room = data;
    redraw();
  });
}

main().catch((e) => {
  console.error(e);
  fatal = 'Unerwarteter Fehler beim Start.';
  draw();
});
