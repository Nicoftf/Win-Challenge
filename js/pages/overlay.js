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
let readError = '';          // Lesefehler der Datenbank (z.B. Regeln), wird alle 10 s neu versucht
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
    headerStyle: ['bar', 'plain'].includes(s.headerStyle) ? s.headerStyle : D.headerStyle,
    totalPosition: ['bottom', 'top'].includes(s.totalPosition) ? s.totalPosition : D.totalPosition,
    showTotalStatus: bool(s.showTotalStatus, D.showTotalStatus),
    centerTotal: bool(s.centerTotal, D.centerTotal),
    longNames: ['marquee', 'wrap', 'cut'].includes(s.longNames) ? s.longNames : D.longNames,
    boldNames: bool(s.boldNames, D.boldNames),
    width: num(s.width, D.width, 120, 2000),
    maxHeight: num(s.maxHeight, D.maxHeight, 60, 3000),
    padding: num(s.padding, D.padding, 0, 80),
    gap: num(s.gap, D.gap, 0, 60),
    radius: num(s.radius, D.radius, 0, 100),
    borderWidth: num(s.borderWidth, D.borderWidth, 0, 20),
    shadow: bool(s.shadow, D.shadow),
    barColor: color(s.barColor, D.barColor),
    barTextColor: color(s.barTextColor, D.barTextColor),
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
  const labelText = isActive ? (running ? s.activeLabel : 'Pausiert') : '';   // gleiches Wort wie im Fuß
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
      <span class="ov-name"><span class="ov-name-text">${g.title}</span></span>
      ${labelText ? html`<span class="ov-label">${labelText}</span>` : nothing}
      ${s.showGameTimes
        ? html`<span class=${classMap(tcls)} data-timer="game:${g.id}"></span>`
        : nothing}
    </div>`;
}

function head(v) {
  const s = v.settings;
  const bar = s.headerStyle === 'bar';
  const totalTop = s.showTotal && s.totalPosition === 'top';
  const textTitle = s.showTitle && !bar;          // Titel als Text im Kopf (sonst im Balken)
  const finished = !!v.run.total?.finished;
  const pct = v.total ? Math.round((v.doneCount / v.total) * 100) : 0;
  return html`
    ${s.showTitle && bar ? html`<div class="ov-titlebar">${s.title || v.name}</div>` : nothing}
    ${textTitle || s.showProgress || totalTop ? html`
      <div class="ov-head">
        ${textTitle || s.showProgress ? html`
          <div class="ov-head-main">
            ${textTitle ? html`<div class="ov-title">${s.title || v.name}</div>` : nothing}
            ${s.showProgress ? html`<div class="ov-progress">${v.doneCount} / ${v.total}</div>` : nothing}
          </div>` : nothing}
        ${totalTop ? html`
          <div class=${classMap({ 'ov-total': true, finished })} data-timer="total"></div>` : nothing}
      </div>` : nothing}
    ${s.showProgress && v.total ? html`<div class="ov-bar"><span style="width:${pct}%"></span></div>` : nothing}`;
}

/** Status der Gesamtzeit für „– pausiert“ usw. ('' = noch nicht gestartet) */
function totalStatus(total) {
  if (total?.finished) return 'beendet';
  if (model.timerRunning(total)) return 'läuft';
  return (total?.elapsed || 0) > 0 ? 'pausiert' : '';
}

function foot(v) {
  const s = v.settings;
  if (!s.showTotal || s.totalPosition !== 'bottom') return nothing;
  const status = s.showTotalStatus ? totalStatus(v.run.total) : '';
  return html`
    <div class=${classMap({ 'ov-foot': true, centered: s.centerTotal, finished: !!v.run.total?.finished })}>
      <span class="ov-foot-time" data-timer="total"></span>${status ? html`<span class="ov-foot-status"><span class="ov-foot-sep">–</span>${status}</span>` : nothing}
    </div>`;
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
    '--accent-soft': rgba(s.accentColor, 0.1),
    '--barc': s.barColor,
    '--bart': s.barTextColor,
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

  const cls = { ov: true, 'ov-barstyle': s.headerStyle === 'bar', [`ov-long-${s.longNames}`]: true, 'ov-bold': s.boldNames };
  return html`
    <div class=${classMap(cls)} style=${styleMap(style)}>
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
      ${foot(v)}
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
    tpl = hint(fatal, 'Neuer Versuch in 10 Sekunden … Sonst Internetverbindung und js/config.js prüfen.');
  } else if (!roomKey) {
    tpl = hint('In der URL fehlt der Raum-Code (?room=…).', editorHint);
  } else if (!model.isValidRoomKey(roomKey)) {
    tpl = hint('Der Raum-Code in der URL ist ungültig.', editorHint);
  } else if (!playerId) {
    tpl = hint('In der URL fehlt der Spieler (&player=…).', editorHint);
  } else if (readError) {
    tpl = hint(readError, 'Neuer Versuch alle 10 Sekunden …');
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
  measureNames();
}

/** Von außen angestoßenes Neurendern/-messen: Rekursionszähler zurücksetzen */
function redraw() { measureDepth = 0; draw(); }
function remeasure() { measureDepth = 0; measure(); measureNames(); }

// ------------------------------------------------------------
//  Laufschrift für zu lange Spielnamen (longNames: 'marquee')
//  Nur Namen, die deutlich überstehen, bekommen .moving und eine Web-Animation:
//  einblenden → warten → bis zum Ende fahren → warten → ausblenden → von vorn.
//  Alle Animationen haben dieselbe Rundendauer (nach dem längsten Namen) und startTime 0,
//  hängen also an derselben Uhr: Zeilen, die neu erscheinen (Spielwechsel, Klon-Liste),
//  laufen sofort im Gleichtakt mit. Die Kanten blenden per Maske weich aus (--mq-l/--mq-r).
// ------------------------------------------------------------

const MQ = {
  speed: 55,      // px pro Sekunde (kurz sichtbare Zeilen in scrollenden Listen)
  fade: 0.35,     // s ein-/ausblenden
  hold: 1.5,      // s am Anfang stehen
  holdEnd: 1.5,   // s am Ende stehen
  edge: 0.25,     // s für das Ein-/Ausblenden der weichen Kante
  minOver: 6,     // px: kleinere Überstände laufen nicht (ragen in den Abstand), sonst Gezappel
};
const mqState = new WeakMap(); // .ov-name → { over, total, anims }

function measureNames() {
  const box = app.querySelector('.ov');
  if (!view || !box) return;
  const marquee = view.settings.longNames === 'marquee';
  const names = [...box.querySelectorAll('.ov-name')];
  // Breite des Textes selbst messen (klappt auch bei overflow:visible und während er verschoben ist)
  const overs = names.map((el) => {
    const text = el.firstElementChild;
    if (!marquee || !text) return 0;
    const over = Math.ceil(text.getBoundingClientRect().width - el.clientWidth);
    return over > MQ.minOver ? over : 0;
  });
  const maxOver = Math.max(0, ...overs);
  const move = maxOver / MQ.speed;
  const total = maxOver ? Math.ceil(2 * MQ.fade + MQ.hold + move + MQ.holdEnd) * 1000 : 0; // ganze Sekunden: seltener neu
  names.forEach((el, i) => setMarquee(el, overs[i], total, move));
}

function setMarquee(el, over, total, move) {
  const cur = mqState.get(el);
  if (cur && cur.over === over && cur.total === total) return;
  if (cur) { for (const a of cur.anims) a.cancel(); mqState.delete(el); }
  if (el.classList.contains('moving') !== over > 0) el.classList.toggle('moving', over > 0);
  const text = el.firstElementChild;
  if (!over || !text || typeof text.animate !== 'function') return;

  const off = (s) => Math.min(1, Math.max(0, (s * 1000) / total));
  const start = MQ.fade + MQ.hold;                 // Beginn der Fahrt
  const arrive = start + move;                     // Ende erreicht (alle Namen gleichzeitig)
  const edge = Math.min(MQ.edge, move / 2);
  const shift = `translateX(${-over}px)`;
  const opts = { duration: total, iterations: Infinity };
  let anims;
  try {
    anims = [
      text.animate([
        { offset: 0, transform: 'translateX(0)', opacity: 0 },
        { offset: off(MQ.fade), transform: 'translateX(0)', opacity: 1 },
        { offset: off(start), transform: 'translateX(0)', opacity: 1, easing: 'ease-in-out' },
        { offset: off(arrive), transform: shift, opacity: 1 },
        { offset: off(total / 1000 - MQ.fade), transform: shift, opacity: 1 },
        { offset: 1, transform: shift, opacity: 0 },
      ], opts),
      // weiche Kante: rechts solange Text abgeschnitten ist, links sobald er losfährt
      el.animate([
        { offset: 0, '--mq-l': '0px', '--mq-r': '0.6em' },
        { offset: off(start), '--mq-l': '0px', '--mq-r': '0.6em' },
        { offset: off(start + edge), '--mq-l': '0.6em', '--mq-r': '0.6em' },
        { offset: off(arrive - edge), '--mq-l': '0.6em', '--mq-r': '0.6em' },
        { offset: off(arrive), '--mq-l': '0.6em', '--mq-r': '0px' },
        { offset: 1, '--mq-l': '0.6em', '--mq-r': '0px' },
      ], opts),
    ];
  } catch (e) {
    // alter Browser (OBS mit sehr altem CEF): ohne Laufschrift, Name bleibt abgeschnitten
    console.warn('Overlay: Laufschrift nicht möglich', e);
    return;
  }
  for (const a of anims) a.startTime = 0;          // gemeinsame Uhr → Gleichtakt
  mqState.set(el, { over, total, anims });
}

// ------------------------------------------------------------
//  Timer-Tick (nur Textknoten)
//  Wichtig: Die [data-timer]-Elemente enthalten KEIN lit-Binding, sonst
//  würde textContent den lit-Marker zerstören und der nächste Render
//  scheitern. Text kommt ausschließlich von hier (auch direkt nach Render).
// ------------------------------------------------------------

let tickCount = 0;
function tick() {
  if (!view) return;
  // Laufschrift alle 2 s nachmessen: Zeiten ohne Monospace-Schrift ändern beim Ticken die Breite für den Namen
  if (++tickCount % 8 === 0 && view.settings.longNames === 'marquee') measureNames();
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
    // OBS-Quelle bleibt unbeaufsichtigt offen → selbst neu laden (ein fehlgeschlagener Modul-Import bleibt sonst hängen)
    setTimeout(() => location.reload(), 10000);
    return;
  }
  store.onConnection((on) => { if (!on) console.info('Overlay: keine Verbindung – Timer laufen lokal weiter.'); });
  const listen = () => store.subscribe(model.roomPath(roomKey), (data, err) => {
    clearTimeout(connectTimer);
    loaded = true;
    if (err) {
      // Firebase beendet den Listener nach einem Lesefehler → selbst neu versuchen (OBS-Quelle bleibt ja offen)
      room = null;
      readError = /permission/i.test(String(err.code || err.message))
        ? 'Keine Leseberechtigung – Datenbank-Regeln prüfen (database.rules.json).'
        : 'Die Daten konnten nicht geladen werden.';
      redraw();
      setTimeout(listen, 10000);
      return;
    }
    readError = '';
    room = data;
    redraw();
  });
  listen();
}

main().catch((e) => {
  console.error(e);
  fatal = 'Unerwarteter Fehler beim Start.';
  draw();
});
