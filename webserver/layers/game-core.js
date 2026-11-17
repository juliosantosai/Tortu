/*
 * Tortulive · núcleo de gamificación compartido por las capas.
 * - Normaliza el estado que llega por postMessage a:
 *     { teams: [{ name, flag, p (0..1), count, cups }, {...}], winner: -1|0|1 }
 * - Modo demo (?demo=1 en la URL del overlay): carrera simulada y determinista,
 *   igual en todas las capas porque depende solo del reloj.
 * Uso:  TortuGame.onState(function (s) { ... });
 */
(function () {
  'use strict';
  var GOAL = 100;
  var CUPS_KEY = 'tortulive.cups.v1';
  var SEQ_KEY = 'tortulive.cups.seq';

  function topSearch() {
    try { return window.parent.location.search; } catch (e) { /* otro origen */ }
    try { return window.top.location.search; } catch (e) { return ''; }
  }
  var params = new URLSearchParams(topSearch());
  var DEMO = params.has('demo');

  function readCups() {
    try {
      var v = JSON.parse(localStorage.getItem(CUPS_KEY) || '[0,0]');
      return [Math.max(0, v[0] | 0), Math.max(0, v[1] | 0)];
    } catch (e) { return [0, 0]; }
  }
  function writeCups(c) { try { localStorage.setItem(CUPS_KEY, JSON.stringify(c)); } catch (e) { /* sin storage */ } }

  var state = {
    teams: [
      { name: 'OLIMPIA', flag: null, p: 0, count: 0, cups: readCups()[0] },
      { name: 'CERRO', flag: null, p: 0, count: 0, cups: readCups()[1] }
    ],
    race: { status: 'idle', matchStartedAt: null, inactivitySecondsRemaining: 60, finishReason: null },
    winner: -1
  };
  var FLAGS_KEY = 'tortulive.flags';
  function applyFlagNames() {
    if (!localRules) return;
    var f = [null, null];
    try { f = JSON.parse(localStorage.getItem(FLAGS_KEY) || '[null,null]'); } catch (e) { /* */ }
    for (var i = 0; i < 2; i++) if (f[i] && f[i].n) state.teams[i].name = f[i].n;
  }
  applyFlagNames();
  window.addEventListener('storage', function (e) { if (e.key === FLAGS_KEY) { applyFlagNames(); emit(); } });
  var listeners = [];
  var lastJson = '';

  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function pick(o, keys) {
    if (!o || typeof o !== 'object') return null;
    for (var i = 0; i < keys.length; i++) if (o[keys[i]] != null) return o[keys[i]];
    return null;
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function emit() {
    var json = JSON.stringify(state);
    if (json === lastJson) return;
    lastJson = json;
    listeners.forEach(function (cb) { try { cb(state); } catch (e) { console.error(e); } });
  }


  /* ---- Velocidad de la tortuga: metros que avanza por cada evento ----
   * Configurable desde el dashboard (settings.speed). Mínimo 1 metro por evento. La meta es GOAL (100 m).
   * Por defecto: comentario 1 m, 15 taps (likes) = 1 m, compartir 3 m, seguir 10 m.
   * El REGALO no suma metros: la capa regalos.html lo coreografía y, cuando la tortuga gigante llega, avisa (fx 'arrive')
   * y ese equipo llega a la meta de golpe (reachGoal). */
  var SPEED_KEY = 'tortulive.speed', METERS_KEY = 'tortulive.meters.v1';
  var SPEED_DEFAULT = { comment: 1, like: 1, likeTaps: 15, share: 3, follow: 10 };
  function sanitizeSpeed(o) {
    var r = {};
    Object.keys(SPEED_DEFAULT).forEach(function (k) {
      var v = Math.floor(Number(o && o[k]));
      r[k] = isFinite(v) && v >= 1 ? Math.min(v, 1000) : SPEED_DEFAULT[k];
    });
    return r;
  }
  function loadSpeed() { try { return sanitizeSpeed(JSON.parse(localStorage.getItem(SPEED_KEY) || 'null')); } catch (e) { return sanitizeSpeed(null); } }
  var speed = loadSpeed();
  function setSpeed(o) { speed = sanitizeSpeed(o); try { localStorage.setItem(SPEED_KEY, JSON.stringify(speed)); } catch (e) { /* */ } }
  window.addEventListener('storage', function (e) { if (e.key === SPEED_KEY) speed = loadSpeed(); });

  // Las reglas locales solo se usan en previsualizaciones sin estado autoritativo.
  var localRules = true;
  var meters = [0, 0], taps = [0, 0], mSeq = 0;
  (function () {
    try {
      var v = JSON.parse(localStorage.getItem(METERS_KEY) || 'null');
      if (v) { meters = [v.m[0] | 0, v.m[1] | 0]; taps = [v.t[0] | 0, v.t[1] | 0]; mSeq = v.s | 0; }
    } catch (e) { /* */ }
  })();
  function saveMeters() { try { localStorage.setItem(METERS_KEY, JSON.stringify({ m: meters, t: taps, s: mSeq })); } catch (e) { /* */ } }
  function syncTeam(i) {
    meters[i] = Math.max(0, Math.min(GOAL, meters[i]));
    state.teams[i].count = meters[i]; state.teams[i].p = meters[i] / GOAL;
  }
  function addMeters(i, m) {
    if (!localRules || !(m > 0) || state.winner > -1) return;                       // la carrera terminó: no avanza más hasta el reinicio
    meters[i] += m; syncTeam(i);
    if (meters[i] >= GOAL) state.winner = i;                           // llegó a la meta (100 m)
    saveMeters();
  }
  if (!DEMO) { syncTeam(0); syncTeam(1); if (meters[0] >= GOAL) state.winner = 0; else if (meters[1] >= GOAL) state.winner = 1; }
  // Regalo: el equipo llega a la meta (100 m) y gana, salvo que la carrera ya haya terminado.
  function reachGoal(i) {
    if (!localRules || DEMO || !(i === 0 || i === 1) || state.winner > -1) return false;
    meters[i] = GOAL; syncTeam(i); state.winner = i; saveMeters();
    return true;
  }
  function resetMeters() { meters = [0, 0]; taps = [0, 0]; syncTeam(0); syncTeam(1); saveMeters(); }
  // Metros que suma un evento (ya con el equipo del usuario resuelto).
  function applyEventMeters(kind, team, n) {
    if (kind === 'comment') addMeters(team, speed.comment);
    else if (kind === 'share') addMeters(team, speed.share);
    else if (kind === 'follow') addMeters(team, speed.follow);
    else if (kind === 'like') {                                          // cada "likeTaps" taps = "like" metros
      taps[team] += n;
      var steps = Math.floor(taps[team] / speed.likeTaps);
      if (steps > 0) { taps[team] -= steps * speed.likeTaps; addMeters(team, steps * speed.like); }
      else saveMeters();
    }
  }
  // El servidor solo puede ADELANTAR el progreso (nunca lo borra); el reinicio lo hace el evento reset.
  function raiseProgress(i, p) {
    p = clamp01(p);
    if (!localRules) {
      state.teams[i].p = p;
      state.teams[i].count = Math.round(p * GOAL);
      meters[i] = state.teams[i].count;
    } else if (DEMO || p > state.teams[i].p) {
      state.teams[i].p = p;
      state.teams[i].count = Math.round(p * GOAL);
      meters[i] = Math.max(meters[i], state.teams[i].count);
    }
  }

  function applyTeam(i, src) {
    if (src == null) return;
    var t = state.teams[i];
    if (typeof src !== 'object') { var n0 = num(src); if (n0 != null) raiseProgress(i, n0 / GOAL); return; }
    var name = pick(src, ['name', 'nombre', 'team', 'label']);
    if (typeof name === 'string' && name.trim()) t.name = name.trim().slice(0, 14).toUpperCase();
    if (Object.prototype.hasOwnProperty.call(src, 'flag')) t.flag = typeof src.flag === 'string' ? src.flag : null;
    var count = num(pick(src, ['count', 'points', 'puntos', 'score', 'value', 'total']));
    if (count != null) raiseProgress(i, count / GOAL);
    var prog = num(pick(src, ['p', 'progress', 'progreso', 'pct', 'percent', 'ratio']));
    if (prog != null) raiseProgress(i, prog > 1 ? prog / 100 : prog);
    var mt = num(pick(src, ['meters', 'metros', 'distance', 'distancia']));
    if (mt != null) raiseProgress(i, mt / GOAL);                    // la API manda METROS (0..maxMeters)
    var cups = num(pick(src, ['cups', 'copas', 'wins', 'victorias', 'trophies', 'trofeos']));
    if (cups != null) { t.cups = Math.max(0, cups | 0); var c = readCups(); c[i] = t.cups; writeCups(c); }
    var eventCounts = pick(src, ['eventCounts']);
    if (eventCounts && typeof eventCounts === 'object') {
      KINDS.forEach(function (kind) {
        var count = Number(eventCounts[kind]);
        totals[i][kind] = Number.isSafeInteger(count) && count >= 0 ? count : 0;
      });
    }
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    var race = s.race && typeof s.race === 'object' ? s.race : null;
    if (race && race.authority === 'server') localRules = false;
    if (race && race.authority === 'server') state.winner = teamIndex(race.winnerTeam);
    if (race) state.race = Object.assign({}, state.race, race);
    setTimeout(applyFlagNames, 0);
    var teams = pick(s, ['teams', 'equipos']);
    if (Array.isArray(teams)) { applyTeam(0, teams[0]); applyTeam(1, teams[1]); }
    else if (teams && typeof teams === 'object') { applyTeam(0, teams[1] != null ? teams[1] : teams.team1); applyTeam(1, teams[2] != null ? teams[2] : teams.team2); }
    applyTeam(0, pick(s, ['team1', 'equipo1', 'teamOne', 'left']));
    applyTeam(1, pick(s, ['team2', 'equipo2', 'teamTwo', 'right']));
    var progress = pick(s, ['progress', 'progreso']);
    if (Array.isArray(progress)) { applyTeam(0, { p: progress[0] }); applyTeam(1, { p: progress[1] }); }
    var cups = pick(s, ['cups', 'copas', 'wins']);
    if (Array.isArray(cups)) { applyTeam(0, { cups: cups[0] }); applyTeam(1, { cups: cups[1] }); }
    var w = pick(s, ['winner', 'ganador', 'winnerTeam']);
    if (w == null && race && race.winnerTeam != null) w = race.winnerTeam;          // snapshot de la API: race.winnerTeam "1"|"2"|null
    if (w != null) { var wi = teamIndex(w); if (wi > -1 || !(meters[0] >= GOAL || meters[1] >= GOAL)) state.winner = wi; }
    notifyStats();
  }

  function teamIndex(v) {
    if (v === 1 || v === '1' || v === 'team1') return 0;
    if (v === 2 || v === '2' || v === 'team2') return 1;
    if (typeof v === 'string') {
      var u = v.toUpperCase();
      if (u === state.teams[0].name) return 0;
      if (u === state.teams[1].name) return 1;
    }
    return -1;
  }


  /* ---- Usuarios -> equipo, y estadísticas por equipo (comentarios, compartidos, likes, regalos) ----
   * Regla: cada usuario está en UN solo equipo. Equipo inicial = el que traiga el evento (team/equipo...) o uno estable
   * por nombre. Si en un comentario escribe (en cualquier parte del texto, aunque con pequeñas faltas) el nombre de un
   * equipo, ese pasa a ser su equipo: se le quitan sus puntos al anterior y se suman al nuevo, sin duplicarlos. */
  var KINDS = ['comment', 'share', 'like', 'gift'];
  var users = {}, totals = emptyTotals(), statCbs = [], switchCbs = [], evSeq = 0;
  function emptyTotals() { return [{ comment: 0, share: 0, like: 0, gift: 0 }, { comment: 0, share: 0, like: 0, gift: 0 }]; }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function lev(a, b) {
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // Parecido (0..1) entre el texto y el nombre del equipo: coincide una palabra del nombre en cualquier parte del texto.
  function score(text, name) {
    var words = norm(name).split(' ').filter(function (w) { return w.length >= 3 && w !== 'club' && w !== 'futbol'; });
    var toks = text.split(' '), best = 0;
    words.forEach(function (n) {
      if (n.length >= 4 && text.indexOf(n) > -1) { best = 1; return; }          // incluida, incluso pegada: "vamoscerro"
      toks.forEach(function (w) {
        if (w === n) { best = 1; return; }
        if (w.length < 4 || n.length < 4) return;
        var d = lev(w, n), sim = 1 - d / Math.max(w.length, n.length);
        if (d <= (n.length >= 7 ? 2 : 1) && sim >= .7) best = Math.max(best, sim);
      });
    });
    return best;
  }
  function chooseTeam(text) {
    var t = norm(text), a = score(t, state.teams[0].name), b = score(t, state.teams[1].name);
    if (a >= .7 && a > b) return 0;
    if (b >= .7 && b > a) return 1;
    return -1;                                                                  // ninguno o ambos por igual: no es una elección válida
  }
  function hashTeam(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) % 2; }
  function keyOf(raw) { return String(raw).replace(/^@/, '').toLowerCase(); }
  function notifyStats() { statCbs.forEach(function (cb) { try { cb(totals); } catch (e) { console.error(e); } }); }
  function moveUser(u, to, raw, avatar) {
    var from = u.team; if (from === to) return;
    KINDS.forEach(function (k) { totals[from][k] -= u[k]; totals[to][k] += u[k]; });
    u.team = to;
    switchCbs.forEach(function (cb) { try { cb({ user: raw, from: from, to: to, avatar: avatar }); } catch (e) { console.error(e); } });
  }
  function resetUsers() { users = {}; totals = emptyTotals(); notifyStats(); }
  function processEvent(m) {
    var sq = num(m.sequence);
    if (sq != null && sq > 0) { if (sq <= evSeq) return; evSeq = sq; }
    var kind = m.event, raw = pick(m, ['user', 'username', 'nickname', 'uniqueId', 'name']);
    if (!kind || kind === 'reset' || kind === 'winner' || raw == null || raw === '') return;
    var identity = pick(m, ['username', 'uniqueId']) || raw;
    var key = keyOf(identity), avatar = pick(m, ['avatar', 'avatarUrl', 'profilePictureUrl', 'profilePicture', 'picture', 'image', 'photo']);
    var explicit = teamIndex(pick(m, ['teamId', 'team', 'equipo', 'side', 'teamIndex']));
    var u = users[key];
    if (!u) users[key] = u = { team: explicit > -1 ? explicit : hashTeam(key), chosen: false, comment: 0, share: 0, like: 0, gift: 0 };
    else if (explicit > -1 && (!localRules || !u.chosen)) moveUser(u, explicit, raw, avatar);
    if (localRules && kind === 'comment') {
      var txt = pick(m, ['comment', 'text', 'message', 'content', 'msg']);
      var t = txt != null ? chooseTeam(txt) : -1;
      if (t > -1) { u.chosen = true; moveUser(u, t, raw, avatar); }            // la última elección válida reemplaza la anterior
    }
    if (KINDS.indexOf(kind) > -1) {
      var n = num(pick(m, ['count', 'likeCount', 'likes', 'amount', 'quantity', 'repeatCount']));
      n = n > 0 ? Math.floor(n) : 1;
      if (kind === 'comment' || kind === 'share') n = 1;
      u[kind] += n; totals[u.team][kind] += n;
    }
    // Avance de la tortuga (una sola vez por evento; sin demo).
    if (!DEMO && (kind === 'comment' || kind === 'share' || kind === 'like' || kind === 'follow')) {
      var fresh = true;
      if (sq != null && sq > 0) { fresh = sq > mSeq; if (fresh) mSeq = sq; }
      if (fresh) {
        var nn = num(pick(m, ['count', 'likeCount', 'likes', 'amount', 'quantity', 'repeatCount']));
        nn = nn > 0 ? Math.floor(nn) : 1;
        if (kind === 'comment' || kind === 'share' || kind === 'follow') nn = 1;
        applyEventMeters(kind, u.team, nn);
      }
    }
    notifyStats();
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    var sp = msg.type === 'snapshot' ? (msg.state && msg.state.speed)
      : msg.type === 'speed_settings' ? msg.speed : null;
    if (sp) setSpeed(sp);
    if (msg.type === 'event') processEvent(msg);
    if (msg.type === 'snapshot') {
      applyState(msg.state);
    } else if (msg.type === 'state' || msg.type === 'race' || msg.type === 'progress') {
      applyState(msg.state || msg);
    } else if (msg.type === 'counters_reset' || (msg.type === 'event' && msg.event === 'reset')) {
      state.teams.forEach(function (t) { t.p = 0; t.count = 0; });
      state.winner = -1; resetMeters(); resetUsers();
    } else if (localRules && msg.type === 'event' && msg.event === 'winner') {
      var idx = teamIndex(pick(msg, ['team', 'winnerTeam', 'teamId', 'winner', 'equipo']));
      if (idx > -1) {
        state.winner = idx;
        // Una sola suma por evento aunque haya varias capas escuchando.
        var seq = num(msg.sequence);
        var last = 0;
        try { last = Number(localStorage.getItem(SEQ_KEY) || 0); } catch (e) { /* */ }
        if (seq == null || seq > last) {
          try { if (seq != null) localStorage.setItem(SEQ_KEY, String(seq)); } catch (e) { /* */ }
          var c = readCups(); c[idx] += 1; writeCups(c); state.teams[idx].cups = c[idx];
        }
      }
    }
    emit();
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.channel === 'tortulive-fx') {                          // órdenes de regalos.html a todas las capas
      if (event.data.fx === 'arrive' && reachGoal(event.data.team)) emit();
      return;
    }
    if (event.data.channel !== 'tortulive') return;
    onMessage(event.data.message);
  });
  // Si otra capa/panel cambia las copas, se refleja aquí.
  window.addEventListener('storage', function (e) {
    if (e.key !== CUPS_KEY) return;
    var c = readCups(); state.teams[0].cups = c[0]; state.teams[1].cups = c[1]; emit();
  });

  /* ---- Demo determinista ---- */
  function demoTick() {
    var CYCLE = 70;
    var now = Date.now() / 1000;
    var cyc = Math.floor(now / CYCLE);
    var cc = cyc % 40; // copas de la demo: números pequeños
    var t = now - cyc * CYCLE;
    var p1 = clamp01(Math.floor(t / 2.6) / 21);
    var p2 = clamp01(Math.floor((t + 1.3) / 2.9 - 0.4) / 19);
    var leader = p1 >= p2 ? 0 : 1;
    var done = p1 >= 1 || p2 >= 1;
    var winner = done ? (p1 >= 1 ? 0 : 1) : -1;
    state.teams[0].p = p1; state.teams[0].count = Math.round(p1 * GOAL);
    state.teams[1].p = p2; state.teams[1].count = Math.round(p2 * GOAL);
    state.teams[0].cups = 3 + Math.ceil(cc / 2) + (winner === 0 ? 1 : 0);
    state.teams[1].cups = 2 + Math.floor(cc / 2) + (winner === 1 ? 1 : 0);
    state.winner = winner;
    state.leader = leader;
    emit();
  }
  if (DEMO) { demoTick(); setInterval(demoTick, 400); }

  /* ---- Escenario de fondo (0 = madera original, 1..10 escenarios) ---- */
  var SCENE_KEY = 'tortulive.scene';
  var scene = 0, sceneListeners = [];
  function setScene(n) {
    n = parseInt(n, 10);
    if (!(n >= 0 && n <= 10)) n = 0;
    if (n === scene) return;
    scene = n; sceneListeners.forEach(function (cb) { cb(scene); });
  }
  (function () {
    var q = params.get('fondo');
    var saved = '0';
    try { saved = localStorage.getItem(SCENE_KEY) || '0'; } catch (e) { /* */ }
    var n0 = parseInt(q !== null && q !== '' ? q : saved, 10);
    scene = n0 >= 0 && n0 <= 5 ? n0 : 0;
    window.addEventListener('storage', function (e) { if (e.key === SCENE_KEY) setScene(e.newValue); });
    try { new BroadcastChannel('tortulive-scene').onmessage = function (e) { setScene(e.data && e.data.scene); }; } catch (e) { /* */ }
    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin || !event.data || event.data.channel !== 'tortulive') return;
      var m = event.data.message;
      if (m && m.type === 'scene') setScene(m.scene);
    });
  })();

  window.TortuGame = {
    userTeam: function (name) { var u = users[keyOf(name)]; return u ? u.team : -1; },
    assign: function (name, team) { var k = keyOf(name), u = users[k] || (users[k] = { team: team, chosen: true, comment: 0, share: 0, like: 0, gift: 0 }); u.chosen = true; moveUser(u, team, name); notifyStats(); },
    stats: function () { return totals; },
    onStats: function (cb) { statCbs.push(cb); cb(totals); },
    onSwitch: function (cb) { switchCbs.push(cb); },
    onScene: function (cb) { sceneListeners.push(cb); cb(scene); },
    GOAL: GOAL,
    speed: function () { return speed; },
    setSpeed: setSpeed,
    meters: function () { return meters.slice(); },
    reachGoal: function (i) { if (reachGoal(i)) emit(); },
    demo: DEMO,
    params: params,
    get: function () { return state; },
    onState: function (cb) { listeners.push(cb); cb(state); }
  };
})();
