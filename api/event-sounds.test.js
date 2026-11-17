const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createSoundHarness(voices) {
  const spoken = [];
  let resumeCount = 0;
  const speechSynthesis = {
    getVoices: () => voices || [{ name: 'Google español', lang: 'es-US' }],
    speak: utterance => {
      spoken.push(utterance);
      queueMicrotask(() => { if (utterance.onend) utterance.onend(); });
    },
    cancel() {},
    resume() { resumeCount += 1; return Promise.resolve(); }
  };
  class SpeechSynthesisUtterance {
    constructor(text) { this.text = text; }
  }
  const sandbox = {
    SpeechSynthesisUtterance,
    setTimeout: () => 1,
    clearTimeout() {},
    window: {
      speechSynthesis,
      addEventListener() {}
    },
    console
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'webserver', 'layers', 'event-sounds.js'), 'utf8'),
    sandbox
  );
  return { sound: sandbox.window.TortuSound, spoken, get resumeCount() { return resumeCount; } };
}

function createEventLayerHarness(sound) {
  const messages = [];
  function createElement() {
    return {
      classList: { add() {}, remove() {}, toggle() {} },
      style: { setProperty() {} },
      appendChild() {},
      insertAdjacentHTML() {},
      remove() {},
      offsetWidth: 44,
      isConnected: true
    };
  }
  const lanes = [createElement(), createElement()];
  const origin = 'http://localhost';
  const sandbox = {
    document: {
      documentElement: {},
      getElementById: id => id === 'lane-0' ? lanes[0] : lanes[1],
      createElement
    },
    location: { origin },
    getComputedStyle: element => ({
      getPropertyValue: key => key === '--ext' ? '0' : element.className?.includes('comment') ? '#5bd6ff' : ''
    }),
    setTimeout: () => 1,
    clearTimeout() {},
    TortuGame: {
      demo: false,
      userTeam: () => -1,
      get: () => ({ teams: [{ name: 'OLIMPIA' }, { name: 'CERRO' }] }),
      onSwitch() {}
    },
    addEventListener() {},
    window: {}
  };
  sandbox.window = sandbox;
  sandbox.parent = {
    postMessage(message, targetOrigin) {
      messages.push(message);
      if (targetOrigin === origin) {
        sound.play(message.kind, message.count, {
          user: message.user,
          team: message.team,
          text: message.text,
          delta: message.delta,
          bump: message.bump
        });
      }
    }
  };
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'webserver', 'layers', 'eventos-ruta.html'),
    'utf8'
  );
  const inlineScript = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, script]) => script.trim()).find(Boolean);
  assert.ok(inlineScript, 'event layer should contain its event handler');
  vm.runInNewContext(inlineScript, sandbox);
  return { messages, eventos: sandbox.TortuEventos };
}

test('voiceover reads comment text while sound effects are muted', () => {
  const { sound, spoken } = createSoundHarness();
  assert.equal(sound.isEnabled(), false);

  sound.play('comment', 1, {
    user: 'Ana',
    team: 'OLIMPIA',
    text: 'Vamos equipo'
  });

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Ana, del equipo olimpia, dice: Vamos equipo');
  assert.equal(spoken[0].lang, 'es-US');
});

test('overlay comment events pass their text from the event layer to speech synthesis', () => {
  const { sound, spoken } = createSoundHarness();
  const layer = createEventLayerHarness(sound);

  layer.eventos.handle({
    event: 'comment',
    user: 'Ana',
    teamId: '1',
    message: 'Vamos Tortulive'
  });

  assert.equal(layer.messages.length, 1);
  assert.equal(layer.messages[0].channel, 'tortulive-sound');
  assert.equal(layer.messages[0].text, 'Vamos Tortulive');
  assert.equal(spoken[0].text, 'Ana, del equipo olimpia, dice: Vamos Tortulive');
});

test('voiceover respects the voice mute toggle', () => {
  const { sound, spoken } = createSoundHarness();
  sound.setVoice(false);

  sound.play('comment', 1, { user: 'Ana', text: 'Vamos equipo' });

  assert.equal(spoken.length, 0);
});

test('voiceover uses the available browser voice and can be unlocked by a user gesture', async () => {
  const harness = createSoundHarness([
    { name: 'Default system voice', lang: 'en-US', default: true }
  ]);
  harness.sound.unlockVoice();
  await Promise.resolve();
  harness.sound.play('comment', 1, { user: 'Ana', text: 'Hola equipo' });

  assert.ok(harness.resumeCount >= 1);
  assert.equal(harness.spoken.length, 1);
  assert.equal(harness.spoken[0].voice.name, 'Default system voice');
  assert.equal(harness.spoken[0].lang, 'en-US');
});

test('voice test speaks directly and turns the voiceover on even when it was muted', async () => {
  const harness = createSoundHarness();
  harness.sound.setVoice(false);

  await harness.sound.testVoice();

  assert.equal(harness.sound.isVoiceEnabled(), true);
  assert.equal(harness.spoken.length, 1);
  assert.match(harness.spoken[0].text, /Prueba de voz/);
});
