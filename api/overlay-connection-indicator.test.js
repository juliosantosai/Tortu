const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness() {
  const badge = {
    textContent: '?',
    className: 'connection-badge disconnected',
    title: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  let eventSource;
  const sandbox = {
    Array,
    Map,
    console,
    document: {
      getElementById(id) { return id === 'connectionBadge' ? badge : null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    EventSource: class {
      constructor(url) {
        this.url = url;
        eventSource = this;
      }
    },
    location: { origin: 'http://localhost' }
  };
  sandbox.window = sandbox;
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'webserver', 'overlay-coordinator.js'),
    'utf8'
  );
  vm.runInNewContext(script, sandbox);
  sandbox.TortuOverlayCoordinator.start({ publicId: '0123456789abcdef01234567', layers: [] });
  return {
    badge,
    send(message) { eventSource.onmessage({ data: JSON.stringify(message) }); }
  };
}

test('overlay badge displays the connected username initial and live connection colors', () => {
  const harness = createHarness();

  harness.send({
    type: 'snapshot',
    connectionStatus: { username: 'ana_lu', status: 'connected' },
    state: {}
  });
  assert.equal(harness.badge.textContent, 'A');
  assert.equal(harness.badge.className, 'connection-badge connected');
  assert.equal(harness.badge.title, '@ana_lu · Conectado');
  assert.equal(harness.badge.attributes['aria-label'], '@ana_lu · Conectado');

  harness.send({
    type: 'connection_status',
    status: { username: 'ana_lu', status: 'retrying' }
  });
  assert.equal(harness.badge.className, 'connection-badge retrying');
  assert.equal(harness.badge.title, '@ana_lu · Reintentando');

  harness.send({
    type: 'connection_status',
    status: { username: 'ana_lu', status: 'disconnected' }
  });
  assert.equal(harness.badge.className, 'connection-badge disconnected');
  assert.equal(harness.badge.title, '@ana_lu · Desconectado');
});

test('overlay badge uses yellow while connecting and red without a username', () => {
  const harness = createHarness();

  harness.send({ type: 'snapshot', connectionStatus: { username: 'tortu', status: 'connecting' }, state: {} });
  assert.equal(harness.badge.className, 'connection-badge retrying');
  assert.equal(harness.badge.textContent, 'T');

  harness.send({ type: 'connection_status', status: { username: null, status: 'expired' } });
  assert.equal(harness.badge.className, 'connection-badge disconnected');
  assert.equal(harness.badge.textContent, '?');
});
