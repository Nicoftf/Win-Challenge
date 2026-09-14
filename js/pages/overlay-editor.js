// ============================================================
//  overlay-editor.js – Seite „Overlay anpassen“ (page:'overlay')
// ============================================================
//
//  Links Formular für alle OVERLAY_DEFAULTS-Schlüssel, rechts Live-Vorschau
//  als iframe auf overlay.html?room=…&player=…&preview=1. Das iframe wird
//  nicht neu geladen – das Overlay hört selbst auf Store-Änderungen.
//
//  Speichern: ctx.actions.setOverlay(pid, {key: value})
//    Range/Color  → input-Event, per Debounce (~150 ms) gebündelt, change = sofort
//    Text/Zahl    → change-Event (Enter = Blur)
//    Checkbox/Select → sofort
//  Zahlen werden als Zahlen, Booleans als Booleans gespeichert.

import { boot, html, nothing, live, classMap, model, icons, toast, friendlyError, copyText, overlayUrl } from '../shell.js';

const { OVERLAY_DEFAULTS, OVERLAY_FONTS, OVERLAY_PRESETS } = model;
const MONO_FONTS = ['IBM Plex Mono', 'JetBrains Mono', 'Roboto Mono', 'Press Start 2P'];
const DONE_STYLES = [['strike', 'Durchgestrichen'], ['check', 'Häkchen davor'], ['dim', 'Abgeblendet']];
const BACKGROUNDS = [['dark', 'Dunkel'], ['light', 'Hell'], ['scene', 'Spielszene']];
const CUSTOM_FONT = '__custom__';
const LS_BG = 'wc.editor.bg';
const DEBOUNCE_MS = 150;
// Platz rechts/unten für den Schatten (muss zu --shadow-space in overlay.js passen).
// Die Box bleibt width × maxHeight groß, die OBS-Quelle wird um diesen Wert größer.
const SHADOW_SPACE = 16;

// ------------------------------------------------------------
//  lokaler UI-State
// ------------------------------------------------------------

const ui = {
  pid: null,             // Spieler, für den draft/customFont gelten
  bg: loadBg(),          // 'dark' | 'light' | 'scene'
  customFont: false,     // „Eigene…“ im Schriftart-Select gewählt
  copyFrom: '',          // Spieler-ID im „übernehmen von“-Select
  draft: {},             // key → Wert, der gerade bearbeitet/gespeichert wird
  open: { style: true, content: true, size: true, colors: true, font: true, behavior: true },
};

function loadBg() {
  try {
    const v = localStorage.getItem(LS_BG);
    return BACKGROUNDS.some(([id]) => id === v) ? v : 'dark';
  } catch { return 'dark'; }
}
function setBg(ctx, id) {
  ui.bg = id;
  try { localStorage.setItem(LS_BG, id); } catch { /* ignore */ }
  ctx.refresh();
}

// ------------------------------------------------------------
//  Speichern mit Debounce
// ------------------------------------------------------------

let pending = {};
let pendingPid = null;
let pendingCtx = null;
let saveTimer = null;

/** Typ wie in OVERLAY_DEFAULTS erzwingen */
function coerce(key, value) {
  const d = OVERLAY_DEFAULTS[key];
  if (typeof d === 'number') { const n = Number(value); return Number.isFinite(n) ? n : d; }
  if (typeof d === 'boolean') return !!value;
  return String(value ?? '');
}

function queueSave(ctx, key, value, { now = false } = {}) {
  if (!(key in OVERLAY_DEFAULTS)) return;
  value = coerce(key, value);
  if (pendingPid && pendingPid !== ctx.playerId) flush();   // Spielerwechsel: alten Rest wegschreiben
  pendingCtx = ctx;
  pendingPid = ctx.playerId;
  pending[key] = value;
  ui.draft[key] = value;
  if (now) { flush(); return; }
  if (!saveTimer) saveTimer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const ctx = pendingCtx;
  const pid = pendingPid;
  const patch = pending;
  pending = {};
  if (!ctx || !pid || !Object.keys(patch).length) return;
  try {
    await ctx.actions.setOverlay(pid, patch);
    for (const [k, v] of Object.entries(patch)) if (ui.draft[k] === v) delete ui.draft[k];
  } catch (e) {
    for (const k of Object.keys(patch)) delete ui.draft[k];
    toast(friendlyError(e, 'Speichern fehlgeschlagen'), 'error');
    ctx.refresh();
  }
}
// beforeunload zuerst: so zählt shell.js (eigener beforeunload-Listener, später angemeldet) den Rest schon als offen
window.addEventListener('beforeunload', () => { flush(); });
window.addEventListener('pagehide', () => { flush(); });

// ------------------------------------------------------------
//  Hilfen
// ------------------------------------------------------------

const val = (s, key) => (key in ui.draft ? ui.draft[key] : s[key]);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const decimalsOf = (step) => { const t = String(step); const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1; };
const roundTo = (n, dec) => Number(Number(n).toFixed(dec));
const enterBlur = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };

/** „#abc“ / „abcdef“ / „#AABBCC“ → „#aabbcc“, sonst null */
function normalizeHex(v) {
  let t = String(v ?? '').trim().toLowerCase();
  if (t && t[0] !== '#') t = '#' + t;
  if (/^#[0-9a-f]{3}$/.test(t)) t = '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  return /^#[0-9a-f]{6}$/.test(t) ? t : null;
}

// ------------------------------------------------------------
//  Feld-Templates
// ------------------------------------------------------------

const checkField = (ctx, s, key, label, help) => html`
  <label class="check oe-check">
    <input type="checkbox" .checked=${live(!!val(s, key))}
      @change=${(e) => queueSave(ctx, key, e.target.checked, { now: true })}>
    <span>${label}${help ? html`<span class="help">${help}</span>` : nothing}</span>
  </label>`;

const textField = (ctx, s, key, label, { placeholder = '', help = '', maxlength = 80 } = {}) => html`
  <label class="field">
    <span class="label">${label}</span>
    <input class="input" .value=${String(val(s, key) ?? '')} placeholder=${placeholder} maxlength=${maxlength}
      autocomplete="off" spellcheck="false"
      @change=${(e) => queueSave(ctx, key, e.target.value.trim(), { now: true })} @keydown=${enterBlur}>
    ${help ? html`<span class="help">${help}</span>` : nothing}
  </label>`;

const selectField = (ctx, s, key, label, options, { help = '' } = {}) => {
  const cur = String(val(s, key) ?? '');
  return html`
    <label class="field">
      <span class="label">${label}</span>
      <select class="select" .value=${live(cur)} @change=${(e) => queueSave(ctx, key, e.target.value, { now: true })}>
        ${options.map(([v, l]) => html`<option value=${v} ?selected=${v === cur}>${l}</option>`)}
      </select>
      ${help ? html`<span class="help">${help}</span>` : nothing}
    </label>`;
};

/** Range + Zahlenfeld. min/max/step in gespeicherten Einheiten; scale nur für die Anzeige (z.B. 0–1 → 0–100 %). */
const rangeField = (ctx, s, key, label, { min, max, step = 1, unit = 'px', scale = 1, help = '' }) => {
  const dec = decimalsOf(step);
  const dispStep = Number((step * scale).toPrecision(10));
  const dispDec = decimalsOf(dispStep);
  const raw = Number(val(s, key));
  const v = clamp(Number.isFinite(raw) ? raw : OVERLAY_DEFAULTS[key], min, max);
  const disp = roundTo(v * scale, dispDec);

  const onRange = (e, now) => {
    const n = roundTo(clamp(Number(e.target.value), min, max), dec);
    const num = e.target.closest('.oe-range')?.querySelector('input[type=number]');
    if (num) num.value = String(roundTo(n * scale, dispDec));
    queueSave(ctx, key, n, { now });
  };
  const onNumber = (e) => {
    const t = e.target.value.trim().replace(',', '.');
    const parsed = Number(t);
    if (t === '' || !Number.isFinite(parsed)) { e.target.value = String(disp); return; }
    const n = roundTo(clamp(parsed / scale, min, max), dec);
    e.target.value = String(roundTo(n * scale, dispDec));
    const range = e.target.closest('.oe-range')?.querySelector('input[type=range]');
    if (range) range.value = String(n);
    queueSave(ctx, key, n, { now: true });
  };

  return html`
    <div class="field">
      <div class="oe-label-row"><span class="label">${label}</span>${help ? html`<span class="help">${help}</span>` : nothing}</div>
      <div class="oe-range">
        <input type="range" min=${min} max=${max} step=${step} .value=${live(String(v))}
          aria-label=${label} @input=${(e) => onRange(e, false)} @change=${(e) => onRange(e, true)}>
        <div class="oe-num-wrap">
          <input type="number" class="input input-sm oe-num" min=${min * scale} max=${max * scale} step=${dispStep}
            .value=${String(disp)} aria-label=${`${label} (${unit})`} @change=${onNumber} @keydown=${enterBlur}>
          <span class="oe-unit">${unit}</span>
        </div>
      </div>
    </div>`;
};

const colorField = (ctx, s, key, label, help = '') => {
  const hex = normalizeHex(val(s, key)) || normalizeHex(OVERLAY_DEFAULTS[key]) || '#000000';
  const onHex = (e) => {
    const h = normalizeHex(e.target.value);
    if (!h) { toast('Farbe bitte als Hex-Wert, z.B. #c70039', 'error'); e.target.value = hex; return; }
    e.target.value = h;
    const picker = e.target.closest('.oe-color')?.querySelector('input[type=color]');
    if (picker) picker.value = h;
    queueSave(ctx, key, h, { now: true });
  };
  const onPick = (e, now) => {
    const h = normalizeHex(e.target.value);
    if (!h) return;
    const txt = e.target.closest('.oe-color')?.querySelector('.oe-hex');
    if (txt) txt.value = h;
    queueSave(ctx, key, h, { now });
  };
  return html`
    <div class="oe-color">
      <input type="color" .value=${live(hex)} title=${label} aria-label=${label}
        @input=${(e) => onPick(e, false)} @change=${(e) => onPick(e, true)}>
      <div class="grow">
        <span class="label">${label}</span>
        ${help ? html`<span class="help">${help}</span>` : nothing}
      </div>
      <input class="input input-sm mono oe-hex" .value=${hex} maxlength="7" autocomplete="off" spellcheck="false"
        aria-label=${`${label} (Hex)`} @change=${onHex} @keydown=${enterBlur}>
    </div>`;
};

const fontFamilyField = (ctx, s) => {
  const cur = String(val(s, 'fontFamily') ?? '');
  const inList = OVERLAY_FONTS.includes(cur);
  const custom = ui.customFont || !inList;
  const selVal = custom ? CUSTOM_FONT : cur;
  const onSelect = (e) => {
    const v = e.target.value;
    if (v === CUSTOM_FONT) {
      ui.customFont = true;
      ctx.refresh();
      requestAnimationFrame(() => document.querySelector('.oe-custom-font')?.focus());
      return;
    }
    ui.customFont = false;
    queueSave(ctx, 'fontFamily', v, { now: true });
    ctx.refresh();
  };
  return html`
    <div class="field">
      <span class="label">Schriftart</span>
      <select class="select" .value=${live(selVal)} aria-label="Schriftart" @change=${onSelect}>
        ${OVERLAY_FONTS.map((f) => html`<option value=${f} ?selected=${f === selVal}>${f}</option>`)}
        <option value=${CUSTOM_FONT} ?selected=${custom}>Eigene …</option>
      </select>
      ${custom ? html`
        <input class="input oe-custom-font" .value=${inList ? '' : cur} placeholder="z.B. Segoe UI" maxlength="60"
          autocomplete="off" spellcheck="false" aria-label="Eigene Schriftart"
          @change=${(e) => { const v = e.target.value.trim(); if (v) queueSave(ctx, 'fontFamily', v, { now: true }); else e.target.value = inList ? '' : cur; }}
          @keydown=${enterBlur}>
        <span class="help">Name einer Schrift, die auf dem OBS-Rechner installiert ist.</span>`
      : html`<span class="help">Wird automatisch von Google Fonts geladen.</span>`}
    </div>`;
};

const timerFontField = (ctx, s) => {
  const cur = String(val(s, 'timerFont') ?? '');
  const opts = [['', 'wie Text'], ...MONO_FONTS.map((f) => [f, f])];
  if (cur && !MONO_FONTS.includes(cur)) opts.push([cur, cur]);
  return selectField(ctx, s, 'timerFont', 'Schrift für Zeiten', opts, { help: 'Monospace hält die Ziffern beim Ticken ruhig.' });
};

const group = (id, title, body) => html`
  <details class="fold oe-group" ?open=${ui.open[id]} @toggle=${(e) => { ui.open[id] = e.target.open; }}>
    <summary>${title}<span class="chev">${icons.chevron()}</span></summary>
    <div class="fold-body">${body}</div>
  </details>`;

// ------------------------------------------------------------
//  Gruppen
// ------------------------------------------------------------

/** Vorlage anwenden: ein Schreibvorgang, ersetzt nur Aufbau/Form (siehe OVERLAY_PRESETS) */
function applyPreset(ctx, id, name) {
  const patch = OVERLAY_PRESETS[id];
  if (!patch) return;
  // Offene Einzeländerungen zuerst abschicken (flush schreibt synchron, bevor es auf den Server wartet),
  // damit sie die Vorlage nicht danach überschreiben. Nicht auf Bestätigung warten – offline hinge es sonst.
  flush();
  for (const k of Object.keys(patch)) delete ui.draft[k];
  const job = ctx.actions.setOverlay(ctx.playerId, patch);
  toast(`Vorlage „${name}“ übernommen`);
  ctx.refresh();
  job.catch((e) => { toast(friendlyError(e), 'error'); ctx.refresh(); });
}

const styleGroup = (ctx, s) => html`
  <div class="field">
    <span class="label">Vorlage</span>
    <div class="row-wrap">
      <button class="btn btn-sm" @click=${() => applyPreset(ctx, 'bar', 'Balken')}>Balken</button>
      <button class="btn btn-sm" @click=${() => applyPreset(ctx, 'classic', 'Klassisch')}>Klassisch</button>
    </div>
    <span class="help">Setzt Aufbau und Form. Titeltext, Schriftart, Größen und Farben bleiben.</span>
  </div>
  ${selectField(ctx, s, 'headerStyle', 'Titel als', [['bar', 'farbiger Balken'], ['plain', 'Text']])}
  ${rangeField(ctx, s, 'titleSize', 'Titelgröße', { min: 10, max: 64 })}
  ${selectField(ctx, s, 'totalPosition', 'Gesamtzeit steht', [['bottom', 'unter der Liste'], ['top', 'oben rechts']])}
  <div class="oe-checks">
    ${checkField(ctx, s, 'centerTotal', 'Gesamtzeit zentrieren', 'nur wenn sie unter der Liste steht')}
    ${checkField(ctx, s, 'showTotalStatus', 'Status hinter der Gesamtzeit', 'nur unter der Liste')}
    ${checkField(ctx, s, 'boldNames', 'Spielnamen fett')}
  </div>
  ${selectField(ctx, s, 'longNames', 'Zu lange Spielnamen', [['marquee', 'Laufschrift'], ['wrap', 'umbrechen'], ['cut', 'mit … kürzen']],
    { help: 'Laufschrift: Die Zeile bleibt einzeilig. Lange Namen laufen gemeinsam los und gleich schnell bis zum Ende; sind alle durch, springen sie zusammen an den Anfang.' })}`;

const contentGroup = (ctx, s) => html`
  ${textField(ctx, s, 'title', 'Titel', { placeholder: ctx.room?.meta?.name || 'Win-Challenge', help: 'Leer = Name der Challenge.' })}
  <div class="oe-checks">
    ${checkField(ctx, s, 'showTitle', 'Titel anzeigen')}
    ${checkField(ctx, s, 'showTotal', 'Gesamtzeit anzeigen')}
    ${checkField(ctx, s, 'showProgress', 'Fortschritt anzeigen', 'z.B. 3 / 22')}
    ${checkField(ctx, s, 'showNumbers', 'Spiele nummerieren')}
    ${checkField(ctx, s, 'showGameTimes', 'Zeit je Spiel anzeigen')}
    ${checkField(ctx, s, 'showDone', 'Erledigte Spiele anzeigen')}
  </div>
  ${selectField(ctx, s, 'doneStyle', 'Erledigte darstellen als', DONE_STYLES)}
  ${checkField(ctx, s, 'pinActive', 'Aktives Spiel oben anpinnen', 'bleibt beim Scrollen stehen')}
  ${textField(ctx, s, 'activeLabel', 'Label am aktiven Spiel', { placeholder: 'kein Label', help: 'Leer = kein Label. Bei Pause steht dort „Pausiert“.', maxlength: 24 })}`;

const sizeGroup = (ctx, s) => html`
  ${rangeField(ctx, s, 'width', 'Breite', { min: 200, max: 800 })}
  ${rangeField(ctx, s, 'maxHeight', 'Maximale Höhe', { min: 200, max: 1200, help: 'Längere Listen scrollen automatisch.' })}
  ${rangeField(ctx, s, 'padding', 'Innenabstand', { min: 0, max: 40 })}
  ${rangeField(ctx, s, 'gap', 'Zeilenabstand', { min: 0, max: 24 })}
  ${rangeField(ctx, s, 'radius', 'Eckenradius', { min: 0, max: 30 })}
  ${rangeField(ctx, s, 'borderWidth', 'Rahmenbreite', { min: 0, max: 6 })}
  ${checkField(ctx, s, 'shadow', 'Schatten unter der Box', `Quelle wird dafür ${SHADOW_SPACE} px breiter und höher, die Box bleibt gleich groß`)}`;

const colorGroup = (ctx, s) => html`
  ${colorField(ctx, s, 'bgColor', 'Hintergrund')}
  ${rangeField(ctx, s, 'bgOpacity', 'Deckkraft Hintergrund', { min: 0, max: 1, step: 0.01, scale: 100, unit: '%', help: 'Unter 100 % scheint die Szene durch.' })}
  ${colorField(ctx, s, 'barColor', 'Titelbalken', 'und Linie über der Gesamtzeit')}
  ${colorField(ctx, s, 'barTextColor', 'Schrift im Titelbalken')}
  ${colorField(ctx, s, 'borderColor', 'Rahmen')}
  ${colorField(ctx, s, 'textColor', 'Text')}
  ${colorField(ctx, s, 'mutedColor', 'Gedämpft', '„Pausiert“, abgeblendete Spiele, Zeiten 00:00')}
  ${colorField(ctx, s, 'accentColor', 'Akzent', 'aktives Spiel')}
  ${colorField(ctx, s, 'doneColor', 'Erledigt', 'gewonnene Spiele, Gesamtzeit nach dem Ende')}`;

const fontGroup = (ctx, s) => html`
  ${fontFamilyField(ctx, s)}
  ${rangeField(ctx, s, 'fontSize', 'Schriftgröße', { min: 10, max: 40, help: 'Spielnamen und Gesamtzeit. Titelgröße steht unter „Stil“.' })}
  ${timerFontField(ctx, s)}`;

const behaviorGroup = (ctx, s) => html`
  ${rangeField(ctx, s, 'scrollSpeed', 'Scroll-Tempo', { min: 0, max: 120, unit: 'px/s', help: '0 = kein Auto-Scroll. Scrollt nur, wenn nicht alles reinpasst.' })}
  ${rangeField(ctx, s, 'scrollPause', 'Pause pro Runde', { min: 0, max: 10, step: 0.5, unit: 's' })}`;

// ------------------------------------------------------------
//  Aktionen: Zurücksetzen / Übernehmen von
// ------------------------------------------------------------

const actionsBlock = (ctx) => {
  const others = model.sortedPlayers(ctx.room).filter((p) => p.id !== ctx.playerId);
  const hasOverrides = !!ctx.room?.overlay?.[ctx.playerId];
  const from = others.some((p) => p.id === ui.copyFrom) ? ui.copyFrom : (others[0]?.id || '');

  const reset = async () => {
    const ok = await ctx.confirm('Alle Overlay-Einstellungen auf Standard zurücksetzen?', { danger: true, okLabel: 'Zurücksetzen' });
    if (!ok) return;
    try {
      await ctx.actions.resetOverlay(ctx.playerId);
      ui.draft = {}; ui.customFont = false;
      toast('Einstellungen zurückgesetzt');
    } catch (e) { toast(friendlyError(e), 'error'); }
  };
  const copy = async () => {
    // Auswahl zur Klickzeit lesen: der Select-Change rendert nicht neu, `from` wäre veraltet
    const id = others.some((x) => x.id === ui.copyFrom) ? ui.copyFrom : others[0]?.id;
    const p = others.find((x) => x.id === id);
    if (!p) return;
    const ok = await ctx.confirm(`Overlay-Einstellungen von ${p.name} übernehmen? Deine aktuellen Einstellungen werden ersetzt.`, { okLabel: 'Übernehmen' });
    if (!ok) return;
    try {
      await ctx.actions.copyOverlay(p.id, ctx.playerId);
      ui.draft = {}; ui.customFont = false;
      toast(`Einstellungen von ${p.name} übernommen`);
    } catch (e) { toast(friendlyError(e), 'error'); }
  };

  return html`
    <div class="card oe-actions stack">
      <div class="row-wrap">
        <button class="btn" ?disabled=${!hasOverrides} @click=${reset}>${icons.reset()}<span>Zurücksetzen</span></button>
        <span class="help">${hasOverrides ? 'Setzt alle Werte auf Standard.' : 'Alles steht auf Standard.'}</span>
      </div>
      ${others.length ? html`
        <div class="field">
          <span class="label">Einstellungen übernehmen von</span>
          <div class="row">
            <select class="select grow" .value=${live(from)} aria-label="Spieler" @change=${(e) => { ui.copyFrom = e.target.value; }}>
              ${others.map((p) => html`<option value=${p.id} ?selected=${p.id === from}>${p.name}</option>`)}
            </select>
            <button class="btn" @click=${copy}>${icons.copy()}<span>Übernehmen</span></button>
          </div>
        </div>` : nothing}
    </div>`;
};

// ------------------------------------------------------------
//  Vorschau + OBS-Karte
// ------------------------------------------------------------

/** Größe der Browser-Quelle: Box (width × maxHeight) plus Platz für den Schatten */
function frameSize(s) {
  const extra = val(s, 'shadow') ? SHADOW_SPACE : 0;
  const w = Math.round(clamp(Number(val(s, 'width')) || OVERLAY_DEFAULTS.width, 100, 2000)) + extra;
  const h = Math.round(clamp(Number(val(s, 'maxHeight')) || OVERLAY_DEFAULTS.maxHeight, 100, 3000)) + extra;
  return { w, h, extra };
}

const previewCard = (ctx, s) => {
  const { w, h, extra } = frameSize(s);
  // src nur aus Raum + Spieler – bleibt bei Einstellungsänderungen gleich, das iframe lädt nicht neu
  const src = 'overlay.html?' + new URLSearchParams({ room: ctx.roomKey, player: ctx.playerId, preview: '1' }).toString();
  return html`
    <div class="card oe-preview">
      <div class="oe-preview-head">
        <h2>Vorschau</h2>
        <span class="muted small tabular" title=${extra ? `inkl. ${extra} px Platz für den Schatten` : ''}>${w} × ${h} px</span>
        <div class="btn-group right" role="group" aria-label="Vorschau-Hintergrund">
          ${BACKGROUNDS.map(([id, label]) => html`
            <button class="btn btn-sm ${classMap({ on: ui.bg === id })}" aria-pressed=${ui.bg === id ? 'true' : 'false'} @click=${() => setBg(ctx, id)}>${label}</button>`)}
        </div>
      </div>
      <div class="oe-stage ${ui.bg}">
        <div class="oe-stage-inner">
          <iframe class="oe-frame" src=${src} title="Overlay-Vorschau" scrolling="no"
            style="width:${w}px;height:${h}px"></iframe>
        </div>
      </div>
      <span class="help">Genau so groß wie später in OBS. Solange die Spieleliste leer ist, zeigt die Vorschau Beispielspiele.</span>
    </div>`;
};

const obsCard = (ctx, s) => {
  const { w, h, extra } = frameSize(s);
  const url = overlayUrl(ctx.roomKey, ctx.playerId);
  const copyUrl = async () => {
    if (await copyText(url)) toast('Overlay-URL kopiert', 'success');
    else toast('Kopieren fehlgeschlagen – URL markieren und mit Strg+C kopieren', 'error');
  };
  return html`
    <div class="card oe-obs stack">
      <h2>In OBS einbinden</h2>
      ${ctx.mode === 'local' ? html`
        <div class="note note-warn">${icons.info()}<span>
          <strong>Lokaler Modus:</strong> OBS sieht dieses Overlay nicht, weil die Daten nur in diesem Browser liegen.
          Für OBS Firebase in <code>js/config.js</code> eintragen (siehe README).
        </span></div>` : nothing}
      <div class="field">
        <span class="label">Overlay-URL für ${ctx.player?.name || 'dich'}</span>
        <div class="row">
          <input class="input mono oe-url" readonly .value=${url} aria-label="Overlay-URL"
            @focus=${(e) => e.target.select()} @click=${(e) => e.target.select()}>
          <button class="btn" @click=${copyUrl}>${icons.copy()}<span>Kopieren</span></button>
          <a class="btn btn-icon" href=${url} target="_blank" rel="noopener" title="Overlay in neuem Tab öffnen" aria-label="Overlay in neuem Tab öffnen">${icons.external()}</a>
        </div>
      </div>
      <div class="oe-size">
        <span class="label">Empfohlene Größe</span>
        <span class="tabular">Breite × Höhe: <strong>${w} × ${h}</strong> px</span>
        ${extra ? html`<span class="help">Box ${w - extra} × ${h - extra} px plus ${extra} px für den Schatten</span>` : nothing}
      </div>
      <ol class="oe-steps">
        <li>In OBS unter <strong>Quellen</strong> auf <strong>+</strong> klicken und <strong>Browser</strong> wählen.</li>
        <li>Die Overlay-URL oben in das Feld <strong>URL</strong> einfügen.</li>
        <li><strong>Breite ${w}</strong> und <strong>Höhe ${h}</strong> eintragen.</li>
        <li>Mit <strong>OK</strong> bestätigen und die Quelle in der Szene platzieren.</li>
      </ol>
      <p class="help">Änderungen hier erscheinen sofort im OBS – kein Neuladen nötig. Außerhalb der Box ist alles transparent; die Deckkraft der Box stellst du unter „Farben“ ein.</p>
    </div>`;
};

// ------------------------------------------------------------
//  Boot
// ------------------------------------------------------------

boot({
  page: 'overlay',
  requirePlayer: true,
  render(ctx) {
    if (ui.pid !== ctx.playerId) {           // Spielerwechsel → lokalen Bearbeitungsstand verwerfen
      ui.pid = ctx.playerId;
      ui.draft = {}; ui.customFont = false; ui.copyFrom = '';
    }
    const s = model.overlaySettings(ctx.room, ctx.playerId);
    return html`
      <div class="page-head">
        <h1>Overlay anpassen</h1>
        <span class="muted small">für <strong>${ctx.player?.name || ''}</strong> · jede Änderung wird sofort gespeichert und erscheint live in Vorschau und OBS</span>
      </div>
      <div class="oe-layout">
        <div class="oe-main stack">
          <div class="oe-form">
            ${group('style', 'Stil', styleGroup(ctx, s))}
            ${group('content', 'Inhalt', contentGroup(ctx, s))}
            ${group('size', 'Größe', sizeGroup(ctx, s))}
            ${group('colors', 'Farben', colorGroup(ctx, s))}
            ${group('font', 'Schrift', fontGroup(ctx, s))}
            ${group('behavior', 'Verhalten', behaviorGroup(ctx, s))}
            ${actionsBlock(ctx)}
          </div>
          ${obsCard(ctx, s)}
        </div>
        <div class="oe-side">${previewCard(ctx, s)}</div>
      </div>`;
  },
});
