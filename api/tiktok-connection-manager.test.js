const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  BROWSER_HEARTBEAT_TIMEOUT_MS,
  RETRY_INTERVAL_MS,
  RETRY_WINDOW_MS,
  TikTokConnectionManager,
  getAvatarUrl,
  getViewerCount
} = require('./tiktok-connection-manager');

function createHarness(connectBehaviors) {
  let now = Date.now();
  let timerId = 0;
  const timers = new Map();
  const statuses = [];
  const forwardedEvents = [];
  const audienceUpdates = [];
  const connections = [];
  let disconnectCount = 0;
  const manager = new TikTokConnectionManager({
    now: () => now,
    setTimer: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    saveStatus: (_userId, status) => statuses.push(status),
    onStatus: () => {},
    onAudience: async (_userId, viewers) => audienceUpdates.push(viewers),
    onEvent: async (_userId, event) => forwardedEvents.push(event),
    connectorFactory: async username => {
      const connection = new EventEmitter();
      connection.username = username;
      connection.connect = async () => {
        const behavior = connectBehaviors.shift();
        if (behavior) await behavior(connection);
      };
      connection.disconnect = async () => { disconnectCount += 1; };
      connections.push(connection);
      return connection;
    }
  });
  return {
    connections,
    audienceUpdates,
    get disconnectCount() { return disconnectCount; },
    forwardedEvents,
    manager,
    statuses,
    timers,
    advance: milliseconds => { now += milliseconds; },
    runTimer: delay => {
      const found = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(found, `Expected a timer with delay ${delay}`);
      timers.delete(found[0]);
      found[1].callback();
    }
  };
}

test('retries every five seconds, connects successfully, and forwards TikTok events', async () => {
  const harness = createHarness([
    async () => { throw new Error('not live yet'); },
    async connection => connection.emit('connected')
  ]);
  await harness.manager.connectUser('user-1', { id: 'account-1', username: 'tortuga' });
  await new Promise(setImmediate);

  assert.equal(harness.statuses.at(-1).status, 'retrying');
  assert.ok(Math.abs(Date.parse(harness.statuses.at(-1).nextRetryAt) - Date.now() - RETRY_INTERVAL_MS) < 100);
  harness.runTimer(RETRY_INTERVAL_MS);
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(harness.statuses.at(-1).status, 'connected');
  harness.connections[1].emit('chat', {
    user: {
      nickname: 'Ana',
      uniqueId: 'ana123',
      avatarThumb: { urlList: ['https://example.test/ana.jpg'] }
    },
    comment: 'Hola'
  });
  await new Promise(setImmediate);
  assert.equal(harness.forwardedEvents[0].event, 'comment');
  assert.equal(harness.forwardedEvents[0].message, 'Hola');
  assert.equal(harness.forwardedEvents[0].user, 'Ana');
  assert.equal(harness.forwardedEvents[0].username, 'ana123');
  assert.equal(harness.forwardedEvents[0].avatar, 'https://example.test/ana.jpg');
  harness.connections[1].emit('roomUser', { viewerCount: 123 });
  await new Promise(setImmediate);
  assert.deepEqual(harness.audienceUpdates, [123]);
  harness.connections[1].emit('disconnected', { reason: 'ended' });
  await new Promise(setImmediate);
  assert.deepEqual(harness.audienceUpdates, [123, null]);
});

test('profile changes cancel the prior retry loop', async () => {
  const harness = createHarness([
    async () => { throw new Error('offline'); },
    async connection => connection.emit('connected')
  ]);
  await harness.manager.connectUser('user-1', { id: 'account-1', username: 'primero' });
  await new Promise(setImmediate);
  await harness.manager.connectUser('user-1', { id: 'account-2', username: 'segundo' });
  await new Promise(setImmediate);

  assert.equal(harness.connections.length, 2);
  assert.equal(harness.statuses.at(-1).username, 'segundo');
  assert.equal(harness.statuses.at(-1).status, 'connected');
  assert.equal(harness.timers.size, 0);
});

test('stops retrying and reports expired after five minutes', async () => {
  const harness = createHarness([async () => { throw new Error('offline'); }]);
  await harness.manager.connectUser('user-1', { id: 'account-1', username: 'tortuga' });
  await new Promise(setImmediate);
  harness.advance(RETRY_WINDOW_MS);
  harness.runTimer(RETRY_WINDOW_MS);

  assert.equal(harness.statuses.at(-1).status, 'expired');
  assert.equal(harness.timers.size, 0);
});

test('reads audience counts and avatars from TikTok room metadata variants', () => {
  assert.equal(getViewerCount({ viewer_count: '42' }), 42);
  assert.equal(getViewerCount({ totalUser: '4398' }), 4398);
  assert.equal(getViewerCount({ total_user: '27' }), 27);
  assert.equal(getViewerCount({ data: { stats: { user_count: 21 } } }), 21);
  assert.equal(getViewerCount({ viewerCount: null, viewer_count: 12 }), 12);
  assert.equal(getViewerCount({ viewerCount: -1 }), null);
  assert.equal(getAvatarUrl({
    owner: { avatar_thumb: { url_list: ['https://example.test/avatar.jpg'] } }
  }), 'https://example.test/avatar.jpg');
});

test('refreshes saved account live state and avatar without starting a stream connection', async () => {
  const updates = [];
  const manager = new TikTokConnectionManager({
    saveStatus: () => {},
    onEvent: async () => {},
    onProfileUpdate: (account, avatarUrl) => updates.push([account.id, avatarUrl]),
    connectorFactory: async () => ({
      fetchIsLive: async () => true,
      fetchRoomInfo: async () => ({
        owner: { avatar_large: { url_list: ['https://example.test/profile.jpg'] } }
      }),
      disconnect: async () => {}
    })
  });
  const [status] = await manager.refreshAccountStatuses([
    { id: 'account-1', username: 'tortuga', user_id: 'user-1', avatar_url: null }
  ]);
  assert.equal(status.live, true);
  assert.equal(status.avatarUrl, 'https://example.test/profile.jpg');
  assert.deepEqual(updates, [['account-1', 'https://example.test/profile.jpg']]);
});

test('disconnects TikTok after dashboard heartbeats stop and reconnects when the browser returns', async () => {
  const harness = createHarness([
    async connection => connection.emit('connected'),
    async connection => connection.emit('connected')
  ]);
  const account = { id: 'account-1', username: 'tortuga' };
  harness.manager.reportBrowserHeartbeat('user-1', account);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(harness.statuses.at(-1).status, 'connected');

  harness.advance(BROWSER_HEARTBEAT_TIMEOUT_MS);
  harness.runTimer(BROWSER_HEARTBEAT_TIMEOUT_MS);
  await new Promise(setImmediate);
  assert.equal(harness.statuses.at(-1).status, 'disconnected');
  assert.equal(harness.disconnectCount, 1);
  assert.equal(harness.manager.hasActiveConnection('user-1'), false);

  harness.manager.reportBrowserHeartbeat('user-1', account);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(harness.statuses.at(-1).status, 'connected');
  assert.equal(harness.connections.length, 2);
});

test('repeated dashboard heartbeats keep the selected TikTok connector monitored', async () => {
  const harness = createHarness([
    async connection => connection.emit('connected')
  ]);
  const account = { id: 'account-1', username: 'tortuga' };
  harness.manager.reportBrowserHeartbeat('user-1', account);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(harness.statuses.at(-1).status, 'connected');

  harness.advance(20_000);
  harness.manager.reportBrowserHeartbeat('user-1', account);
  harness.advance(20_000);
  harness.manager.reportBrowserHeartbeat('user-1', account);
  harness.advance(20_000);
  harness.runTimer(BROWSER_HEARTBEAT_TIMEOUT_MS);
  await new Promise(setImmediate);

  assert.equal(harness.statuses.at(-1).status, 'connected');
  assert.equal(harness.manager.hasActiveConnection('user-1'), true);
  assert.equal(harness.disconnectCount, 0);
  await harness.manager.stopAll();
});

test('switches the monitored TikTok profile when a live dashboard heartbeat reports another selection', async () => {
  const harness = createHarness([
    async connection => connection.emit('connected'),
    async connection => connection.emit('connected')
  ]);
  harness.manager.reportBrowserHeartbeat('user-1', { id: 'account-1', username: 'primero' });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  harness.manager.reportBrowserHeartbeat('user-1', { id: 'account-2', username: 'segundo' });
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(harness.connections.length, 2);
  assert.equal(harness.statuses.at(-1).username, 'segundo');
  assert.equal(harness.statuses.at(-1).status, 'connected');
  assert.equal(harness.disconnectCount, 1);
});
