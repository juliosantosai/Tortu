const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { TikTokConnectionManager } = require('./tiktok-connection-manager');

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(directory) {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(directory, 'test.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before starting:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { baseUrl, child };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`Server did not start:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null) child.kill();
}

async function readSseMessages(reader, count) {
  const decoder = new TextDecoder();
  let buffer = '';
  const messages = [];
  while (messages.length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop();
    for (const block of blocks) {
      const data = block.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (data) messages.push(JSON.parse(data));
      if (messages.length === count) break;
    }
  }
  assert.equal(messages.length, count, `Expected ${count} SSE messages`);
  return messages;
}

function createOverlayHarness(html, coordinatorScript, publicId) {
  const iframeTags = [...html.matchAll(/<iframe class="layer ([^"]+)" src="([^"]+)"><\/iframe>/g)];
  const layers = iframeTags.map(([, className, src]) => {
    const vars = {};
    const listeners = {};
    return {
      className,
      src,
      style: {},
      contentDocument: { documentElement: { style: { setProperty: (key, value) => { vars[key] = value; } } } },
      contentWindow: {
        messages: [],
        receiver: null,
        postMessage(message, origin) {
          this.messages.push({ message, origin });
          if (this.receiver) this.receiver(message, origin);
        }
      },
      listeners,
      vars,
      addEventListener(name, callback) { listeners[name] = callback; }
    };
  });
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      elements.set(selector, {
        style: { setProperty() {} },
        classList: { toggle() {} },
        listeners: {},
        setAttribute() {},
        remove() {},
        addEventListener(name, callback) { this.listeners[name] = callback; }
      });
    }
    return elements.get(selector);
  }
  const footer = element('#overlayFooter');
  const eventSources = [];
  const sandbox = {
    Array,
    Map,
    URLSearchParams,
    console,
    innerWidth: 1080,
    innerHeight: 1920,
    location: { pathname: `/overlay/${publicId}`, origin: 'http://localhost' },
    navigator: { serviceWorker: { register: () => Promise.resolve() } },
    document: {
      querySelector(selector) {
        if (selector === '.stage') return element(selector);
        if (selector === '#overlayFooter') return footer;
        if (selector === '.layer') return layers[0];
        const layer = layers.find(item => `.${item.className}` === selector);
        return layer || element(selector);
      },
      querySelectorAll(selector) { return selector === '.layer' ? layers : []; },
      getElementById(id) { return id === 'overlayFooter' ? footer : element(`#${id}`); }
    },
    EventSource: class {
      constructor(url) { this.url = url; eventSources.push(this); }
    },
    TortuSound: {
      hasVoice: () => false,
      isEnabled: () => false,
      isVoiceEnabled: () => false,
      setVoice: () => false,
      onChange: () => {},
      play: () => {}
    },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(coordinatorScript, sandbox);
  vm.runInNewContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], sandbox);
  return { eventSource: eventSources[0], layers, footer };
}

function createOverlayLayerHarness(layerName) {
  const listeners = {};
  const stored = new Map();
  const style = { values: {}, setProperty(key, value) { this.values[key] = value; } };
  const counterValues = [{}, {}];
  const statsContainers = [0, 1].map(() => ({
    children: [],
    style: {},
    appendChild(child) { this.children.push(child); }
  }));
  const wrap = { style };
  const count = { textContent: '' };
  const winnerName = { textContent: '' };
  let winnerVisible = false;
  const banner = {
    classList: {
      toggle(_className, enabled) { winnerVisible = enabled; }
    }
  };
  const crown = { style: {} };
  const racer = {
    style,
    classList: {
      add() {},
      remove() {},
      toggle() {}
    }
  };
  const document = {
    body: { dataset: { team: '1' } },
    createElement() {
      return {
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        querySelector() { return this.value; },
        set innerHTML(_html) {},
        value: { textContent: '' }
      };
    },
    getElementById(id) {
      if (id === 'racer') return racer;
      if (id === 'stats-0') return statsContainers[0];
      if (id === 'stats-1') return statsContainers[1];
      if (id === 'winner-banner') return banner;
      if (id === 'winner-name') return winnerName;
      return null;
    },
    querySelector(selector) {
      if (selector === '.wrap') return wrap;
      if (selector === '.count') return count;
      if (selector === '.honor') return { style: {} };
      if (selector === '.crown') return crown;
      return null;
    },
    querySelectorAll(selector) { return selector === '.stats' ? statsContainers : []; }
  };
  const sandbox = {
    document,
    location: { origin: 'http://localhost' },
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, String(value)); }
    },
    URLSearchParams,
    BroadcastChannel: class {},
    setTimeout,
    clearTimeout,
    addEventListener(name, callback) {
      (listeners[name] ||= []).push(callback);
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.parent = { location: { search: '' } };
  sandbox.top = sandbox.parent;
  const layersDir = path.join(__dirname, '..', 'webserver', 'layers');
  vm.runInNewContext(fs.readFileSync(path.join(layersDir, 'game-core.js'), 'utf8'), sandbox);
  if (layerName === 'stats' || layerName === 'winner') {
    const html = fs.readFileSync(
      path.join(layersDir, layerName === 'stats' ? 'estadisticas-equipos.html' : 'ganador.html'),
      'utf8'
    );
    const inlineScripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
      .map(([, script]) => script.trim()).filter(Boolean);
    assert.ok(inlineScripts.length, 'layer should contain its renderer');
    vm.runInNewContext(inlineScripts[0], sandbox);
    statsContainers.forEach((container, team) => {
      container.children.forEach((chip, index) => {
        const key = ['comment', 'share', 'like', 'gift'][index];
        counterValues[team][key] = chip.querySelector('b');
      });
    });
  } else {
    const script = layerName === 'progress1' ? 'progress-controller.js' : 'turtle-controller.js';
    vm.runInNewContext(fs.readFileSync(path.join(layersDir, script), 'utf8'), sandbox);
  }
  return {
    counters: counterValues[0],
    get winnerName() { return winnerName.textContent; },
    get winnerVisible() { return winnerVisible; },
    dispatch(message, origin) {
      (listeners.message || []).forEach(callback => callback({ data: message, origin }));
    },
    count,
    progressStyle: style,
    racerStyle: racer.style
  };
}

test('TikTok connector events update public overlay counters and turtle progress', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortulive-webserver-'));
  let child;
  let streamReader;
  t.after(async () => {
    if (streamReader) await streamReader.cancel().catch(() => {});
    if (child) await stopServer(child);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const running = await startServer(directory);
  child = running.child;
  const { baseUrl } = running;
  const registrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'webserver-test@example.test',
      password: 'a-secure-test-password',
      overlayName: 'Integration test'
    })
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  const cookie = registrationResponse.headers.get('set-cookie').split(';')[0];

  const presetSpeed = { comment: 2, like: 1, likeTaps: 10, share: 4, follow: 6 };
  const presetResponse = await fetch(`${baseUrl}/api/speed-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Integración', speed: presetSpeed })
  });
  assert.equal(presetResponse.status, 201);
  const { preset } = await presetResponse.json();
  assert.equal(preset.name, 'Integración');
  assert.deepEqual(preset.speed, presetSpeed);
  const presetsResponse = await fetch(`${baseUrl}/api/speed-presets`, {
    headers: { Cookie: cookie }
  });
  assert.deepEqual((await presetsResponse.json()).presets.map(item => item.id), [preset.id]);
  const deletePresetResponse = await fetch(`${baseUrl}/api/speed-presets/${preset.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  });
  assert.equal(deletePresetResponse.status, 200);

  const overlayResponse = await fetch(`${baseUrl}/overlay/${registration.overlay.publicId}`);
  assert.equal(overlayResponse.status, 200);
  const overlayHtml = await overlayResponse.text();
  const coordinatorScript = fs.readFileSync(path.join(__dirname, '..', 'webserver', 'overlay-coordinator.js'), 'utf8');
  const harness = createOverlayHarness(overlayHtml, coordinatorScript, registration.overlay.publicId);
  const statsLayer = createOverlayLayerHarness('stats');
  const progressLayer = createOverlayLayerHarness('progress1');
  const turtleLayer = createOverlayLayerHarness('turtle1');
  const winnerLayer = createOverlayLayerHarness('winner');
  for (const [className, layerHarness] of [
    ['estadisticas', statsLayer],
    ['progreso1', progressLayer],
    ['tortuga1', turtleLayer],
    ['ganador', winnerLayer]
  ]) {
    harness.layers.find(layer => layer.className === className).contentWindow.receiver =
      (message, origin) => layerHarness.dispatch(message, origin);
  }
  assert.equal(harness.layers.length, 19);
  assert.equal(harness.eventSource.url, `/api/public/${registration.overlay.publicId}/stream`);

  const streamResponse = await fetch(`${baseUrl}${harness.eventSource.url}`);
  assert.equal(streamResponse.status, 200);
  streamReader = streamResponse.body.getReader();
  const [snapshot] = await readSseMessages(streamReader, 1);
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.state.race.authority, 'server');
  assert.deepEqual(snapshot.connectionStatus, { username: null, status: 'disconnected' });
  harness.eventSource.onmessage({ data: JSON.stringify(snapshot) });
  for (const layer of harness.layers) {
    assert.ok(layer.contentWindow.messages.some(({ message }) =>
      message.message?.type === 'snapshot' &&
      message.message?.state?.race?.authority === 'server'));
  }
  for (const className of ['bandera1', 'bandera2', 'estadisticas', 'don', 'contadores', 'eventos',
    'agradecimiento', 'progreso1', 'progreso2']) {
    assert.equal(harness.layers.find(layer => layer.className === className).style.display, 'block');
  }

  const displaySettings = {
    flags: false,
    donTortu: false,
    teamEvents: false,
    honor: false,
    progressBar: false
  };
  const settingsResponse = await fetch(`${baseUrl}/api/overlays/${registration.overlay.id}/display-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ settings: displaySettings })
  });
  assert.equal(settingsResponse.status, 200);
  const [settingsMessage] = await readSseMessages(streamReader, 1);
  assert.equal(settingsMessage.type, 'display_settings');
  harness.eventSource.onmessage({ data: JSON.stringify(settingsMessage) });
  for (const [setting, classNames] of Object.entries({
    flags: ['bandera1', 'bandera2'],
    donTortu: ['don'],
    teamEvents: ['contadores', 'eventos', 'estadisticas'],
    honor: ['agradecimiento'],
    progressBar: ['progreso1', 'progreso2']
  })) {
    for (const className of classNames) {
      assert.equal(harness.layers.find(layer => layer.className === className).style.display, 'none');
    }
  }
  assert.equal(harness.layers[0].vars['--ext'], '124px');
  assert.equal(harness.layers[0].vars['--hdr'], '67px');

  const connectorEvent = new EventEmitter();
  connectorEvent.connect = async () => { connectorEvent.emit('connected'); };
  connectorEvent.disconnect = async () => {};
  let ingestResult;
  const connectorManager = new TikTokConnectionManager({
    saveStatus: () => {},
    connectorFactory: async () => connectorEvent,
    onEvent: async (_userId, event) => {
      const response = await fetch(`${baseUrl}/api/overlays/${registration.overlay.id}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${registration.apiToken}`
        },
        body: JSON.stringify(event)
      });
      ingestResult = { status: response.status, body: await response.json() };
    }
  });
  await connectorManager.connectUser('test-user', { id: 'test-account', username: 'tortuga' });
  await new Promise(setImmediate);
  connectorEvent.emit('chat', {
    user: {
      nickname: 'Ana',
      uniqueId: 'ana123',
      avatarThumb: { urlList: ['https://example.test/ana.jpg'] }
    },
    comment: 'Vamos Olimpia',
    common: { msgId: 'integration-comment-1' }
  });
  const [eventMessage, raceMessage] = await readSseMessages(streamReader, 2);
  while (!ingestResult) await new Promise(setImmediate);
  assert.equal(ingestResult.status, 202);
  assert.equal(ingestResult.body.accepted, true);
  assert.equal(eventMessage.type, 'event');
  assert.equal(eventMessage.event, 'comment');
  assert.equal(eventMessage.sequence, 1);
  assert.equal(eventMessage.teamId, '1');
  assert.equal(eventMessage.message, 'Vamos Olimpia');
  assert.equal(raceMessage.type, 'race');
  assert.equal(raceMessage.state.race.authority, 'server');
  assert.equal(raceMessage.state.teams['1'].meters, 1);
  harness.eventSource.onmessage({ data: JSON.stringify(eventMessage) });
  harness.eventSource.onmessage({ data: JSON.stringify(raceMessage) });
  assert.equal(statsLayer.counters.comment.textContent, '1');
  assert.equal(progressLayer.count.textContent, '1/100');
  assert.equal(progressLayer.progressStyle.values['--pct'], '1.0%');
  assert.equal(turtleLayer.racerStyle.values['--p'], 0.01);
  assert.equal(winnerLayer.winnerVisible, false);

  const lateLayer = harness.layers.find(layer => layer.className === 'tortuga1');
  lateLayer.listeners.load();
  const lateMessages = lateLayer.contentWindow.messages.map(entry => entry.message.message?.type);
  assert.ok(lateMessages.includes('snapshot'), 'late layers receive the latest snapshot');
  assert.ok(lateMessages.includes('race'), 'late layers receive the latest race state');

  ingestResult = null;
  connectorEvent.emit('gift', {
    user: {
      nickname: 'Ana',
      uniqueId: 'ana123'
    },
    giftDetails: { giftName: 'Rosa', giftType: 0 },
    repeatCount: 1,
    repeatEnd: true,
    common: { msgId: 'integration-gift-1' }
  });
  const [giftMessage, finishedRaceMessage] = await readSseMessages(streamReader, 2);
  while (!ingestResult) await new Promise(setImmediate);
  assert.equal(ingestResult.status, 202);
  assert.equal(giftMessage.event, 'gift');
  assert.equal(finishedRaceMessage.state.race.status, 'finished');
  assert.equal(finishedRaceMessage.state.race.winnerTeam, '1');
  assert.equal(finishedRaceMessage.state.teams['1'].meters, 100);
  harness.eventSource.onmessage({ data: JSON.stringify(giftMessage) });
  harness.eventSource.onmessage({ data: JSON.stringify(finishedRaceMessage) });
  assert.equal(statsLayer.counters.gift.textContent, '1');
  assert.equal(progressLayer.count.textContent, '100/100');
  assert.equal(turtleLayer.racerStyle.values['--p'], 1);
  assert.equal(winnerLayer.winnerVisible, true);
  assert.equal(winnerLayer.winnerName, 'OLIMPIA');
  const lateStatsLayer = createOverlayLayerHarness('stats');
  lateStatsLayer.dispatch({
    channel: 'tortulive',
    message: { type: 'snapshot', state: finishedRaceMessage.state }
  }, 'http://localhost');
  assert.equal(lateStatsLayer.counters.comment.textContent, '1');
  assert.equal(lateStatsLayer.counters.gift.textContent, '1');
  const finishedAt = Date.now();
  await connectorManager.stopAll();

  const [countersResetMessage, resetRaceMessage] = await readSseMessages(streamReader, 2);
  assert.ok(Date.now() - finishedAt >= 2_500, 'winner should remain visible for about three seconds');
  assert.equal(countersResetMessage.type, 'counters_reset');
  assert.equal(resetRaceMessage.type, 'race');
  assert.equal(resetRaceMessage.state.race.status, 'idle');
  assert.equal(resetRaceMessage.state.race.winnerTeam, null);
  assert.equal(resetRaceMessage.state.teams['1'].meters, 0);
  assert.equal(resetRaceMessage.state.teams['1'].cups, 1);
  harness.eventSource.onmessage({ data: JSON.stringify(countersResetMessage) });
  harness.eventSource.onmessage({ data: JSON.stringify(resetRaceMessage) });
  assert.equal(winnerLayer.winnerVisible, false);
  assert.equal(statsLayer.counters.comment.textContent, '0');
  assert.equal(statsLayer.counters.gift.textContent, '0');
  assert.equal(progressLayer.count.textContent, '0/100');
  assert.equal(turtleLayer.racerStyle.values['--p'], 0);

  const historyResponse = await fetch(
    `${baseUrl}/api/overlays/${registration.overlay.id}/events?limit=10`,
    { headers: { Cookie: cookie } }
  );
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.events.length, 2);
  const commentHistoryEvent = history.events.find(event => event.event === 'comment');
  assert.equal(commentHistoryEvent.message, 'Vamos Olimpia');
  assert.equal(commentHistoryEvent.sequence, eventMessage.sequence);

  for (const layer of harness.layers) {
    const delivered = layer.contentWindow.messages.map(entry => entry.message.message?.type);
    assert.ok(delivered.includes('event'), `${layer.className} did not receive the event`);
    assert.ok(delivered.includes('race'), `${layer.className} did not receive the race update`);
    const layerResponse = await fetch(`${baseUrl}${layer.src}`);
    assert.equal(layerResponse.status, 200, `${layer.src} should be served`);
  }
  assert.ok(harness.layers.find(layer => layer.className === 'eventos')
    .contentWindow.messages.some(entry => entry.message.message?.event === 'comment'));
  assert.ok(harness.layers.find(layer => layer.className === 'eventos')
    .contentWindow.messages.some(entry => entry.message.message?.event === 'gift'));
  for (const className of ['tortuga1', 'pista', 'estadisticas', 'progreso1', 'ganador']) {
    assert.ok(harness.layers.find(layer => layer.className === className)
      .contentWindow.messages.some(entry => entry.message.message?.type === 'race'));
  }
});
