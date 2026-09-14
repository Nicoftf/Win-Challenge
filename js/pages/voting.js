// ============================================================
//  voting.js – Seite "Voting": Spiele vorschlagen, bewerten, Ergebnis übernehmen
// ============================================================
//
//  Alles Gemeinsame (Vorschläge, Stimmen, Einstellungen) liegt unter voting/.
//  Auswertung kommt aus model.votingResults(room), Budgets aus model.voteUsage().

import { boot, html, nothing, repeat, classMap, model, icons, toast } from '../shell.js';

const { VOTE_VALUES, VOTE_INFO } = model;

// lokaler UI-State (kein Store) → nach Änderung ctx.refresh()
const ui = {
  onlyUnrated: false,   // Filter: nur Vorschläge ohne eigene Stimme
  multi: false,         // Textarea statt Einzelfeld beim Vorschlagen
  editing: null,        // sid, der gerade inline umbenannt wird
  explainOpen: null,    // null = beim ersten Render ableiten
  applied: null,        // Anzahl zuletzt übernommener Spiele (Hinweis mit Link)
  applying: false,
};

// ------------------------------------------------------------
//  Hilfen
// ------------------------------------------------------------

/** Text → Titel-Liste (Zeilenumbruch oder Semikolon trennt) */
function splitTitles(text) {
  return String(text || '').split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const budgetText = (n) => (n > 0 ? String(n) : 'unbegrenzt');

function closeMenu(e) {
  const d = e.target.closest('details');
  if (d) d.open = false;
}

// ------------------------------------------------------------
//  Aktionen (alle über ctx.actions, Fehler → toast)
// ------------------------------------------------------------

async function addSuggestions(ctx, text, field) {
  const titles = splitTitles(text);
  if (!titles.length) return;
  const known = new Set(Object.keys(ctx.room?.voting?.suggestions || {}));
  const seen = new Set();   // gleiche Titel innerhalb einer Eingabe
  let added = 0, dups = 0;
  // Alle Aufrufe sofort starten: addSuggestion liest ctx.room synchron vor dem Schreiben,
  // und der Store aktualisiert ctx.room synchron. So hängt nichts, wenn Firebase gerade offline ist.
  const jobs = [];
  for (const t of titles) {
    const key = t.toLowerCase();
    if (seen.has(key)) { dups++; continue; }
    seen.add(key);
    jobs.push(ctx.actions.addSuggestion(t, ctx.playerId));   // model mergt Duplikate → bekannte id
  }
  const typed = field ? field.value : '';
  if (field) field.value = '';
  let ids;
  try {
    ids = await Promise.all(jobs);
  } catch (e) {
    if (field && !field.value) field.value = typed;
    toast(e.message, 'error');
    return;
  }
  for (const id of ids) {
    if (!id || known.has(id)) dups++;
    else { known.add(id); added++; }
  }
  if (titles.length === 1) {
    if (dups) toast('Gibt es schon');
  } else {
    toast(`${plural(added, 'Spiel', 'Spiele')} vorgeschlagen${dups ? `, ${dups} gab es schon` : ''}`, added ? 'success' : 'info');
  }
  if (field) { field.value = ''; field.focus(); }
}

async function castVote(ctx, sid, value) {
  const current = ctx.room?.voting?.votes?.[ctx.playerId]?.[sid] || null;
  try {
    await ctx.actions.vote(ctx.playerId, sid, current === value ? null : value);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function startEdit(ctx, sid) {
  ui.editing = sid;
  ctx.refresh();
  queueMicrotask(() => {
    const el = document.querySelector('input.sug-edit');
    if (el) { el.focus(); el.select(); }
  });
}

async function commitEdit(ctx, sid, value) {
  if (ui.editing !== sid) return;   // schon gespeichert/abgebrochen (Enter + Blur)
  ui.editing = null;
  const title = String(value || '').trim();
  const s = ctx.room?.voting?.suggestions?.[sid];
  if (title && s && title !== s.title && model.votingSettings(ctx.room).closed) {
    toast('Das Voting ist geschlossen', 'error');
  } else if (title && s && title !== s.title) {
    const lower = title.toLowerCase();
    const dup = model.sortedSuggestions(ctx.room).some((x) => x.id !== sid && String(x.title || '').toLowerCase() === lower);
    if (dup) toast('Gibt es schon', 'error');
    else {
      try { await ctx.actions.renameSuggestion(sid, title); } catch (e) { toast(e.message, 'error'); }
    }
  }
  ctx.refresh();
}

function cancelEdit(ctx) {
  ui.editing = null;
  ctx.refresh();
}

async function removeSuggestion(ctx, s) {
  const ok = await ctx.confirm(`„${s.title}“ aus dem Voting entfernen? Das gilt für alle, Stimmen dafür gehen verloren.`, { danger: true, okLabel: 'Entfernen' });
  if (!ok) return;
  if (model.votingSettings(ctx.room).closed) { toast('Das Voting ist geschlossen', 'error'); return; }
  try { await ctx.actions.removeSuggestion(s.id); } catch (e) { toast(e.message, 'error'); }
}

async function importGames(ctx) {
  try {
    const n = await ctx.actions.importGamesAsSuggestions(ctx.playerId);
    toast(n ? `${plural(n, 'Spiel', 'Spiele')} aus der Spieleliste übernommen` : 'Alle Spiele sind schon drin', n ? 'success' : 'info');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function setSetting(ctx, key, value) {
  try { await ctx.actions.setVotingSettings({ [key]: value }); } catch (e) { toast(e.message, 'error'); }
}

function setNumberSetting(ctx, key, e, min, max = 500) {
  let n = parseInt(e.target.value, 10);
  // leer/ungültig → alten Wert wiederherstellen (0 hieße sonst „unbegrenzt“ bzw. „alle“)
  if (!Number.isFinite(n)) { e.target.value = String(model.votingSettings(ctx.room)[key]); return; }
  n = Math.min(max, Math.max(min, n));
  e.target.value = String(n);
  setSetting(ctx, key, n);
}

async function applyResult(ctx) {
  const rows = model.votingResults(ctx.room).filter((r) => r.inList);
  const games = model.sortedGames(ctx.room);
  if (!rows.length) { toast('Es ist noch kein Spiel drin', 'error'); return; }
  const msg = games.length
    ? `Ersetzt die aktuelle Spieleliste (${plural(games.length, 'Spiel', 'Spiele')}) und setzt alle Zeiten zurück. Weiter?`
    : `${plural(rows.length, 'Spiel', 'Spiele')} als Spieleliste übernehmen?`;
  const ok = await ctx.confirm(msg, { danger: games.length > 0, okLabel: 'Übernehmen' });
  if (!ok) return;
  ui.applying = true;
  ctx.refresh();
  try {
    const n = await ctx.actions.applyVotingResult();
    ui.applied = n;
    toast(`${plural(n, 'Spiel', 'Spiele')} übernommen`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
  ui.applying = false;
  ctx.refresh();
}

// ------------------------------------------------------------
//  Templates
// ------------------------------------------------------------

function explainBlock(settings) {
  const must = settings.mustBudget > 0 ? `max. ${settings.mustBudget}×` : 'unbegrenzt';
  const veto = settings.vetoBudget > 0 ? `max. ${settings.vetoBudget}×` : 'unbegrenzt';
  const target = settings.targetCount > 0 ? `Die besten ${settings.targetCount} Spiele ohne Veto` : 'Alle Spiele ohne Veto';
  return html`
    <details class="fold explain" ?open=${ui.explainOpen} @toggle=${(e) => { ui.explainOpen = e.target.open; }}>
      <summary>${icons.info()} So funktioniert das Voting <span class="chev">${icons.chevron()}</span></summary>
      <div class="fold-body">
        <p>Jeder bewertet jedes vorgeschlagene Spiel mit einer von fünf Stimmen.</p>
        <p><b class="v-must">Muss rein</b> +3 (${must}) · <b class="v-yes">Gerne</b> +1 · <b>Egal</b> 0 · <b class="v-no">Lieber nicht</b> −1 · <b class="v-veto">Veto</b> = Spiel fliegt raus (${veto}).</p>
        <p class="legend">Kürzel in der Tabelle:
          ${VOTE_VALUES.map((v) => html`<span class="legend-item"><span class="chip vchip vchip-${v}">${VOTE_INFO[v].short}</span> ${VOTE_INFO[v].label}</span>`)}
          <span class="legend-item"><span class="chip vchip vchip-none"></span> noch keine Stimme</span></p>
        <p>${target} kommen in die Spieleliste. Bei Gleichstand zählt, wer mehr „Muss rein“ hat.</p>
        <p>Das Ergebnis unten ist live. Wenn alle fertig sind, übernimmt einer es als Spieleliste.</p>
      </div>
    </details>`;
}

function suggestForm(ctx, closed) {
  if (ui.multi) {
    const submit = (e) => {
      e.preventDefault();
      const ta = e.target.elements.titles;
      addSuggestions(ctx, ta.value, ta);
    };
    return html`
      <form class="stack-sm suggest-form" @submit=${submit}>
        <textarea class="textarea" name="titles" rows="4" placeholder="Ein Spiel pro Zeile" ?disabled=${closed}
          @keydown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.form.requestSubmit(); } }}></textarea>
        <div class="row-wrap">
          <button class="btn btn-primary" type="submit" ?disabled=${closed}>${icons.plus()} Alle vorschlagen</button>
          <button class="btn btn-ghost" type="button" @click=${() => { ui.multi = false; ctx.refresh(); }}>Einzeln eingeben</button>
          <span class="help">Strg+Enter sendet</span>
        </div>
      </form>`;
  }
  const submit = (e) => {
    e.preventDefault();
    const input = e.target.elements.title;
    addSuggestions(ctx, input.value, input);
  };
  return html`
    <form class="row suggest-form" @submit=${submit}>
      <input class="input grow" name="title" placeholder=${closed ? 'Voting geschlossen' : 'Spiel vorschlagen … (mehrere mit ; trennen)'} autocomplete="off" ?disabled=${closed}>
      <button class="btn btn-primary" type="submit" ?disabled=${closed} title="Vorschlagen">${icons.plus()}<span class="hide-sm">Vorschlagen</span></button>
      <button class="btn btn-ghost" type="button" title="Mehrere Spiele auf einmal eingeben" ?disabled=${closed} @click=${() => { ui.multi = true; ctx.refresh(); }}>Mehrere</button>
    </form>`;
}

function budgetLine(ctx, settings, usage, total, unratedCount) {
  const mustFull = settings.mustBudget > 0 && usage.must >= settings.mustBudget;
  const vetoFull = settings.vetoBudget > 0 && usage.veto >= settings.vetoBudget;
  return html`
    <div class="budget">
      <span class=${classMap({ full: mustFull })} title="Deine „Muss rein“-Stimmen">Muss rein: <b>${usage.must}</b> / ${budgetText(settings.mustBudget)}</span>
      <span class="sep">·</span>
      <span class=${classMap({ 'full-veto': vetoFull })} title="Deine Vetos">Veto: <b>${usage.veto}</b> / ${budgetText(settings.vetoBudget)}</span>
      <span class="sep">·</span>
      <span title="Von dir bewertete Vorschläge">Bewertet: <b>${usage.rated}</b> / ${total}</span>
      <label class="check">
        <input type="checkbox" .checked=${ui.onlyUnrated} @change=${(e) => { ui.onlyUnrated = e.target.checked; ctx.refresh(); }}>
        Nur unbewertete${unratedCount ? ` (${unratedCount})` : ''}
      </label>
    </div>`;
}

function suggestionRow(ctx, s, mine, byName, closed) {
  const editing = ui.editing === s.id;
  return html`
    <div class=${classMap({ 'list-row': true, sug: true, unrated: !mine })}>
      <div class="title-wrap">
        ${editing ? html`
          <input class="input input-sm sug-edit" .value=${s.title} autocomplete="off" aria-label="Neuer Titel"
            @keydown=${(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(ctx, s.id, e.target.value); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(ctx); }
            }}
            @blur=${(e) => commitEdit(ctx, s.id, e.target.value)}>`
        : html`
          <div class="title" title=${s.title}>${s.title}</div>
          ${byName ? html`<div class="by">von ${byName}</div>` : nothing}`}
      </div>
      <div class="btn-group vote-group" role="group" aria-label="Deine Stimme für ${s.title}">
        ${VOTE_VALUES.map((v) => html`
          <button type="button"
            class=${classMap({ btn: true, 'btn-sm': true, ['vote-' + v]: true, on: mine === v })}
            title="${VOTE_INFO[v].label} – ${VOTE_INFO[v].hint}${mine === v ? ' (nochmal klicken entfernt die Stimme)' : ''}"
            aria-pressed=${String(mine === v)}
            ?disabled=${closed}
            @click=${() => castVote(ctx, s.id, v)}>
            <span class="vote-long">${VOTE_INFO[v].label}</span><span class="vote-short">${VOTE_INFO[v].short}</span>
          </button>`)}
      </div>
      <div class="actions">
        ${closed ? html`
          <button type="button" class="btn btn-ghost btn-icon btn-sm" disabled
            title="Voting geschlossen – Umbenennen und Entfernen gesperrt" aria-label="Menü gesperrt (Voting geschlossen)">${icons.more()}</button>`
        : html`
          <details class="menu">
            <summary class="btn btn-ghost btn-icon btn-sm" title="Mehr" aria-label="Menü für ${s.title}">${icons.more()}</summary>
            <div class="menu-list">
              <button type="button" @click=${(e) => { closeMenu(e); startEdit(ctx, s.id); }}>${icons.edit()} Umbenennen</button>
              <button type="button" class="danger" @click=${(e) => { closeMenu(e); removeSuggestion(ctx, s); }}>${icons.trash()} Entfernen</button>
            </div>
          </details>`}
      </div>
    </div>`;
}

function voteChip(p, v) {
  if (!v) return html`<span class="chip vchip vchip-none" title="${p.name}: noch keine Stimme"></span>`;
  return html`<span class="chip vchip vchip-${v}" title="${p.name}: ${VOTE_INFO[v].label}">${VOTE_INFO[v].short}</span>`;
}

function statusPill(r, playersById, targetCount) {
  if (r.eliminated) {
    const names = Object.entries(r.votes).filter(([, v]) => v === 'veto').map(([pid]) => playersById[pid]?.name || '?');
    return html`<span class="pill pill-red" title="Veto von ${names.join(', ')}">Veto</span>`;
  }
  if (r.inList) return html`<span class="pill pill-green">drin</span>`;
  const close = targetCount > 0 && r.rank <= targetCount + 3;
  return html`<span class="pill" title="Platz ${r.rank} – ${close ? 'nur knapp ' : ''}nicht unter den oberen ${targetCount}">${close ? 'knapp draußen' : 'draußen'}</span>`;
}

function resultTable(ctx, results, players, playersById, settings) {
  const rows = [];
  results.forEach((r, i) => {
    rows.push({ key: r.id, tpl: html`
      <tr class=${classMap({ out: !r.inList && !r.eliminated, veto: r.eliminated })}>
        <td class="rank">${r.rank ?? '–'}</td>
        <td class="game">${r.title}</td>
        <td class="score">${r.score}</td>
        ${players.map((p) => html`<td class="vote-cell">${voteChip(p, r.votes[p.id])}</td>`)}
        <td class="status">${statusPill(r, playersById, settings.targetCount)}</td>
      </tr>` });
    const next = results[i + 1];
    if (settings.targetCount > 0 && r.rank === settings.targetCount && next && !next.eliminated) {
      rows.push({ key: '__cut', tpl: html`
        <tr class="cut"><td colspan=${4 + players.length}><div class="cut-line">Grenze: die oberen ${settings.targetCount} kommen rein</div></td></tr>` });
    }
  });
  return html`
    <div class="table-wrap">
      <table class="table result-table">
        <thead><tr><th>#</th><th>Spiel</th><th class="num">Punkte</th>
          ${players.map((p) => html`<th class="vote-head" title=${p.name}><span class="dot" style="background:${p.color}"></span><span class="vote-head-name">${p.name}</span></th>`)}
          <th>Status</th></tr></thead>
        <tbody>${repeat(rows, (x) => x.key, (x) => x.tpl)}</tbody>
      </table>
    </div>`;
}

function participation(ctx, players, total) {
  return html`
    <div class="part-list">
      ${players.map((p) => {
        const u = model.voteUsage(ctx.room, p.id);
        const done = total > 0 && u.rated >= total;
        return html`
          <div class="part-row">
            <span class="dot" style="background:${p.color}"></span>
            <span class="name">${p.name}${p.id === ctx.playerId ? html` <span class="faint tiny">(du)</span>` : nothing}</span>
            <span class="count">${u.rated} / ${total} bewertet</span>
            <span class="state" title=${done ? 'Alles bewertet' : 'Noch nicht fertig'}>${done ? icons.check() : nothing}</span>
          </div>`;
      })}
    </div>`;
}

function settingsBlock(ctx, settings) {
  return html`
    <details class="fold settings">
      <summary>Einstellungen <span class="chev">${icons.chevron()}</span></summary>
      <div class="fold-body">
        <label class="field-row">
          <span class="label">Zielanzahl</span>
          <span class="row-wrap">
            <input class="input input-num" type="number" min="0" max="500" step="1" .value=${String(settings.targetCount)}
              @change=${(e) => setNumberSetting(ctx, 'targetCount', e, 0)}>
            <span class="help">Spiele, die in die Liste kommen · 0 = alle ohne Veto</span>
          </span>
        </label>
        <label class="field-row">
          <span class="label">Muss-rein-Budget</span>
          <span class="row-wrap">
            <input class="input input-num" type="number" min="0" max="500" step="1" .value=${String(settings.mustBudget)}
              @change=${(e) => setNumberSetting(ctx, 'mustBudget', e, 0)}>
            <span class="help">pro Spieler · 0 = unbegrenzt</span>
          </span>
        </label>
        <label class="field-row">
          <span class="label">Veto-Budget</span>
          <span class="row-wrap">
            <input class="input input-num" type="number" min="0" max="500" step="1" .value=${String(settings.vetoBudget)}
              @change=${(e) => setNumberSetting(ctx, 'vetoBudget', e, 0)}>
            <span class="help">pro Spieler · 0 = unbegrenzt</span>
          </span>
        </label>
        <label class="check">
          <input type="checkbox" .checked=${!!settings.closed} @change=${(e) => setSetting(ctx, 'closed', e.target.checked)}>
          Voting geschlossen
        </label>
        <p class="help">Geschlossen: niemand kann mehr abstimmen, vorschlagen, umbenennen oder entfernen. Das Ergebnis bleibt sichtbar. Gilt für alle.</p>
      </div>
    </details>`;
}

// ------------------------------------------------------------
//  Seite
// ------------------------------------------------------------

boot({
  page: 'voting',
  requirePlayer: true,

  render(ctx) {
    const room = ctx.room || {};
    const settings = model.votingSettings(room);
    const closed = !!settings.closed;
    const players = model.sortedPlayers(room);
    const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
    const suggestions = model.sortedSuggestions(room);
    const games = model.sortedGames(room);
    const myVotes = room.voting?.votes?.[ctx.playerId] || {};
    const usage = model.voteUsage(room, ctx.playerId);
    const results = model.votingResults(room);
    const inListCount = results.filter((r) => r.inList).length;
    const unrated = suggestions.filter((s) => !myVotes[s.id]);
    const visible = ui.onlyUnrated ? unrated : suggestions;
    const sugTitles = new Set(suggestions.map((s) => s.title.toLowerCase()));
    const canImport = games.some((g) => !sugTitles.has(String(g.title || '').toLowerCase()));

    if (ui.explainOpen === null) ui.explainOpen = suggestions.length === 0;
    if (ui.editing && (closed || !room.voting?.suggestions?.[ui.editing])) ui.editing = null;

    const byName = (s) => (s.by === ctx.playerId ? 'dir' : playersById[s.by]?.name || '');

    return html`
      <div class="page-head">
        <h1>Voting</h1>
        <span class="muted small">${plural(suggestions.length, 'Vorschlag', 'Vorschläge')} · ${plural(players.length, 'Spieler', 'Spieler')}</span>
        ${closed ? html`<span class="pill pill-red right">${icons.lock()} geschlossen</span>` : nothing}
      </div>

      ${explainBlock(settings)}

      ${closed ? html`<div class="note note-lock section">${icons.lock()}<span>Das Voting ist geschlossen – Stimmen und Vorschläge sind gesperrt. Öffnen geht unter „Einstellungen“.</span></div>` : nothing}

      <section class="section">
        <div class="section-head">
          <h2>Vorschläge</h2>
          <span class="muted small">Jeder kann Spiele vorschlagen und alle bewerten</span>
        </div>
        ${suggestForm(ctx, closed)}
        ${budgetLine(ctx, settings, usage, suggestions.length, unrated.length)}
        ${suggestions.length === 0 ? html`
          <div class="empty">
            <strong>Noch keine Vorschläge.</strong><br>
            Schlag oben das erste Spiel vor${canImport ? ' – oder übernimm die vorhandene Spieleliste' : ''}.
          </div>`
        : visible.length === 0 ? html`
          <div class="empty">${suggestions.length === 1 ? 'Du hast den Vorschlag bewertet.' : `Du hast alle ${suggestions.length} Vorschläge bewertet.`}</div>`
        : html`
          <div class="list sug-list">
            ${repeat(visible, (s) => s.id, (s) => suggestionRow(ctx, s, myVotes[s.id] || null, byName(s), closed))}
          </div>`}
        <div class="list-foot">
          ${canImport ? html`
            <button class="btn btn-sm" ?disabled=${closed} @click=${() => importGames(ctx)}>${icons.plus()} Spieleliste als Vorschläge übernehmen</button>
            <span class="help">Übernimmt die Spiele aus der Spiele-Seite, die hier noch fehlen.</span>` : nothing}
          ${!closed && suggestions.length ? html`<span class="help">Nochmal auf die aktive Stimme klicken entfernt sie.</span>` : nothing}
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Ergebnis</h2>
          <span class="muted small">live · ${settings.targetCount > 0 ? `die oberen ${settings.targetCount} kommen rein` : 'alle ohne Veto kommen rein'}</span>
        </div>
        ${results.length === 0
          ? html`<div class="empty">Noch nichts auszuwerten. Sobald es Vorschläge gibt, steht hier die Rangliste.</div>`
          : resultTable(ctx, results, players, playersById, settings)}
        ${results.length && settings.targetCount > 0 && inListCount < settings.targetCount ? html`
          <p class="help result-foot">${inListCount} von ${settings.targetCount} Plätzen belegt – es passen noch ${plural(settings.targetCount - inListCount, 'Spiel', 'Spiele')} rein.</p>` : nothing}
        <div class="apply-row">
          <button class="btn btn-primary" ?disabled=${!inListCount || ui.applying} @click=${() => applyResult(ctx)}>
            ${icons.check()} Ergebnis als Spieleliste übernehmen
          </button>
          <span class="help">
            ${inListCount
              ? `${plural(inListCount, 'Spiel', 'Spiele')} in Reihenfolge des Rangs${games.length ? ` – ersetzt die aktuelle Liste (${games.length}) und setzt alle Zeiten zurück` : ''}.`
              : 'Noch kein Spiel drin.'}
          </span>
        </div>
        ${ui.applied ? html`
          <div class="note note-ok" style="margin-top:10px">
            ${icons.check()}<span>${plural(ui.applied, 'Spiel', 'Spiele')} übernommen. <a href="index.html">Zur Spieleliste</a></span>
          </div>` : nothing}
      </section>

      <div class="grid-2">
        <section class="section">
          <div class="section-head"><h2>Beteiligung</h2><span class="muted small">${suggestions.length} zu bewerten</span></div>
          ${players.length ? participation(ctx, players, suggestions.length) : html`<p class="muted">Noch keine Spieler.</p>`}
        </section>
        <section class="section">
          <div class="section-head"><h2>Regeln</h2><span class="muted small">gelten für alle</span></div>
          ${settingsBlock(ctx, settings)}
        </section>
      </div>`;
  },

  mounted() {
    // offene Zeilenmenüs schließen: Klick woanders oder Escape (wie auf der Spiele-Seite)
    document.addEventListener('click', (e) => {
      document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach((d) => { d.open = false; });
    });
  },
});
