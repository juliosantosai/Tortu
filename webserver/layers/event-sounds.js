(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Sonido gamificado + voz en off alegre (Web Audio + Web Speech API).
  // - Cada evento da XP; hay niveles, combos y hitos por usuario con fanfarrias.
  // - Todos los comentarios se leen en voz alta con una voz femenina en español.
  // ---------------------------------------------------------------------------

  var context = null;
  var master = null;
  var enabled = false;
  var voiceEnabled = true;
  var lastPlayedAt = 0;
  var MAX_SOUND_RATE_MS = 90;
  var NORMAL_GAIN = 0.55;
  var DUCKED_GAIN = 0.2;

  // ---- Gamificación ----
  var XP_PER_EVENT = { comment: 1, like: 1, share: 5, follow: 10, join: 2, gift: 20 };
  var COMBO_WINDOW_MS = 4000;
  var COMBO_MILESTONES = { 5: 1, 10: 1, 20: 1, 35: 1, 50: 1, 100: 1 };
  var USER_MILESTONES = [10, 25, 50, 100, 250];
  var PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  var game = { xp: 0, level: 1, combo: 0, bestCombo: 0, lastEventAt: 0, users: {}, userCount: 0 };
  var listeners = [];

  // ---- Voz ----
  var synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  var voice = null;
  var queue = [];
  var speaking = false;
  var MAX_QUEUE = 8;
  var MAX_COMMENT_CHARS = 160;
  var FEMALE_RE = /female|mujer|helena|sabina|paulina|monica|laura|elena|lucia|mia\b|sofia|paloma|dalia|elvira|salome|camila|valentina|marisol|elsa|catalina|renata|google espa/i;
  var MALE_RE = /\bmale\b|jorge|diego|juan|carlos|pablo|raul|alvaro|enrique|miguel|tomas|alonso|gonzalo/i;

  // ---------------- Audio ----------------
  function startTone(frequency, offset, duration, volume, endFrequency, type) {
    var when = context.currentTime + offset;
    var oscillator = context.createOscillator();
    var envelope = context.createGain();
    oscillator.type = type || 'triangle';
    oscillator.frequency.setValueAtTime(frequency, when);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration);
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.01);
  }

  function duck(on) {
    if (!master || !context) return;
    master.gain.setTargetAtTime(on ? DUCKED_GAIN : NORMAL_GAIN, context.currentTime, 0.05);
  }

  function baseTones(kind, amount) {
    if (kind === 'comment') {
      startTone(620, 0, 0.11, 0.12);
    } else if (kind === 'join') {
      startTone(392, 0, 0.13, 0.1);
      startTone(523, 0.09, 0.13, 0.1);
      startTone(659, 0.18, 0.18, 0.11);
    } else if (kind === 'share') {
      startTone(520, 0, 0.2, 0.1, 880);
      startTone(784, 0.16, 0.12, 0.08);
    } else if (kind === 'follow') {
      startTone(659, 0, 0.12, 0.09);
      startTone(880, 0.08, 0.12, 0.09);
      startTone(1175, 0.16, 0.17, 0.1);
    } else if (kind === 'like') {
      var pitch = 480 + Math.min(amount, 100) * 3;
      startTone(pitch, 0, 0.1, 0.09);
      if (amount >= 15) startTone(pitch * 1.25, 0.07, 0.13, 0.08);
      if (amount >= 50) startTone(pitch * 1.5, 0.14, 0.16, 0.08);
    } else if (kind === 'gift') {
      startTone(523, 0, 0.17, 0.1);
      startTone(659, 0.1, 0.17, 0.1);
      startTone(784, 0.2, 0.2, 0.11);
      if (amount >= 5) startTone(1047, 0.3, 0.22, 0.1);
    }
  }

  // Cada evento del combo sube una nota de la escala pentatonica (suena "bien" siempre).
  function comboPing() {
    if (game.combo < 3) return;
    var step = PENTATONIC[Math.min(game.combo - 3, PENTATONIC.length - 1)];
    startTone(523.25 * Math.pow(2, step / 12), 0.2, 0.09, 0.05, null, 'sine');
  }

  function levelUpFanfare() {
    var notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach(function (f, i) { startTone(f, i * 0.09, 0.2, 0.11, null, 'square'); });
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { startTone(f, 0.42, 0.6, 0.07, null, 'triangle'); });
  }

  function comboFanfare() {
    startTone(784, 0, 0.1, 0.1, null, 'square');
    startTone(988, 0.08, 0.1, 0.1, null, 'square');
    startTone(1319, 0.16, 0.28, 0.11, null, 'square');
  }

  function milestoneSparkle() {
    [1319, 1568, 1976, 2349].forEach(function (f, i) { startTone(f, i * 0.06, 0.12, 0.06, null, 'sine'); });
  }

  // ---------------- Gamificacion ----------------
  function levelFloor(level) { return 25 * (level - 1) * (level - 1); }
  function levelOf(xp) { return 1 + Math.floor(Math.sqrt(xp / 25)); }

  function snapshot() {
    var floor = levelFloor(game.level), next = levelFloor(game.level + 1);
    return { level: game.level, xp: game.xp, xpIntoLevel: game.xp - floor, xpForNext: next - floor,
      combo: game.combo, bestCombo: game.bestCombo };
  }

  function notify() {
    var s = snapshot();
    listeners.forEach(function (fn) { try { fn(s); } catch (e) { /* un oyente roto no debe frenar el sonido */ } });
  }

  function userKey(name) { return String(name || '').replace(/^@/, '').toLowerCase().slice(0, 80); }

  // Devuelve lo que ocurrio para decidir que sonidos extra reproducir.
  function gamify(kind, amount, meta) {
    var now = Date.now();
    var out = { leveledUp: false, comboMilestone: 0, userMilestone: 0, firstTime: false };
    var delta = Math.max(1, Number(meta.delta) || (kind === 'like' || kind === 'gift' ? amount : 1));
    var gained = (XP_PER_EVENT[kind] || 1) * delta;
    game.xp += gained;

    if (!meta.bump) {
      game.combo = (now - game.lastEventAt <= COMBO_WINDOW_MS) ? game.combo + 1 : 1;
      game.bestCombo = Math.max(game.bestCombo, game.combo);
      if (COMBO_MILESTONES[game.combo]) out.comboMilestone = game.combo;

      var key = userKey(meta.user);
      if (key) {
        if (game.userCount > 2000) { game.users = {}; game.userCount = 0; }
        var u = game.users[key];
        if (!u) { u = game.users[key] = { n: 0 }; game.userCount++; out.firstTime = true; }
        u.n++;
        if (USER_MILESTONES.indexOf(u.n) > -1) out.userMilestone = u.n;
      }
    }
    game.lastEventAt = now;

    var level = levelOf(game.xp);
    if (level > game.level) { game.level = level; out.leveledUp = true; }
    notify();
    return out;
  }

  // ---------------- Voz en off ----------------
  function scoreVoice(v) {
    var s = 0, lang = String(v.lang || '').replace('_', '-');
    if (!/^es(-|$)/i.test(lang)) return -100;
    if (/^es-(US|MX|419|AR|PY|CO|UY|CL)/i.test(lang)) s += 3; else if (/^es-ES/i.test(lang)) s += 1;
    if (FEMALE_RE.test(v.name)) s += 6;
    if (MALE_RE.test(v.name) && !/female/i.test(v.name)) s -= 12;
    if (/natural|neural|online/i.test(v.name)) s += 2;
    return s;
  }

  function refreshVoice() {
    if (!synth) return;
    var best = null, bestScore = -Infinity;
    (synth.getVoices() || []).forEach(function (v) {
      var s = scoreVoice(v);
      if (s > bestScore) { best = v; bestScore = s; }
    });
    voice = bestScore > -100 ? best : null;
  }

  if (synth) {
    refreshVoice();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoice);
    else synth.onvoiceschanged = refreshVoice;
  }

  function cleanText(text, maxLen) {
    var s = String(text == null ? '' : text);
    s = s.replace(/https?:\/\/\S+|www\.\S+/gi, ' enlace ');
    s = s.replace(/[\u0000-\u001f\u007f]/g, ' ');
    s = s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, ' ');
    s = s.replace(/(.)\1{3,}/g, '$1$1$1');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '') + '...';
    return s;
  }

  function cleanName(name) {
    return cleanText(String(name || '').replace(/^@/, '').replace(/[_.]+/g, ' ').replace(/\d{3,}/g, ''), 24);
  }

  function pump() {
    if (speaking || !queue.length || !synth) return;
    var item = queue.shift();
    var utterance = new SpeechSynthesisUtterance(item.text);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else { utterance.lang = 'es-419'; }
    utterance.pitch = 1.25;                                              // tono agudo y alegre
    utterance.rate = Math.min(1.5, (item.priority ? 1.05 : 1.08) + queue.length * 0.08); // acelera si hay cola
    utterance.volume = 1;
    var finished = false, guard = null;
    function done() {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      speaking = false;
      duck(queue.length > 0);
      pump();
    }
    utterance.onend = done;
    utterance.onerror = done;
    guard = setTimeout(function () { try { synth.cancel(); } catch (e) { /* nada */ } done(); }, 12000);
    speaking = true;
    duck(true);
    try { synth.speak(utterance); } catch (e) { done(); }
  }

  function say(text, priority) {
    if (!synth || !enabled || !voiceEnabled || !text) return;
    var item = { text: text, priority: !!priority };
    if (priority) {
      var i = 0; while (i < queue.length && queue[i].priority) i++;
      queue.splice(i, 0, item);                                          // anuncios van antes que comentarios
    } else {
      if (queue.length >= MAX_QUEUE) { for (var k = 0; k < queue.length; k++) if (!queue[k].priority) { queue.splice(k, 1); break; } }
      queue.push(item);
    }
    pump();
  }

  // Formato: "<apodo de TikTok>, del equipo <equipo>, dice: <comentario>".
  function speakComment(user, team, text) {
    var body = cleanText(text, MAX_COMMENT_CHARS);
    if (!body) return;
    var name = cleanName(user) || 'Un espectador';
    var teamName = cleanText(team, 24).toLowerCase();
    say(name + (teamName ? ', del equipo ' + teamName + ',' : '') + ' dice: ' + body, false);
  }

  // ---------------- API publica ----------------
  function enable() {
    var AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return Promise.reject(new Error('Este navegador no admite audio Web Audio.'));
    if (!context) {
      context = new AudioContextType();
      master = context.createGain();
      master.gain.value = NORMAL_GAIN;
      master.connect(context.destination);
    }
    return context.resume().then(function () {
      enabled = true;
      refreshVoice();
      notify();
      return true;
    });
  }

  function disable() {
    enabled = false;
    queue = [];
    speaking = false;
    if (synth) { try { synth.cancel(); } catch (e) { /* nada */ } }
    duck(false);
    return false;
  }

  function setVoice(on) {
    voiceEnabled = !!on;
    if (!voiceEnabled) {
      queue = [];
      if (synth) { try { synth.cancel(); } catch (e) { /* nada */ } }
      duck(false);
    }
    return voiceEnabled;
  }

  function play(kind, count, meta) {
    if (!enabled || !context || context.state !== 'running') return;
    meta = meta || {};
    var amount = Math.max(1, Number(count) || 1);
    var result = gamify(kind, amount, meta);
    var now = Date.now();

    if (now - lastPlayedAt >= MAX_SOUND_RATE_MS) {
      lastPlayedAt = now;
      baseTones(kind, amount);
      comboPing();
      if (result.leveledUp) levelUpFanfare();
      else if (result.comboMilestone) comboFanfare();
      else if (result.userMilestone) milestoneSparkle();
    }

    // La voz solo lee comentarios; los logros (nivel, combo, hitos) suenan sin hablar.
    if (kind === 'comment' && meta.text) speakComment(meta.user, meta.team, meta.text);
  }

  window.TortuSound = {
    enable: enable,
    disable: disable,
    play: play,
    setVoice: setVoice,
    isEnabled: function () { return enabled; },
    isVoiceEnabled: function () { return voiceEnabled; },
    hasVoice: function () { return !!synth; },
    getStats: snapshot,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };
})();
