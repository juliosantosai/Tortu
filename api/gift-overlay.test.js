const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('server-authoritative gifts animate the turtle to the finish before the race resets', async () => {
  const messages = [];
  let now = 0;
  let timerId = 0;
  function element() {
    return {
      style: {},
      appendChild() {},
      animate() { return {}; },
      remove() {}
    };
  }
  const board = element();
  const sandbox = {
    document: {
      documentElement: {},
      getElementById: () => board,
      createElement: element
    },
    location: { origin: 'http://localhost' },
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      now += 5_000;
      callback(now);
    },
    setTimeout(callback) {
      const id = ++timerId;
      queueMicrotask(callback);
      return id;
    },
    clearTimeout() {},
    TortuGame: {
      get: () => ({
        race: { authority: 'server' },
        teams: [{ p: 0.2 }, { p: 0.1 }]
      }),
      userTeam: () => -1
    },
    addEventListener() {},
    window: {}
  };
  sandbox.window = sandbox;
  sandbox.parent = {
    length: 1,
    frames: [{
      postMessage(message) { messages.push(message); }
    }]
  };

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'webserver', 'layers', 'regalos.html'),
    'utf8'
  );
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, source]) => source.trim()).find(Boolean);
  assert.ok(script, 'gift layer should contain its animation');
  vm.runInNewContext(script, sandbox);

  sandbox.TortuRegalos.handle({
    event: 'gift',
    teamId: '2',
    user: 'Ana',
    avatar: 'https://example.test/ana.jpg',
    count: 1
  });
  for (let attempt = 0; attempt < 10 && !messages.some(message => message.fx === 'end'); attempt++) {
    await new Promise(setImmediate);
  }

  const run = messages.find(message => message.fx === 'run');
  assert.ok(run, 'gift should make the turtle run to the goal');
  assert.equal(run.team, 1);
  assert.equal(run.pEnd, 1);
  assert.equal(run.duration, 2600);
  assert.ok(messages.some(message => message.fx === 'eat'));
  assert.ok(messages.some(message => message.fx === 'arrive'));
  assert.ok(messages.some(message => message.fx === 'end' && message.quick));
});
