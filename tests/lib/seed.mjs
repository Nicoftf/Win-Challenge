// Legt im lokalen Modus einen Test-Raum an: 4 Spieler, 22 Vorschläge mit Stimmen,
// übernommenes Ergebnis (15 Spiele), Zeiten für "Nico" (3 gewonnen, Spiel 7 läuft) und "Lukas".
// Wird als Ausdruck im Browser ausgeführt (auf einer Seite der App, damit die Module geladen werden können).
export const SEED = `(async () => {
  const { createStore } = await import(new URL('js/store.js', location.href));
  const m = await import(new URL('js/model.js', location.href));
  const store = await createStore({});
  const key = m.generateRoomKey();
  let room = null;
  const refresh = async () => { room = await store.get(m.roomPath(key)); };
  await store.set(m.roomPath(key, 'meta'), { name: 'Win-Challenge Test', createdAt: store.now() });
  await store.set(m.roomPath(key, 'voting/settings'), m.VOTING_DEFAULTS);
  await refresh();
  const A = m.bindActions(store, key, () => room);
  const ids = [];
  for (const n of ['Nico', 'Lukas', 'Tim', 'Jonas']) { ids.push(await A.addPlayer(n)); await refresh(); }
  const titles = ['Rocket League','Mario Kart 8','Tetris 99','Fall Guys','Super Smash Bros.','Minecraft Speedrun','Geometry Dash','Celeste','Hollow Knight','Cuphead','Among Us','Valorant','Counter-Strike 2','Fortnite','Overwatch 2','Brawlhalla','Getting Over It','Only Up!','Pummel Party','Golf With Your Friends','Chess.com Blitz','GeoGuessr'];
  for (const [i, t] of titles.entries()) { await A.addSuggestion(t, ids[i % 4]); await refresh(); }
  const sugg = m.sortedSuggestions(room);
  const pattern = ['must','yes','meh','no','yes','must','yes','meh','no','yes','yes'];
  for (const [pi, pid] of ids.entries()) {
    let must = 0;
    for (const [si, s] of sugg.entries()) {
      let v = pattern[(si * (pi + 1) + pi) % pattern.length];
      if (v === 'must' && must >= 5) v = 'yes';
      if (v === 'must') must++;
      if (pi === 1 && si === 3) v = 'veto';
      if (pi === 3 && si % 5 === 4) continue;
      await store.set(m.roomPath(key, 'voting/votes/' + pid + '/' + s.id), v);
    }
  }
  await refresh();
  await A.applyVotingResult(); await refresh();
  const games = m.sortedGames(room);
  const now = store.now();
  const nico = ids[0];
  for (let i = 0; i < 3; i++) await store.set(m.roomPath(key, 'runs/' + nico + '/games/' + games[i].id), { elapsed: 600000 + i * 137000, startedAt: null, done: true, doneAt: now });
  await store.set(m.roomPath(key, 'runs/' + nico + '/games/' + games[6].id), { elapsed: 125000, startedAt: now, done: false, doneAt: null });
  await store.set(m.roomPath(key, 'runs/' + nico + '/activeGame'), games[6].id);
  await store.set(m.roomPath(key, 'runs/' + nico + '/total'), { elapsed: 2500000, startedAt: now, finished: false });
  for (let i = 0; i < 5; i++) await store.set(m.roomPath(key, 'runs/' + ids[1] + '/games/' + games[i].id), { elapsed: 400000 + i * 91000, startedAt: null, done: true, doneAt: now });
  await store.set(m.roomPath(key, 'runs/' + ids[1] + '/total'), { elapsed: 3200000, startedAt: null, finished: false });
  localStorage.setItem('wc.room', key);
  localStorage.setItem('wc.player', nico);
  return { key, nico, ids, games: games.length };
})()`;

/** Ausdruck, der einen Wert im Raum setzt (z.B. Overlay-Einstellung) */
export const setValue = (key, path, value) => `(async () => {
  const { createStore } = await import(new URL('js/store.js', location.href));
  const m = await import(new URL('js/model.js', location.href));
  const s = await createStore({});
  await s.set(m.roomPath(${JSON.stringify(key)}, ${JSON.stringify(path)}), ${JSON.stringify(value)});
})()`;
