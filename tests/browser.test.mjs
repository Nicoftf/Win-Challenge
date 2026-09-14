// ============================================================
//  tests/browser.test.mjs – Ende-zu-Ende-Test aller Seiten im Headless-Browser
// ============================================================
//  node tests/browser.test.mjs
//
//  Startet selbst einen Server (scripts/serve.mjs, freier Port) und einen
//  Headless-Chrome/Edge/Chromium, legt Testdaten im lokalen Modus an und prüft:
//  Onboarding, Spiele-Seite, Voting, Overlay (Größe, Transparenz, Auto-Scroll),
//  Overlay-Editor und Handy-Breite. Screenshots landen in tests/.shots/.
//
//  Optionen (Umgebungsvariablen):
//    BASE=https://nicoftf.github.io/Win-Challenge/   gegen eine andere Adresse testen
//    CHROME=C:\Pfad\zu\chrome.exe                    Browser-Pfad
//
//  Hinweis: Mit eingetragener Firebase-Config (js/config.js) läuft der Test NICHT
//  im lokalen Modus und würde echte Daten anlegen. Er bricht dann ab.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/cdp.mjs';
import { SEED, setValue } from './lib/seed.mjs';
import { startServer } from '../scripts/serve.mjs';

const SHOTS = fileURLToPath(new URL('./.shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0, passes = 0;
function check(ok, msg, detail) {
  if (ok) { passes++; console.log('  ok   ' + msg); }
  else { fails++; console.log('  FAIL ' + msg + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

let server = null;
let BASE = process.env.BASE;
if (!BASE) {
  server = await startServer(0);
  BASE = server.url;
}
if (!BASE.endsWith('/')) BASE += '/';
console.log('Teste ' + BASE);

const b = await launch({ width: 1280, height: 900 });
try {
  // ---------- Onboarding ----------
  console.log('\nOnboarding');
  await b.goto(BASE + 'index.html', 1500);
  const onboarding = await b.eval(`({ text: document.querySelector('#app').innerText, svg: document.querySelector('svg path')?.constructor.name })`);
  if (!/Lokaler Modus/.test(onboarding.text)) {
    throw new Error('Seite läuft nicht im lokalen Modus (Firebase eingetragen?). Test abgebrochen, damit keine echten Daten entstehen.');
  }
  check(/Neue Challenge anlegen/.test(onboarding.text) && /Challenge beitreten/.test(onboarding.text), 'Anlegen/Beitreten sichtbar');
  check(onboarding.svg === 'SVGPathElement', 'Icons sind echte SVG-Elemente', onboarding.svg);

  const seed = await b.eval(SEED);
  check(seed.games === 15, 'Testdaten angelegt, Voting-Ergebnis mit 15 Spielen übernommen', seed);

  // ---------- Spiele-Seite ----------
  console.log('\nSpiele-Seite');
  await b.goto(BASE + 'index.html', 1500);
  const idx = await b.eval(`({
    rows: document.querySelectorAll('.game-row').length,
    active: document.querySelector('.game-row.active .title')?.textContent,
    progress: document.querySelector('.progress span')?.style.width,
    head: document.querySelector('.total-head')?.textContent.replace(/\\s+/g, ' ').trim(),
  })`);
  check(idx.rows === 15, '15 Spielzeilen', idx.rows);
  check(!!idx.active, 'aktives Spiel markiert', idx.active);
  check(idx.progress === '20%', 'Fortschrittsbalken 3/15 = 20%', idx.progress);
  check(/Gesamtzeit.*gemeinsam für alle/.test(idx.head || ''), 'eine gemeinsame Gesamtzeit für alle', idx.head);

  const t1 = await b.eval(`document.querySelector('[data-timer="total"]').textContent`);
  await sleep(1300);
  const t2 = await b.eval(`document.querySelector('[data-timer="total"]').textContent`);
  check(t1 !== t2, 'Gesamtzeit tickt', [t1, t2]);

  const start = await b.eval(`(async () => {
    const row = document.querySelectorAll('.game-row')[8];
    const title = row.querySelector('.title').textContent;
    [...row.querySelectorAll('button')].find((x) => /Start/.test(x.textContent)).click();
    await new Promise((r) => setTimeout(r, 600));
    return { title, active: document.querySelector('.game-row.active .title')?.textContent, running: document.querySelectorAll('.game-row .timer.running').length };
  })()`);
  check(start.title === start.active, 'Start macht das Spiel aktiv', start);
  check(start.running === 1, 'nur ein Spiel läuft gleichzeitig', start.running);
  await b.eval(`document.querySelector('.game-row.active').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await b.shot(SHOTS + 'index-active.png');

  // Gefahr-Dialog (Spiel entfernen) nur ansehen, dann abbrechen
  await b.eval(`(async () => {
    const d = document.querySelector('.game-row details.menu');
    d.querySelector('summary').click();
    await new Promise((r) => setTimeout(r, 200));
    [...d.querySelectorAll('.menu-list button')].find((x) => /Entfernen/.test(x.textContent)).click();
    await new Promise((r) => setTimeout(r, 300));
  })()`);
  await b.shot(SHOTS + 'dialog-danger.png');
  await b.eval(`(async () => { document.querySelector('.modal-actions .btn').click(); await new Promise((r) => setTimeout(r, 200)); })()`);

  const finish = await b.eval(`(async () => {
    const row = document.querySelector('.game-row.active');
    [...row.querySelectorAll('button')].find((x) => /Gewonnen/.test(x.textContent)).click();
    await new Promise((r) => setTimeout(r, 600));
    return { active: document.querySelector('.game-row.active') ? 'ja' : 'nein', count: document.querySelector('.total-card').innerText.match(/\\d+ \\/ \\d+ geschafft/)?.[0] };
  })()`);
  check(finish.active === 'nein' && finish.count === '4 / 15 geschafft', 'Gewonnen hakt ab und zählt hoch', finish);

  const add = await b.eval(`(async () => {
    const f = document.querySelector('.add-form');
    const i = f.querySelector('input');
    i.value = 'Neues Testspiel';
    f.requestSubmit();
    await new Promise((r) => setTimeout(r, 600));
    return { last: [...document.querySelectorAll('.game-row .title')].pop().textContent, field: document.querySelector('.add-form input').value };
  })()`);
  check(add.last === 'Neues Testspiel' && add.field === '', 'Spiel hinzufügen, Feld wird geleert', add);

  const paste = await b.eval(`(async () => {
    const i = document.querySelector('.add-form input');
    i.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Paste A\\nPaste B\\nPaste C');
    i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 800));
    return document.querySelector('textarea')?.value;
  })()`);
  check(paste === 'Paste A\nPaste B\nPaste C', 'mehrzeiliges Einfügen öffnet „Mehrere einfügen“', paste);

  const menu = await b.eval(`(async () => {
    const d = document.querySelector('details.room-menu');
    d.querySelector('summary').click();
    await new Promise((r) => setTimeout(r, 200));
    const heights = [...d.querySelectorAll('.menu-list button')].map((x) => Math.round(x.getBoundingClientRect().height));
    [...d.querySelectorAll('.menu-list button')][0].click();
    await new Promise((r) => setTimeout(r, 300));
    const input = document.querySelector('.modal input');
    const maxlength = input.getAttribute('maxlength');
    input.value = 'Umbenannt';
    document.querySelector('.modal').requestSubmit();
    await new Promise((r) => setTimeout(r, 600));
    return { heights, maxlength, brand: document.querySelector('.brand-name').textContent, closed: !d.open };
  })()`);
  check(menu.heights.every((h) => h < 40), 'Kopfzeilen-Menü einzeilig', menu.heights);
  check(menu.maxlength === '80' && menu.brand === 'Umbenannt' && menu.closed, 'Challenge umbenennen', menu);
  await b.shot(SHOTS + 'index-desktop.png');

  // ---------- Voting ----------
  console.log('\nVoting');
  await b.goto(BASE + 'voting.html', 1500);
  const vote = await b.eval(`(async () => {
    const first = () => document.querySelectorAll('.sug')[0];
    [...first().querySelectorAll('.vote-group button')].find((x) => /Gerne/.test(x.textContent)).click();
    await new Promise((r) => setTimeout(r, 500));
    const on1 = first().querySelector('.vote-group .on')?.textContent.trim();
    first().querySelector('.vote-group .on').click();
    await new Promise((r) => setTimeout(r, 500));
    const on2 = first().querySelector('.vote-group .on') ? 'noch an' : 'aus';
    let toast = '';
    for (const row of document.querySelectorAll('.sug')) {
      const mb = [...row.querySelectorAll('.vote-group button')].find((x) => /Muss/.test(x.textContent));
      if (mb.classList.contains('on')) continue;
      mb.click();
      await new Promise((r) => setTimeout(r, 300));
      const t = document.getElementById('toast');
      if (t && t.classList.contains('show') && /Muss rein/.test(t.textContent)) { toast = t.textContent; break; }
    }
    const head = [...document.querySelectorAll('.result-table thead th')].map((x) => x.textContent.trim());
    const cut = !!document.querySelector('.result-table .cut');
    const veto = document.querySelectorAll('.result-table .vchip-veto').length;
    return { on1, on2, toast, head, cut, veto };
  })()`);
  check(/^Gerne/.test(vote.on1 || ''), 'Stimme setzen', vote.on1);
  check(vote.on2 === 'aus', 'nochmal klicken entfernt die Stimme', vote.on2);
  check(/5× „Muss rein“/.test(vote.toast), 'Muss-rein-Budget wird durchgesetzt', vote.toast);
  check(['Nico', 'Lukas', 'Tim', 'Jonas'].every((n) => vote.head.includes(n)), 'Ergebnis-Tabelle hat eine Spalte pro Spieler', vote.head);
  check(vote.cut && vote.veto >= 1, 'Grenzlinie und Veto sichtbar', { cut: vote.cut, veto: vote.veto });
  await b.eval(`(async () => { const f = document.querySelector('details.explain'); if (f) f.open = true; scrollTo(0, 0); await new Promise((r) => setTimeout(r, 300)); })()`);
  await b.shot(SHOTS + 'voting-legend.png');
  await b.eval(`(async () => { document.querySelector('.result-table').scrollIntoView({ block: 'start' }); await new Promise((r) => setTimeout(r, 300)); })()`);
  await b.shot(SHOTS + 'voting-result.png');
  await b.eval(`(async () => { document.querySelector('details.explain').open = false; scrollTo(0, 0); await new Promise((r) => setTimeout(r, 200)); })()`);

  const multi = await b.eval(`(async () => {
    const before = document.querySelectorAll('.sug').length;
    const input = document.querySelector('.suggest-form input') || document.querySelector('input[name=title]');
    input.value = 'Neu A; Neu B; neu a; Rocket League';
    input.form.requestSubmit();
    await new Promise((r) => setTimeout(r, 800));
    return { added: document.querySelectorAll('.sug').length - before, toast: document.getElementById('toast')?.textContent, field: input.value };
  })()`);
  check(multi.added === 2 && multi.field === '', 'mehrere Vorschläge mit Duplikat-Erkennung', multi);
  await b.shot(SHOTS + 'voting-desktop.png');

  // ---------- Overlay ----------
  console.log('\nOverlay');
  await b.eval(setValue(seed.key, `overlay/${seed.nico}/maxHeight`, 300));
  // Spiel Nr. 10 starten, damit es ein aktives Spiel zum Anpinnen gibt
  const activeTitle = await b.eval(`(async () => {
    const { createStore } = await import(new URL('js/store.js', location.href));
    const m = await import(new URL('js/model.js', location.href));
    const s = await createStore({});
    const key = ${JSON.stringify(seed.key)};
    let room = await s.get(m.roomPath(key));
    const A = m.bindActions(s, key, () => room);
    const g = m.sortedGames(room)[9];
    await A.startGame(g.id);
    // ein zu langer Name für die Laufschrift (nicht „Celeste“, das zählt der Duplikat-Check)
    const [long, long2] = m.sortedGames(room).filter((x, i) => i > 10 && x.title !== 'Celeste');
    await A.renameGame(long.id, 'Dangerous Mountain Together (Schneegebiet) 0/1 Hardcore');
    await A.renameGame(long2.id, 'Minecraft (Enderdrache) Hardcore 0/1 ohne Tode');   // zweite, andere Länge
    return g.title;
  })()`);
  await b.goto(`${BASE}overlay.html?room=${seed.key}&player=${seed.nico}`, 1200);
  const ov = await b.eval(`({
    rect: (() => { const r = document.querySelector('.ov').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    titlebar: document.querySelector('.ov-titlebar')?.textContent.trim(),
    foot: document.querySelector('.ov-foot')?.textContent.replace(/\\s+/g, ' ').trim(),
    marquee: (() => {
      const moving = [...document.querySelectorAll('.ov-name.moving')];
      const long = moving.find((e) => /Dangerous/.test(e.textContent));
      const anims = moving.flatMap((e) => e.firstElementChild.getAnimations());
      // Gemeinsame Runde: Keyframes 0 → Halt → Ende (−Strecke) → bleibt am Ende. Tempo = Strecke / Fahrzeit
      const shape = anims.map((a) => {
        const kf = a.effect.getKeyframes();
        const x = (k) => parseFloat(/translateX\\((-?[\\d.]+)(px)?\\)/.exec(k.transform)?.[1] || 0);
        const dist = -x(kf[2]);
        const T = a.effect.getTiming().duration;
        return { T, start: a.startTime, arrive: kf[2].offset, dist,
          speed: Math.round(dist / (T * (kf[2].offset - kf[1].offset)) * 1000),
          waits: kf.length === 4 && x(kf[0]) === 0 && x(kf[3]) === -dist && dist > 0 };
      });
      const speeds = shape.map((v) => v.speed);
      const arrivals = shape.map((v) => v.arrive);
      return { count: moving.length, longMoves: !!long, animated: anims.length > 0, speeds, arrivals,
        sameSpeed: speeds.length > 0 && speeds.every((v) => Math.abs(v - speeds[0]) <= 1),
        together: shape.length > 1 && shape.every((v) => v.T === shape[0].T && v.start === shape[0].start),
        waitForLongest: shape.every((v) => v.waits) && new Set(shape.map((v) => v.dist)).size > 1
          && Math.max(...arrivals) <= 1 - 1900 / shape[0].T,
        shortStill: !document.querySelector('.ov-row.pinned .ov-name.moving') };
    })(),
    bg: getComputedStyle(document.body).backgroundColor,
    pinned: (() => { const p = document.querySelector('.ov-row.pinned'); return p ? { title: p.querySelector('.ov-name').textContent, inTrack: !!p.closest('.ov-track'), label: p.querySelector('.ov-label')?.textContent } : null; })(),
    dup: [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent === 'Celeste').length,
  })`);
  check(ov.rect[0] === 320 && ov.rect[1] === 300, 'Box ist genau Breite × maximale Höhe', ov.rect);
  check(ov.bg === 'rgba(0, 0, 0, 0)', 'Hintergrund transparent', ov.bg);
  check(ov.pinned && ov.pinned.title === activeTitle && !ov.pinned.inTrack, 'aktives Spiel oben angepinnt, scrollt nicht mit', { activeTitle, pinned: ov.pinned });
  check(ov.dup === 2, 'Liste für Endlos-Scroll verdoppelt', ov.dup);
  const y = [];
  for (let i = 0; i < 6; i++) {
    y.push(await b.eval(`(() => { const e = [...document.querySelectorAll('[style*=translate]')][0]; const m = e && /translate3d\\(0px, (-?[\\d.]+)px/.exec(e.style.transform); return m ? +m[1] : 0; })()`));
    await sleep(700);
  }
  check(y[0] === 0 && y[y.length - 1] < -20, 'Auto-Scroll: erst Pause, dann Bewegung', y);
  check(!!ov.titlebar && /^\d+:\d\d:\d\d\s*–\s*läuft$/.test(ov.foot || ''), 'Titelbalken und Gesamtzeit mit Status unten', { titlebar: ov.titlebar, foot: ov.foot });
  check(ov.marquee.longMoves && ov.marquee.animated && ov.marquee.sameSpeed && ov.marquee.together && ov.marquee.waitForLongest && ov.marquee.shortStill,
    'Laufschrift: gleich schnell, gemeinsamer Start, Neustart erst wenn der längste Name durch ist', ov.marquee);
  await b.shot(SHOTS + 'overlay.png', { x: 0, y: 0, width: 360, height: 340 });

  // Overlay eines anderen Spielers: dieselben gemeinsamen Zeiten (Gesamtzeit auf die Sekunde, aktives Spiel)
  const ovState = `({ total: document.querySelector('[data-timer="total"]')?.textContent, pinned: document.querySelector('.ov-row.pinned .ov-name')?.textContent, progress: document.querySelector('.ov-foot')?.textContent.replace(/\\s+/g, ' ').trim() })`;
  const mine = await b.eval(ovState);
  await b.goto(`${BASE}overlay.html?room=${seed.key}&player=${seed.ids[1]}`, 1200);
  const other = await b.eval(ovState);
  const toSec = (s) => (s || '').split(':').reduce((a, v) => a * 60 + Number(v), 0);
  check(other.pinned === mine.pinned && Math.abs(toSec(other.total) - toSec(mine.total)) <= 3, 'anderer Spieler sieht dieselben Zeiten', { mine, other });

  await b.goto(`${BASE}overlay.html`, 1000);
  const missing = await b.eval(`document.body.innerText.trim().slice(0, 80)`);
  check(missing.length > 0, 'Hinweis bei fehlenden Parametern', missing);

  // ---------- Overlay-Editor ----------
  console.log('\nOverlay-Editor');
  await b.eval(setValue(seed.key, `overlay/${seed.nico}`, null));
  await b.goto(BASE + 'overlay-editor.html', 2500);
  const ed = await b.eval(`(async () => {
    const frame = document.querySelector('iframe');
    const w0 = Math.round(frame.getBoundingClientRect().width);
    const range = [...document.querySelectorAll('input[type=range]')].find((r) => +r.min === 200 && +r.max >= 800);
    range.value = 420;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    const color = document.querySelector('input[type=color]');
    color.value = '#ff0000';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    color.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1200));
    const w1 = Math.round(frame.getBoundingClientRect().width);
    const inner = frame.contentDocument?.querySelector('.ov');
    return { w0, w1, innerW: inner ? Math.round(inner.getBoundingClientRect().width) : null, bg: inner ? getComputedStyle(inner).getPropertyValue('--bg') : null, url: document.querySelector('input[readonly]')?.value };
  })()`);
  const stored = await b.eval(`(async () => { const { createStore } = await import(new URL('js/store.js', location.href)); const m = await import(new URL('js/model.js', location.href)); const s = await createStore({}); return s.get(m.roomPath(${JSON.stringify(seed.key)}, 'overlay/${seed.nico}')); })()`);
  check(stored && stored.width === 420 && typeof stored.width === 'number', 'Breite als Zahl gespeichert', stored);
  check(stored && stored.bgColor === '#ff0000', 'Farbe gespeichert', stored);
  check(ed.w1 - ed.w0 === 100 && ed.innerW === 420, 'Vorschau folgt der Breite', ed);
  check(/rgba\(255, 0, 0/.test(ed.bg || ''), 'Vorschau übernimmt die Farbe ohne Neuladen', ed.bg);
  check(/overlay\.html\?room=.+&player=/.test(ed.url || ''), 'OBS-URL angezeigt', ed.url);
  await b.shot(SHOTS + 'editor-desktop.png');

  // ---------- Handy ----------
  console.log('\nHandy (360 px)');
  await b.eval(setValue(seed.key, `players/${seed.nico}/name`, 'Maximilian der Große'));
  for (const p of ['index', 'voting', 'overlay-editor']) {
    await b.resize(360, 780);
    await b.goto(`${BASE}${p}.html`, 1500);
    const r = await b.eval(`({ scroll: document.documentElement.scrollWidth, inner: innerWidth, menuRight: Math.round(document.querySelector('.room-menu summary').getBoundingClientRect().right) })`);
    check(r.scroll === 360 && r.menuRight <= 360, `${p}: kein seitliches Scrollen, Menü sichtbar`, r);
    await b.shot(`${SHOTS}mobile-${p}.png`);
  }

  check(b.logs.length === 0, 'keine JavaScript-Fehler in der Konsole', b.logs);
} catch (e) {
  fails++;
  console.log('\nABBRUCH: ' + (e.stack || e));
} finally {
  await b.close();
  if (server) server.server.close();
}

console.log(fails ? `\n${fails} FEHLER, ${passes} ok` : `\nAlle ${passes} Prüfungen bestanden`);
console.log('Screenshots: ' + SHOTS);
process.exit(fails ? 1 : 0);
