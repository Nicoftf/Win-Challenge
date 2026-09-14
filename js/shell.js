// ============================================================
//  shell.js – gemeinsamer Rahmen für alle Seiten (außer overlay.html)
// ============================================================
//
//  Kümmert sich um: Store starten, Raum-Code (URL ?room= / localStorage),
//  Onboarding (Raum erstellen/beitreten, Spieler wählen), Kopfzeile mit
//  Navigation + Spielerwechsel, Ticker für Timer, Fehler-/Offline-Banner.
//
//  Verwendung in einer Seite:
//
//    import { boot, html, repeat, classMap, model, icons } from './shell.js';
//    boot({
//      page: 'games',            // 'games' | 'voting' | 'overlay'  (Nav-Highlight)
//      requirePlayer: true,      // true → vorher Spieler wählen
//      render(ctx) { return html`...`; },   // Inhalt unter der Kopfzeile
//      tick(ctx) { ... },        // optional, alle 250 ms (Timer im DOM aktualisieren)
//      mounted(ctx) { ... },     // optional, einmal nach dem ersten Render
//    });
//
//  ctx = {
//    store, room, roomKey, playerId, player (Objekt|null), actions, now (ms),
//    online (bool), mode ('firebase'|'local'),
//    refresh()            – neu rendern (z.B. nach lokalem UI-State-Wechsel)
//    setPlayer(pid)       – aktiven Spieler wechseln
//    toast(msg, kind?)    – kurze Meldung unten ('info'|'error'|'success')
//    confirm(msg)         – Promise<bool>, einfacher Bestätigungsdialog
//    prompt(msg, value?)  – Promise<string|null>
//  }

import { html, render, nothing } from '../vendor/lit-html/lit-html.js';
import { repeat } from '../vendor/lit-html/directives/repeat.js';
import { classMap } from '../vendor/lit-html/directives/class-map.js';
import { styleMap } from '../vendor/lit-html/directives/style-map.js';
import { live } from '../vendor/lit-html/directives/live.js';
import { ifDefined } from '../vendor/lit-html/directives/if-defined.js';
import { createStore } from './store.js';
import { firebaseConfig } from './config.js';
import * as model from './model.js';
import { icons } from './icons.js';

export { html, render, nothing, repeat, classMap, styleMap, live, ifDefined, model, icons };

const LS_ROOM = 'wc.room';
const LS_PLAYER = 'wc.player';

export function getStoredRoomKey() {
  try { return localStorage.getItem(LS_ROOM) || null; } catch { return null; }
}
export function getStoredPlayerId() {
  try { return localStorage.getItem(LS_PLAYER) || null; } catch { return null; }
}
function storeRoomKey(key) {
  try { key ? localStorage.setItem(LS_ROOM, key) : localStorage.removeItem(LS_ROOM); } catch { /* ignore */ }
}
function storePlayerId(pid) {
  try { pid ? localStorage.setItem(LS_PLAYER, pid) : localStorage.removeItem(LS_PLAYER); } catch { /* ignore */ }
}

/** Link zum Teilen: gleiche Seite, mit ?room=KEY */
export function shareLink(roomKey, page = 'index.html') {
  const u = new URL(page, location.href);
  u.searchParams.set('room', roomKey);
  return u.toString();
}

/** absolute URL des OBS-Overlays für einen Spieler */
export function overlayUrl(roomKey, pid) {
  const u = new URL('overlay.html', location.href);
  u.searchParams.set('room', roomKey);
  u.searchParams.set('player', pid);
  return u.toString();
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      return true;
    } catch { return false; }
  }
}

/** Fehler (u.a. Firebase PERMISSION_DENIED) in verständlichen deutschen Text übersetzen */
export function friendlyError(e) {
  const raw = String((e && (e.code || e.message)) || e || '');
  if (/permission/i.test(raw)) {
    return 'Keine Berechtigung – sind die Datenbank-Regeln aus database.rules.json veröffentlicht? (README → Firebase einrichten)';
  }
  return `Fehler: ${e && e.message ? e.message : e}`;
}

// ------------------------------------------------------------
//  Toast / Dialoge
// ------------------------------------------------------------

let toastTimer = null;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `toast toast-${kind} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 4500 : 2500);
}

function dialog({ title, message, input = null, okLabel = 'OK', cancelLabel = 'Abbrechen', danger = false, maxlength = null }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'modal-backdrop';
    const close = (v) => { render(nothing, host); host.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(input !== null ? null : false); };
    document.addEventListener('keydown', onKey);
    const submit = (e) => {
      e.preventDefault();
      close(input !== null ? host.querySelector('input').value : true);
    };
    render(html`
      <form class="modal" @submit=${submit} @click=${(e) => e.stopPropagation()}>
        ${title ? html`<h3 class="modal-title">${title}</h3>` : nothing}
        ${message ? html`<p class="modal-text">${message}</p>` : nothing}
        ${input !== null ? html`<input class="input" name="value" .value=${input} maxlength=${ifDefined(maxlength ?? undefined)} autocomplete="off">` : nothing}
        <div class="modal-actions">
          <button type="button" class="btn" @click=${() => close(input !== null ? null : false)}>${cancelLabel}</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${okLabel}</button>
        </div>
      </form>`, host);
    host.addEventListener('click', () => close(input !== null ? null : false));
    document.body.appendChild(host);
    const focusEl = host.querySelector('input') || host.querySelector('button[type=submit]');
    focusEl && focusEl.focus();
    if (host.querySelector('input')) host.querySelector('input').select();
  });
}
export function confirmDialog(message, { title = '', okLabel = 'Ja', danger = false } = {}) {
  return dialog({ title, message, okLabel, danger });
}
export function promptDialog(message, value = '', { title = '', okLabel = 'Speichern', maxlength = null } = {}) {
  return dialog({ title, message, input: value, okLabel, maxlength });
}

// ------------------------------------------------------------
//  Boot
// ------------------------------------------------------------

export async function boot(page) {
  const app = document.getElementById('app');
  const ctx = {
    store: null, room: null, roomKey: null, playerId: null, player: null, actions: null,
    now: Date.now(), online: true, mode: 'local',
    refresh: () => draw(),
    setPlayer: (pid) => { ctx.playerId = pid; storePlayerId(pid); draw(); },
    toast, confirm: confirmDialog, prompt: promptDialog,
  };
  let phase = 'loading';   // loading | room | player | ready | error
  let errorMsg = '';
  let unsubRoom = null;
  let firstRender = true;
  let roomLoaded = false;

  render(html`<div class="loading">Lade …</div>`, app);

  try {
    ctx.store = await createStore({ firebaseConfig });
  } catch (e) {
    console.error(e);
    phase = 'error';
    errorMsg = 'Firebase konnte nicht geladen werden. Prüfe js/config.js und deine Internetverbindung.';
    draw();
    return;
  }
  ctx.mode = ctx.store.mode;
  ctx.store.onConnection((on) => { ctx.online = on; draw(); });

  // Raum-Code aus URL übernehmen
  const url = new URL(location.href);
  const urlRoom = (url.searchParams.get('room') || '').toUpperCase().trim();
  if (urlRoom && model.isValidRoomKey(urlRoom)) {
    storeRoomKey(urlRoom);
    url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  }
  ctx.roomKey = getStoredRoomKey();
  ctx.playerId = getStoredPlayerId();

  function openRoom(key) {
    if (unsubRoom) unsubRoom();
    ctx.roomKey = key;
    ctx.actions = model.bindActions(ctx.store, key, () => ctx.room);
    roomLoaded = false;
    phase = 'loading';
    draw();
    unsubRoom = ctx.store.subscribe(model.roomPath(key), (room) => {
      roomLoaded = true;
      ctx.room = room;
      if (!room) { phase = 'room'; errorMsg = 'Diesen Raum gibt es nicht (mehr). Bitte Code prüfen.'; draw(); return; }
      errorMsg = '';
      phase = 'ready';
      draw();
    });
  }

  async function createRoom(name) {
    const key = model.generateRoomKey();
    await ctx.store.set(model.roomPath(key, 'meta'), { name: name.trim().slice(0, model.ROOM_NAME_MAX) || 'Win-Challenge', createdAt: ctx.store.now() });
    await ctx.store.set(model.roomPath(key, 'voting/settings'), model.VOTING_DEFAULTS);
    storeRoomKey(key);
    ctx.playerId = null; storePlayerId(null);
    openRoom(key);
  }
  async function joinRoom(input) {
    let key = String(input || '').trim();
    try { const u = new URL(key); key = u.searchParams.get('room') || key; } catch { /* kein Link */ }
    key = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!model.isValidRoomKey(key)) { toast('Das sieht nicht nach einem gültigen Code aus.', 'error'); return; }
    const meta = await ctx.store.get(model.roomPath(key, 'meta'));
    if (!meta) { toast('Kein Raum mit diesem Code gefunden.', 'error'); return; }
    storeRoomKey(key);
    ctx.playerId = null; storePlayerId(null);
    openRoom(key);
  }
  function leaveRoom() {
    if (unsubRoom) unsubRoom();
    unsubRoom = null;
    storeRoomKey(null); storePlayerId(null);
    ctx.roomKey = null; ctx.room = null; ctx.playerId = null; ctx.player = null;
    phase = 'room'; errorMsg = '';
    draw();
  }

  /** Aktion mit gesperrtem Button und verständlicher Fehlermeldung ausführen */
  async function guarded(fn, form) {
    const btn = form && form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(friendlyError(e), 'error');
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  // ---------- Templates ----------

  const modeBanner = () => ctx.mode === 'local'
    ? html`<div class="banner banner-local">
        <strong>Lokaler Modus.</strong> Daten bleiben nur in diesem Browser – kein Sync mit den anderen, kein OBS-Overlay.
        Für den echten Einsatz Firebase in <code>js/config.js</code> eintragen (siehe README).
      </div>`
    : (!ctx.online ? html`<div class="banner banner-offline">Keine Verbindung – Änderungen werden gespeichert, sobald du wieder online bist.</div>` : nothing);

  const roomScreen = () => html`
    <div class="onboarding">
      <div class="onboarding-brand">${icons.trophy()} Win-Challenge</div>
      ${errorMsg ? html`<div class="banner banner-error">${errorMsg}</div>` : nothing}
      <div class="onboarding-grid">
        <form class="card stack" @submit=${async (e) => { e.preventDefault(); await guarded(() => createRoom(e.target.name.value), e.target); }}>
          <h2>Neue Challenge anlegen</h2>
          <p class="muted">Du bekommst einen Code, den du den anderen schickst.</p>
          <label class="field"><span class="label">Name der Challenge</span>
            <input class="input" name="name" placeholder="z.B. Win-Challenge Herbst 2026" maxlength=${model.ROOM_NAME_MAX} autocomplete="off" required></label>
          <button class="btn btn-primary" type="submit">Anlegen</button>
        </form>
        <form class="card stack" @submit=${async (e) => { e.preventDefault(); await guarded(() => joinRoom(e.target.code.value), e.target); }}>
          <h2>Challenge beitreten</h2>
          <p class="muted">Code oder Einladungslink von deinem Freund einfügen.</p>
          <label class="field"><span class="label">Code oder Link</span>
            <input class="input mono" name="code" placeholder="ABCD…" autocomplete="off" required></label>
          <button class="btn" type="submit">Beitreten</button>
        </form>
      </div>
    </div>`;

  const playerScreen = () => {
    const players = model.sortedPlayers(ctx.room);
    return html`
      <div class="onboarding">
        <div class="onboarding-brand">${icons.trophy()} ${ctx.room?.meta?.name || 'Win-Challenge'}</div>
        <div class="card stack onboarding-single">
          <h2>Wer bist du?</h2>
          ${players.length ? html`
            <div class="player-pick">
              ${players.map((p) => html`
                <button class="btn btn-lg player-btn" @click=${() => ctx.setPlayer(p.id)}>
                  <span class="dot" style="background:${p.color}"></span>${p.name}
                </button>`)}
            </div>
            <div class="divider"><span>oder</span></div>` : nothing}
          <form class="row" @submit=${async (e) => {
            e.preventDefault();
            const name = e.target.name.value.trim();
            if (!name) return;
            await guarded(async () => { const pid = await ctx.actions.addPlayer(name); ctx.setPlayer(pid); }, e.target);
          }}>
            <input class="input grow" name="name" placeholder="Neuer Spieler: dein Name" autocomplete="off" required>
            <button class="btn btn-primary" type="submit">Los</button>
          </form>
          <p class="muted small">Jeder Spieler hat eigene Zeiten und ein eigenes Overlay. Die Spieleliste und das Voting sind gemeinsam.</p>
          <button class="btn btn-ghost btn-sm" @click=${leaveRoom}>Anderen Raum wählen</button>
        </div>
      </div>`;
  };

  const header = () => {
    const players = model.sortedPlayers(ctx.room);
    const nav = [
      ['games', 'index.html', 'Spiele'],
      ['voting', 'voting.html', 'Voting'],
      ['overlay', 'overlay-editor.html', 'Overlay'],
    ];
    return html`
      <header class="topbar">
        <div class="topbar-inner container">
          <a class="brand" href="index.html" title="Zur Spieleliste">${icons.trophy()}<span class="brand-name">${ctx.room?.meta?.name || 'Win-Challenge'}</span></a>
          <nav class="nav">
            ${nav.map(([id, href, label]) => html`<a href=${href} class=${classMap({ active: page.page === id })}>${label}</a>`)}
          </nav>
          <div class="topbar-right">
            ${players.length ? html`
              <label class="player-switch" title="Aktiver Spieler">
                ${icons.user()}
                <select class="select select-sm" .value=${live(ctx.playerId || '')} @change=${(e) => ctx.setPlayer(e.target.value || null)}>
                  ${!ctx.playerId ? html`<option value="">Spieler wählen…</option>` : nothing}
                  ${players.map((p) => html`<option value=${p.id} ?selected=${p.id === ctx.playerId}>${p.name}</option>`)}
                </select>
              </label>` : nothing}
            <button class="btn btn-sm btn-ghost" title="Einladungslink kopieren" @click=${async () => {
              await copyText(shareLink(ctx.roomKey)); toast('Einladungslink kopiert');
            }}>${icons.link()}<span class="hide-sm">Einladen</span></button>
            <details class="menu room-menu">
              <summary class="btn btn-sm btn-ghost btn-icon" title="Challenge-Menü" aria-label="Challenge-Menü">${icons.more()}</summary>
              <div class="menu-list" @click=${(e) => { if (e.target.closest('button')) e.currentTarget.parentElement.open = false; }}>
                <button @click=${async () => {
                  const name = await promptDialog('Neuer Name der Challenge', ctx.room?.meta?.name || '', { title: 'Challenge umbenennen', maxlength: model.ROOM_NAME_MAX });
                  if (name === null) return;
                  try { await ctx.actions.renameRoom(name); toast('Name gespeichert', 'success'); } catch (e) { toast(friendlyError(e), 'error'); }
                }}>${icons.edit()} Challenge umbenennen</button>
                <button @click=${async () => {
                  await copyText(ctx.roomKey); toast('Raum-Code kopiert');
                }}>${icons.copy()} Raum-Code kopieren</button>
                <hr>
                <button @click=${async () => {
                  const ok = await confirmDialog('Du verlässt diese Challenge nur auf diesem Gerät. Mit dem Einladungslink kommst du jederzeit zurück.', { title: 'Andere Challenge öffnen', okLabel: 'Weiter' });
                  if (ok) leaveRoom();
                }}>${icons.external()} Andere Challenge öffnen</button>
              </div>
            </details>
          </div>
        </div>
      </header>`;
  };

  function draw() {
    let body;
    if (phase === 'error') {
      body = html`<div class="onboarding"><div class="banner banner-error">${errorMsg}</div></div>`;
    } else if (phase === 'loading' || (ctx.roomKey && !roomLoaded)) {
      body = html`<div class="loading">Lade …</div>`;
    } else if (phase === 'room' || !ctx.roomKey) {
      body = roomScreen();
    } else {
      const players = ctx.room?.players || {};
      if (ctx.playerId && !players[ctx.playerId]) { ctx.playerId = null; storePlayerId(null); }
      ctx.player = ctx.playerId ? { id: ctx.playerId, ...players[ctx.playerId] } : null;
      if (page.requirePlayer && !ctx.playerId) {
        body = playerScreen();
      } else {
        ctx.now = ctx.store.now();
        body = html`${header()}<main class="container page">${page.render(ctx)}</main>`;
      }
    }
    render(html`${modeBanner()}${body}`, app);
    if (firstRender && phase === 'ready') { firstRender = false; page.mounted && page.mounted(ctx); }
  }

  // offene Kopfzeilen-Menüs bei Klick außerhalb schließen
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details.room-menu[open]')) {
      if (!d.contains(e.target)) d.open = false;
    }
  });

  // Timer-Ticker
  setInterval(() => {
    if (phase !== 'ready' || !page.tick) return;
    ctx.now = ctx.store.now();
    page.tick(ctx);
  }, 250);

  if (ctx.roomKey) openRoom(ctx.roomKey);
  else { phase = 'room'; draw(); }
}
