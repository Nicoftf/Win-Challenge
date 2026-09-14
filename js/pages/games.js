// ============================================================
//  games.js – Seite „Spiele & Zeiten“ (index.html)
// ============================================================
//
//  Oben: Gesamtzeit des aktiven Spielers + Übersicht der anderen.
//  Mitte: gemeinsame Spieleliste mit Start/Pause/Gewonnen, Menü,
//         Inline-Umbenennen, Drag & Drop, Hinzufügen.
//  Unten: Spieler-Verwaltung und OBS-Overlay-Link.
//
//  Timer werden NICHT über Re-Render aktualisiert, sondern in tick():
//  jedes Element mit [data-timer] bekommt seinen Text per DOM gesetzt.
//  Im Template hängt der Text an `.textContent=` (Property-Binding),
//  damit lit-html keine Marker im Element ablegt, die tick() zerstören könnte.

import { boot, html, nothing, repeat, classMap, live, model, icons, toast, friendlyError, copyText, overlayUrl } from '../shell.js';

const { fmtTime, timerValue, timerRunning } = model;

// ---------- lokaler UI-State ----------
const ui = {
  editing: null,    // gid, das gerade umbenannt wird
  editValue: '',
  multi: false,     // Textarea für mehrere Spiele offen
  dragId: null,     // gid, das gerade gezogen wird
  overEl: null,     // Zeile unter dem Cursor beim Ziehen
};

const STATE_TEXT  = { idle: 'noch nicht gestartet', running: 'läuft', paused: 'pausiert', finished: 'beendet' };
const STATE_SHORT = { idle: 'nicht gestartet',      running: 'läuft', paused: 'pausiert', finished: 'fertig' };

/** Zustand der Gesamtzeit eines Runs */
function totalState(run) {
  const t = run?.total || {};
  if (t.finished) return 'finished';
  if (timerRunning(t)) return 'running';
  if ((t.elapsed || 0) > 0) return 'paused';
  return 'idle';
}

/** Aktion ausführen, Fehler als Toast. Gibt true bei Erfolg zurück. */
async function act(fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.error(e);
    toast(friendlyError(e), 'error');
    return false;
  }
}

/** Text in Spieltitel zerlegen: Zeilenumbruch oder Semikolon trennt */
function splitTitles(text) {
  return String(text || '').split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
}

function closeMenus(except = null) {
  document.querySelectorAll('details.menu[open]').forEach((d) => { if (d !== except) d.removeAttribute('open'); });
}

/** Dropdown-Menü (details/summary aus base.css). items: {label, icon?, run, danger?, disabled?} | 'hr' */
function menu(items, title = 'Mehr') {
  return html`
    <details class="menu" @toggle=${(e) => { if (e.currentTarget.open) closeMenus(e.currentTarget); }}>
      <summary class="btn btn-ghost btn-sm btn-icon" title=${title} aria-label=${title}>${icons.more()}</summary>
      <div class="menu-list">
        ${items.map((it) => it === 'hr'
          ? html`<hr>`
          : html`<button type="button" class=${classMap({ danger: !!it.danger })} ?disabled=${!!it.disabled}
              @click=${(e) => { e.currentTarget.closest('details').removeAttribute('open'); it.run(); }}>
              ${it.icon || nothing}<span>${it.label}</span></button>`)}
      </div>
    </details>`;
}

/** Timer-Element: Text hängt an .textContent, tick() aktualisiert per DOM */
function timerEl(cls, key, text) {
  return html`<span class="timer ${cls}" data-timer=${key} .textContent=${text}></span>`;
}

// ============================================================
//  Gesamtzeit-Karte
// ============================================================

function totalCard(ctx, room, run, players) {
  const A = ctx.actions;
  const pid = ctx.playerId;
  const me = ctx.player || {};
  const state = totalState(run);
  const prog = model.progressOf(room, pid);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const others = players.filter((p) => p.id !== pid);

  const finish = async () => {
    const ok = await ctx.confirm('Challenge beenden? Gesamtzeit und laufendes Spiel werden gestoppt. Du kannst sie später wieder aufnehmen.', { okLabel: 'Beenden' });
    if (ok) await act(() => A.finishChallenge(pid));
  };
  // resetRun löscht den ganzen Run: Gesamtzeit, Spielzeiten, Gewonnen-Haken, aktives Spiel
  const reset = async () => {
    const lost = prog.done ? ` (gerade ${prog.done} / ${prog.total} geschafft)` : '';
    const ok = await ctx.confirm(
      `Deinen Fortschritt komplett zurücksetzen? Alle deine Zeiten und „Gewonnen“-Haken gehen verloren${lost}. Das betrifft nur dich – die Spieleliste und die anderen Spieler bleiben.`,
      { danger: true, okLabel: 'Alles zurücksetzen' });
    if (ok) await act(() => A.resetRun(pid));
  };

  let buttons;
  switch (state) {
    case 'running':
      buttons = html`
        <button class="btn" @click=${() => act(() => A.pauseTotal(pid))}>${icons.pause()} Pause</button>
        <button class="btn" @click=${finish}>${icons.flag()} Challenge beenden</button>`;
      break;
    case 'paused':
      buttons = html`
        <button class="btn btn-primary" @click=${() => act(() => A.startTotal(pid))}>${icons.play()} Weiter</button>
        <button class="btn" @click=${finish}>${icons.flag()} Challenge beenden</button>`;
      break;
    case 'finished':
      buttons = html`
        <button class="btn" @click=${() => act(() => A.resumeChallenge(pid))}>${icons.play()} Wieder aufnehmen</button>`;
      break;
    default:
      buttons = html`
        <button class="btn btn-primary" @click=${() => act(() => A.startTotal(pid))}>${icons.play()} Challenge starten</button>`;
  }

  const pillCls = state === 'running' ? 'pill pill-accent' : state === 'finished' ? 'pill pill-green' : 'pill';
  const timerCls = 'timer-xl ' + (state === 'running' ? 'running' : state === 'finished' ? 'done' : '');

  return html`
    <section class="card total-card">
      <div class="total-top">
        <div class="total-main">
          <div class="row-wrap total-head">
            <span class="dot" style="background:${me.color || 'var(--text-faint)'}"></span>
            <span class="strong">${me.name || 'Du'}</span>
            <span class=${pillCls}>${STATE_TEXT[state]}</span>
          </div>
          ${timerEl(timerCls, 'total', fmtTime(timerValue(run.total, ctx.now), { hours: 'always' }))}
        </div>
        <div class="total-actions">
          ${buttons}
          ${menu([
            { label: 'Meinen Fortschritt zurücksetzen', icon: icons.reset(), danger: true, run: reset },
          ], 'Mehr')}
        </div>
      </div>
      <div class="total-progress">
        <span class="small muted tabular count">${prog.done} / ${prog.total} geschafft</span>
        <div class="progress"><span style="width:${pct}%"></span></div>
      </div>
      ${others.length ? html`
        <div class="others">
          ${others.map((p) => {
            const r = model.runOf(room, p.id);
            const pr = model.progressOf(room, p.id);
            const st = totalState(r);
            const cls = 'small ' + (st === 'running' ? 'running' : st === 'finished' ? 'done' : '');
            return html`
              <div class="other" title="${p.name}: ${STATE_TEXT[st]}">
                <span class="dot" style="background:${p.color}"></span>
                <span class="other-name">${p.name}</span>
                <span class="muted tabular">${pr.done} / ${pr.total}</span>
                ${timerEl(cls, `player:${p.id}`, fmtTime(timerValue(r.total, ctx.now), { hours: 'always' }))}
                <span class="faint">${STATE_SHORT[st]}</span>
              </div>`;
          })}
        </div>`
        : html`<p class="help others-empty">Noch keine anderen Spieler. Den Einladungslink gibt es oben rechts unter „Einladen“.</p>`}
    </section>`;
}

// ============================================================
//  Spieleliste
// ============================================================

// ---------- Inline-Umbenennen ----------
function startEdit(ctx, g) {
  ui.editing = g.id;
  ui.editValue = g.title;
  ctx.refresh();
  const el = document.querySelector('input[data-edit]');
  if (el) { el.focus(); el.select(); }
}
async function commitEdit(ctx, g) {
  if (ui.editing !== g.id) return;
  const value = ui.editValue.trim();
  ui.editing = null;
  ctx.refresh();
  if (value && value !== g.title) await act(() => ctx.actions.renameGame(g.id, value));
}
function cancelEdit(ctx) {
  ui.editing = null;
  ctx.refresh();
}

// ---------- Drag & Drop ----------
function clearOver() {
  if (ui.overEl) { ui.overEl.classList.remove('drag-over'); ui.overEl = null; }
}
function endDrag() {
  clearOver();
  document.querySelectorAll('.game-row.dragging').forEach((el) => el.classList.remove('dragging'));
  ui.dragId = null;
}
function onDragStart(e, gid) {
  ui.dragId = gid;
  const row = e.currentTarget.closest('.game-row');
  try {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', gid);   // Firefox braucht Daten, sonst startet kein Drag
    if (row) e.dataTransfer.setDragImage(row, 24, Math.round(row.offsetHeight / 2));
  } catch { /* ignore */ }
  // Klasse erst nach dem Start setzen, sonst wird das Drag-Bild selbst halbtransparent
  requestAnimationFrame(() => { if (ui.dragId === gid && row) row.classList.add('dragging'); });
}
function onDragOver(e) {
  if (!ui.dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  if (row.dataset.gid === ui.dragId) { clearOver(); return; }
  if (ui.overEl !== row) { clearOver(); row.classList.add('drag-over'); ui.overEl = row; }
}
function onDragLeave(e) {
  const row = e.currentTarget;
  if (e.relatedTarget && row.contains(e.relatedTarget)) return;
  if (ui.overEl === row) clearOver();
}
async function onDrop(e, ctx) {
  e.preventDefault();
  const target = e.currentTarget.dataset.gid;
  let src = ui.dragId;
  if (!src) { try { src = e.dataTransfer.getData('text/plain'); } catch { /* ignore */ } }
  endDrag();
  if (!src || !target || src === target) return;
  const ids = model.sortedGames(ctx.room).map((g) => g.id);
  const from = ids.indexOf(src);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, src);
  await act(() => ctx.actions.reorderGames(ids));
}

// ---------- Zeile ----------
function gameRow(ctx, run, g, i, n) {
  const A = ctx.actions;
  const pid = ctx.playerId;
  const t = run.games?.[g.id];
  const done = !!t?.done;
  const running = timerRunning(t);
  const isActive = !done && run.activeGame === g.id;
  const editing = ui.editing === g.id;
  const hasTime = !!t && ((t.elapsed || 0) > 0 || !!t.startedAt);

  const resetTime = async () => {
    const ok = await ctx.confirm(`Zeit von „${g.title}“ auf 00:00 setzen?`, { okLabel: 'Zurücksetzen' });
    if (ok) await act(() => A.resetGameTime(pid, g.id));
  };
  const remove = async () => {
    const ok = await ctx.confirm(`„${g.title}“ entfernen? Das Spiel verschwindet für alle Spieler – samt ihrer Zeiten dafür.`, { danger: true, okLabel: 'Entfernen' });
    if (ok) await act(() => A.removeGame(g.id));
  };

  const timerCls = (running ? 'running ' : '') + (done ? 'done ' : '') + 'game-time';

  return html`
    <div class=${classMap({ 'list-row': true, 'game-row': true, active: isActive, done })}
         data-gid=${g.id}
         @dragover=${onDragOver} @dragleave=${onDragLeave} @drop=${(e) => onDrop(e, ctx)}>
      <span class="handle" draggable="true" title="Ziehen zum Sortieren"
            @dragstart=${(e) => onDragStart(e, g.id)} @dragend=${endDrag}>${icons.drag()}</span>
      <span class="num">${i + 1}</span>
      ${editing
        ? html`<input class="input input-sm title-edit" data-edit .value=${live(ui.editValue)} autocomplete="off"
                 @input=${(e) => { ui.editValue = e.target.value; }}
                 @keydown=${(e) => {
                   if (e.key === 'Enter') { e.preventDefault(); commitEdit(ctx, g); }
                   else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(ctx); }
                 }}
                 @blur=${() => commitEdit(ctx, g)}>`
        : html`<span class="title" title="Doppelklick zum Umbenennen" @dblclick=${() => startEdit(ctx, g)}>${g.title}</span>`}
      ${isActive ? html`<span class="pill state-pill ${running ? 'pill-accent' : ''}">${running ? 'läuft' : 'pausiert'}</span>` : nothing}
      ${done ? html`<span class="green done-mark" title="Gewonnen">${icons.check()}</span>` : nothing}
      ${timerEl(timerCls, `game:${g.id}`, fmtTime(timerValue(t, ctx.now)))}
      <div class="actions">
        ${done
          ? html`<button class="btn btn-sm" title="Als nicht erledigt markieren" @click=${() => act(() => A.unfinishGame(pid, g.id))}>
              ${icons.reset()}<span class="lbl">Zurück</span></button>`
          : html`
            ${running
              ? html`<button class="btn btn-sm" title="Spiel pausieren" @click=${() => act(() => A.pauseGame(pid, g.id))}>
                  ${icons.pause()}<span class="lbl">Pause</span></button>`
              : html`<button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-start'}" title=${isActive ? 'Spiel fortsetzen' : 'Spiel starten'} @click=${() => act(() => A.startGame(pid, g.id))}>
                  ${icons.play()}<span class="lbl">${isActive ? 'Weiter' : 'Start'}</span></button>`}
            <button class="btn btn-sm ${isActive ? 'btn-success' : 'btn-win'}" title="Als gewonnen markieren" @click=${() => act(() => A.finishGame(pid, g.id))}>
              ${icons.check()}<span class="lbl">Gewonnen</span></button>`}
        ${menu([
          { label: 'Umbenennen', icon: icons.edit(), run: () => startEdit(ctx, g) },
          { label: 'Zeit zurücksetzen', icon: icons.reset(), disabled: !hasTime, run: resetTime },
          'hr',
          { label: 'Nach oben', icon: icons.up(), disabled: i === 0, run: () => act(() => A.moveGame(g.id, -1)) },
          { label: 'Nach unten', icon: icons.down(), disabled: i === n - 1, run: () => act(() => A.moveGame(g.id, 1)) },
          'hr',
          { label: 'Entfernen', icon: icons.trash(), danger: true, run: remove },
        ], `Menü für ${g.title}`)}
      </div>
    </div>`;
}

// ---------- Leerzustand ----------
function emptyState(room) {
  const nSug = Object.keys(room.voting?.suggestions || {}).length;
  return html`
    <div class="empty games-empty">
      <p><strong>Noch keine Spiele.</strong> Füge unten das erste hinzu oder übernimm das Voting-Ergebnis.</p>
      ${nSug ? html`<p class="small">Im Voting ${nSug === 1 ? 'liegt schon 1 Vorschlag' : `liegen schon ${nSug} Vorschläge`}.</p>` : nothing}
      <a class="btn btn-sm empty-link" href="voting.html">${nSug ? 'Voting-Ergebnis übernehmen' : 'Zum Voting'}</a>
    </div>`;
}

// ---------- Hinzufügen ----------
async function addMany(ctx, titles) {
  return act(async () => {
    // Alle Schreibvorgänge sofort starten: addGame liest ctx.room synchron vor dem set,
    // und der Store aktualisiert ctx.room synchron → Reihenfolge stimmt. Würde man je Spiel
    // auf die Server-Bestätigung warten, bliebe es offline nach dem ersten Spiel hängen.
    await Promise.all(titles.map((title) => ctx.actions.addGame(title)));
    if (titles.length > 1) toast(`${titles.length} Spiele hinzugefügt`, 'success');
  });
}
async function submitSingle(e, ctx) {
  e.preventDefault();
  const input = e.currentTarget.querySelector('input[name=title]');
  const titles = splitTitles(input.value);
  if (!titles.length) { input.focus(); return; }
  const before = input.value;
  input.value = '';
  const ok = await addMany(ctx, titles);
  if (!ok) input.value = before;
  input.focus();
}
async function submitMulti(e, ctx) {
  e.preventDefault();
  const ta = e.currentTarget.querySelector('textarea');
  const before = ta.value;
  const titles = splitTitles(before);
  if (!titles.length) { ta.focus(); return; }
  // sofort schließen: kein doppeltes Absenden, offline kein hängendes Formular
  ui.multi = false;
  ctx.refresh();
  const input = document.querySelector('.add-form input[name=title]');
  if (input) input.focus();
  const ok = await addMany(ctx, titles);
  if (!ok && !ui.multi) openMulti(ctx, before);
}
function openMulti(ctx, text = '') {
  ui.multi = true;
  ctx.refresh();
  const ta = document.querySelector('.add-multi textarea');
  if (!ta) return;
  if (text) ta.value = text;
  ta.focus();
  if (text) ta.setSelectionRange(ta.value.length, ta.value.length);
}
/** Mehrzeiliges Einfügen ins einzeilige Feld: der Browser würde die Zeilen zusammenkleben → Textarea öffnen */
function onPasteSingle(e, ctx) {
  const text = e.clipboardData?.getData('text/plain') || '';
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (lines.length < 2) return;
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  openMulti(ctx, el.value.slice(0, start) + text.replace(/\r\n?/g, '\n') + el.value.slice(end));
}

function addForm(ctx) {
  if (ui.multi) {
    return html`
      <form class="add-multi stack" @submit=${(e) => submitMulti(e, ctx)}>
        <label class="field">
          <span class="label">Mehrere Spiele – eins pro Zeile (oder mit Semikolon getrennt)</span>
          <textarea class="textarea" name="titles" rows="6" placeholder="Rocket League&#10;Mario Kart 8&#10;…"
            @keydown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}></textarea>
        </label>
        <div class="row-wrap">
          <button class="btn btn-primary" type="submit">${icons.plus()} Alle hinzufügen</button>
          <button class="btn btn-ghost" type="button" @click=${() => { ui.multi = false; ctx.refresh(); }}>Abbrechen</button>
          <span class="help">Strg+Enter fügt hinzu.</span>
        </div>
      </form>`;
  }
  return html`
    <form class="add-form" @submit=${(e) => submitSingle(e, ctx)}>
      <input class="input" name="title" placeholder="Spiel hinzufügen …" autocomplete="off" aria-label="Spiel hinzufügen"
        @paste=${(e) => onPasteSingle(e, ctx)}>
      <button class="btn btn-primary" type="submit">${icons.plus()} Hinzufügen</button>
      <button class="btn btn-ghost" type="button" @click=${() => openMulti(ctx)}>Mehrere einfügen</button>
    </form>`;
}

function gamesSection(ctx, room, run, games) {
  const n = games.length;
  return html`
    <section class="section games-section">
      <div class="section-head">
        <h2>Spiele</h2>
        <span class="muted small">${n ? `${n} ${n === 1 ? 'Spiel' : 'Spiele'}` : 'noch leer'}</span>
      </div>
      ${n ? html`
        <div class="list game-list">
          ${repeat(games, (g) => g.id, (g, i) => gameRow(ctx, run, g, i, n))}
        </div>
        <p class="help list-hint">Nur ein Spiel läuft gleichzeitig: Startest du eins, wird ein anderes laufendes pausiert und die Gesamtzeit läuft automatisch mit. „Gewonnen“ geht auch ohne vorherigen Start.</p>`
        : emptyState(room)}
      ${addForm(ctx)}
    </section>`;
}

// ============================================================
//  Spieler-Karte
// ============================================================

async function renamePlayer(ctx, p) {
  const name = await ctx.prompt('Neuer Name', p.name);
  if (name === null) return;
  const v = name.trim();
  if (!v || v === p.name) return;
  await act(() => ctx.actions.renamePlayer(p.id, v));
}
async function removePlayer(ctx, p) {
  const ok = await ctx.confirm(`${p.name} entfernen? Zeiten, Overlay-Einstellungen und Voting-Stimmen dieses Spielers werden gelöscht.`, { danger: true, okLabel: 'Entfernen' });
  if (ok) await act(() => ctx.actions.removePlayer(p.id));
}
async function addPlayer(ctx) {
  const name = await ctx.prompt('Name des neuen Spielers', '', { okLabel: 'Hinzufügen' });
  if (name === null) return;
  const v = name.trim();
  if (!v) return;
  const ok = await act(() => ctx.actions.addPlayer(v));
  if (ok) toast(`${v} hinzugefügt`, 'success');
}

function playersCard(ctx, players) {
  const pid = ctx.playerId;
  return html`
    <section class="card players-card">
      <div class="section-head">
        <h2>Spieler</h2>
        <span class="muted small">${players.length}</span>
      </div>
      <div class="player-rows">
        ${players.map((p) => html`
          <div class="player-row">
            <span class="dot" style="background:${p.color}"></span>
            <span class="grow player-name">${p.name}${p.id === pid ? html` <span class="faint small">(du)</span>` : nothing}</span>
            <button class="btn btn-sm btn-ghost" title="Umbenennen" @click=${() => renamePlayer(ctx, p)}>
              ${icons.edit()}<span class="lbl">Umbenennen</span></button>
            ${p.id !== pid
              ? html`<button class="btn btn-sm btn-ghost" title="Spieler entfernen" @click=${() => removePlayer(ctx, p)}>
                  ${icons.trash()}<span class="lbl">Entfernen</span></button>`
              : nothing}
          </div>`)}
      </div>
      <div class="add-player row-wrap">
        <button class="btn btn-sm" @click=${() => addPlayer(ctx)}>${icons.plus()} Spieler hinzufügen</button>
        <span class="help">Wechseln geht oben rechts.</span>
      </div>
    </section>`;
}

// ============================================================
//  Overlay-Karte
// ============================================================

function overlayCard(ctx) {
  const copy = async () => {
    const ok = await copyText(overlayUrl(ctx.roomKey, ctx.playerId));
    if (ok) toast('Overlay-URL kopiert', 'success');
    else toast('Kopieren nicht möglich – die URL steht im Overlay-Editor.', 'error');
  };
  return html`
    <section class="card stack-sm">
      <h2>OBS-Overlay</h2>
      <p class="muted small">Deine Liste und Zeiten als Browser-Quelle in OBS. Jeder Spieler hat sein eigenes Overlay.</p>
      <div class="row-wrap overlay-actions">
        <button class="btn" @click=${copy}>${icons.copy()} Overlay-URL kopieren</button>
        <a class="btn btn-ghost" href="overlay-editor.html">${icons.edit()} Overlay anpassen</a>
      </div>
      ${ctx.mode === 'local'
        ? html`<div class="note note-warn">${icons.info()}<span><strong>Lokaler Modus:</strong> OBS sieht nichts – dafür muss Firebase eingerichtet sein (siehe README).</span></div>`
        : nothing}
    </section>`;
}

// ============================================================
//  Boot
// ============================================================

boot({
  page: 'games',
  requirePlayer: true,

  render(ctx) {
    const room = ctx.room || {};
    const run = model.runOf(room, ctx.playerId);
    const games = model.sortedGames(room);
    const players = model.sortedPlayers(room);
    return html`
      <div class="page-head">
        <h1>Spiele & Zeiten</h1>
        <span class="muted small">Liste für alle · Zeiten und Haken für jeden einzeln</span>
      </div>
      ${totalCard(ctx, room, run, players)}
      ${gamesSection(ctx, room, run, games)}
      <div class="grid-2 bottom-grid">
        ${playersCard(ctx, players)}
        ${overlayCard(ctx)}
      </div>`;
  },

  // alle 250 ms: nur Timer-Texte per DOM aktualisieren
  tick(ctx) {
    const room = ctx.room || {};
    const run = model.runOf(room, ctx.playerId);
    const els = document.querySelectorAll('[data-timer]');
    for (const el of els) {
      const key = el.dataset.timer;
      let text;
      if (key === 'total') {
        text = fmtTime(timerValue(run.total, ctx.now), { hours: 'always' });
      } else if (key.startsWith('game:')) {
        text = fmtTime(timerValue(run.games?.[key.slice(5)], ctx.now));
      } else if (key.startsWith('player:')) {
        text = fmtTime(timerValue(model.runOf(room, key.slice(7)).total, ctx.now), { hours: 'always' });
      } else {
        continue;
      }
      if (el.textContent !== text) el.textContent = text;
    }
  },

  mounted() {
    // Menüs schließen bei Klick außerhalb / Escape
    document.addEventListener('click', (e) => {
      document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  },
});
