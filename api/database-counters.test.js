const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function withIsolatedDatabase(prefix, script) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    execFileSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: path.join(directory, 'test.sqlite') },
      stdio: 'pipe'
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('event counters reset independently from the persistent gift total', () => {
  withIsolatedDatabase('tortulive-counters-', `
    const assert = require('node:assert/strict');
    const db = require('./api/database');
    const user = db.createUser('counter-test@example.test', 'salt', 'hash');
    const overlay = db.createOverlay(user.id, 'Counter test', 'hash');
    const account = db.addTikTokAccount(user.id, 'tortuga');
    db.setTikTokAccountAvatar(user.id, account.id, 'https://example.test/profile.jpg');
    assert.equal(db.getTikTokAccountHistory(user.id)[0].avatar_url, 'https://example.test/profile.jpg');
    const settings = { flags: false, donTortu: true, teamEvents: false, honor: true, progressBar: false };
    assert.deepEqual(db.updateOverlayDisplaySettings(overlay.id, settings).displaySettings, settings);
    const gift = { type: 'event', event: 'gift', platformEventId: 'gift-1', count: 4 };
    db.logEvent(overlay.id, gift);
    db.logEvent(overlay.id, gift);
    db.logEvent(overlay.id, { type: 'event', event: 'comment', user: 'Ana' });
    let summary = db.getOverlayEventSummary(overlay.id);
    assert.equal(summary.counts.gift, 1);
    assert.equal(summary.counts.comment, 1);
    assert.equal(summary.lifetimeGiftCount, 4);

    db.resetOverlayEventCounters(overlay.id);
    summary = db.getOverlayEventSummary(overlay.id);
    assert.equal(summary.total, 0);
    assert.equal(summary.lifetimeGiftCount, 4);
    assert.equal(db.getOverlayEvents(overlay.id).length, 2);

    db.logEvent(overlay.id, { type: 'event', event: 'gift', count: 2 });
    summary = db.getOverlayEventSummary(overlay.id);
    assert.equal(summary.counts.gift, 1);
    assert.equal(summary.lifetimeGiftCount, 6);

    assert.equal(db.resetLifetimeGifts(overlay.id), 1);
    assert.equal(db.getOverlayEventSummary(overlay.id).lifetimeGiftCount, 0);
    assert.equal(db.getOverlayEvents(overlay.id).length, 3);

    db.saveOverlayAudience(overlay.id, 100);
    db.saveOverlayAudience(overlay.id, 50);
    summary = db.getOverlayEventSummary(overlay.id);
    assert.deepEqual(summary.audience, {
      current: 50,
      peak: 100,
      average: 75,
      samples: 2,
      updatedAt: summary.audience.updatedAt
    });

    db.resetOverlayEventCounters(overlay.id);
    summary = db.getOverlayEventSummary(overlay.id);
    assert.equal(summary.audience.current, 50);
    assert.equal(summary.audience.peak, 50);
    assert.equal(summary.audience.average, 50);

    db.clearOverlayEvents(overlay.id);
    summary = db.getOverlayEventSummary(overlay.id);
    assert.equal(summary.total, 0);
    assert.equal(summary.lifetimeGiftCount, 0);
  `);
});

test('saved TikTok default persists, can be changed, and deleting it clears selection and status', () => {
  withIsolatedDatabase('tortulive-tiktok-accounts-', `
    const assert = require('node:assert/strict');
    const { execFileSync } = require('node:child_process');
    const db = require('./api/database');
    const user = db.createUser('tiktok-account-test@example.test', 'salt', 'hash');
    const first = db.addTikTokAccount(user.id, 'primero');
    const second = db.addTikTokAccount(user.id, 'segundo');
    assert.equal(db.getSelectedTikTokAccount(user.id).id, second.id);

    db.selectTikTokAccount(user.id, first.id);
    const persisted = execFileSync(process.execPath, ['-e',
      'process.stdout.write(JSON.stringify(require("./api/database").getSelectedTikTokAccount(process.argv[1])))',
      user.id
    ], { encoding: 'utf8', env: process.env });
    assert.equal(JSON.parse(persisted).id, first.id);
    assert.equal(db.getTikTokAccountHistory(user.id).find(account => account.id === first.id).selected, 1);
    assert.equal(db.getTikTokAccountHistory(user.id).find(account => account.id === second.id).selected, 0);

    db.saveTikTokConnectionStatus(user.id, {
      accountId: first.id, username: first.username, status: 'connected', attempt: 1
    });
    assert.equal(db.deleteTikTokAccount(user.id, '00000000-0000-4000-8000-000000000000'), false);
    assert.equal(db.deleteTikTokAccount(user.id, first.id), true);
    assert.equal(db.getSelectedTikTokAccount(user.id), null);
    assert.equal(db.getTikTokConnectionStatus(user.id), null);
    assert.deepEqual(db.getTikTokAccountHistory(user.id).map(account => account.id), [second.id]);
  `);
});

test('a persisted TikTok default connects by username and saves connector status', () => {
  withIsolatedDatabase('tortulive-tiktok-connect-', `
    (async () => {
      const assert = require('node:assert/strict');
      const { EventEmitter } = require('node:events');
      const db = require('./api/database');
      const { TikTokConnectionManager } = require('./api/tiktok-connection-manager');
      const user = db.createUser('tiktok-connect-test@example.test', 'salt', 'hash');
      db.addTikTokAccount(user.id, 'tortuga_default');
      let connectedUsername = null;
      const manager = new TikTokConnectionManager({
        saveStatus: db.saveTikTokConnectionStatus,
        onEvent: async () => {},
        connectorFactory: async username => {
          connectedUsername = username;
          const connection = new EventEmitter();
          connection.connect = async () => connection.emit('connected');
          connection.disconnect = async () => {};
          return connection;
        }
      });

      manager.reportBrowserHeartbeat(user.id, db.getSelectedTikTokAccount(user.id));
      await new Promise(setImmediate);
      await new Promise(setImmediate);
      assert.equal(connectedUsername, 'tortuga_default');
      assert.equal(db.getTikTokConnectionStatus(user.id).status, 'connected');
      await manager.stopAll();
    })().catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  `);
});

test('race events persist server authority, team switches, speed, and winner state', () => {
  withIsolatedDatabase('tortulive-race-', `
    const assert = require('node:assert/strict');
    const db = require('./api/database');
    const user = db.createUser('race-test@example.test', 'salt', 'hash');
    const overlay = db.createOverlay(user.id, 'Race test', 'hash');
    const initial = db.getOverlayState(overlay.id);
    assert.equal(initial.race.authority, 'server');
    assert.equal(initial.speed.likeTaps, 15);

    let result = db.logEvent(overlay.id, {
      type: 'event', event: 'comment', user: 'Viewer', username: 'viewer',
      message: 'Vamos Cerro', teamId: '1', platformEventId: 'comment-1'
    });
    assert.equal(result.payload.teamId, '2');
    assert.equal(result.state.teams['2'].meters, 1);
    assert.equal(result.state.teams['1'].meters, 0);

    db.logEvent(overlay.id, {
      type: 'event', event: 'like', user: 'Viewer', username: 'viewer',
      count: 15, platformEventId: 'like-1'
    });
    let state = db.getOverlayState(overlay.id);
    assert.equal(state.teams['2'].meters, 2);
    assert.equal(state.teams['2'].eventCounts.like, 15);

    result = db.logEvent(overlay.id, {
      type: 'event', event: 'comment', user: 'Viewer', username: 'viewer',
      message: 'Arriba Olimpia', platformEventId: 'comment-2'
    });
    assert.equal(result.payload.teamId, '1');
    assert.equal(result.payload.previousTeamId, '2');
    assert.equal(result.payload.teamChanged, true);
    assert.equal(result.state.teams['2'].eventCounts.like, 0);
    assert.equal(result.state.teams['1'].eventCounts.like, 15);
    assert.equal(result.state.teams['1'].meters, 3);

    const speed = { comment: 2, like: 1, likeTaps: 10, share: 3, follow: 10 };
    assert.deepEqual(db.updateOverlaySpeedSettings(overlay.id, speed).speed, speed);
    result = db.logEvent(overlay.id, {
      type: 'event', event: 'gift', user: 'Viewer', username: 'viewer',
      count: 1, platformEventId: 'gift-1'
    });
    assert.equal(result.state.race.status, 'finished');
    assert.equal(result.state.race.winnerTeam, '1');
    assert.equal(result.state.teams['1'].meters, 100);
    assert.equal(result.state.teams['1'].cups, 1);

    db.logEvent(overlay.id, {
      type: 'event', event: 'gift', user: 'Viewer', username: 'viewer',
      count: 1, platformEventId: 'gift-1'
    });
    assert.equal(db.getOverlayState(overlay.id).teams['1'].cups, 1);

    db.resetOverlayEventCounters(overlay.id);
    state = db.getOverlayState(overlay.id);
    assert.equal(state.race.status, 'idle');
    assert.equal(state.race.winnerTeam, null);
    assert.equal(state.teams['1'].meters, 0);
    assert.equal(state.teams['1'].events, 0);
    assert.equal(state.teams['1'].cups, 1);
    assert.equal(state.speed.likeTaps, 10);
  `);
});

test('race inactivity resets its countdown, advances after ten seconds, and times out without a winner', () => {
  withIsolatedDatabase('tortulive-idle-race-', `
    const assert = require('node:assert/strict');
    const db = require('./api/database');
    const user = db.createUser('idle-race@example.test', 'salt', 'hash');
    const overlay = db.createOverlay(user.id, 'Idle race', 'hash');
    db.logEvent(overlay.id, { type: 'event', event: 'comment', user: 'Viewer' });
    const started = db.getOverlayState(overlay.id);
    const startTime = Date.parse(started.race.lastActivityAt);
    assert.equal(started.race.status, 'running');

    db.advanceIdleRaces(startTime + 9_000, () => 0);
    let state = db.getOverlayState(overlay.id);
    assert.equal(state.race.inactivitySecondsRemaining, 51);
    assert.equal(state.teams['1'].meters + state.teams['2'].meters, 1);

    db.advanceIdleRaces(startTime + 10_000, () => 0);
    state = db.getOverlayState(overlay.id);
    assert.equal(state.teams['1'].meters + state.teams['2'].meters, 2);

    db.logEvent(overlay.id, { type: 'event', event: 'like', user: 'Viewer', count: 1 });
    state = db.getOverlayState(overlay.id);
    assert.equal(state.race.inactivitySecondsRemaining, 60);
    const resetTime = Date.parse(state.race.lastActivityAt);
    db.advanceIdleRaces(resetTime + 60_000, () => 0);
    state = db.getOverlayState(overlay.id);
    assert.equal(state.race.status, 'finished');
    assert.equal(state.race.finishReason, 'inactivity_timeout');
    assert.equal(state.race.winnerTeam, null);
    assert.equal(state.teams['1'].cups + state.teams['2'].cups, 0);
  `);
});

test('an idle finish reaches the goal without awarding a cup, and account speed presets persist', () => {
  withIsolatedDatabase('tortulive-idle-goal-', `
    const assert = require('node:assert/strict');
    const db = require('./api/database');
    const user = db.createUser('idle-goal@example.test', 'salt', 'hash');
    const overlay = db.createOverlay(user.id, 'Idle goal', 'hash');
    db.updateOverlaySpeedSettings(overlay.id, {
      comment: 1, like: 1, likeTaps: 15, share: 3, follow: 98
    });
    db.logEvent(overlay.id, { type: 'event', event: 'follow', user: 'Viewer' });
    let state = db.getOverlayState(overlay.id);
    assert.equal(state.race.status, 'running');
    assert.equal(state.teams['1'].meters + state.teams['2'].meters, 98);

    const started = Date.parse(state.race.lastActivityAt);
    const updates = db.advanceIdleRaces(started + 10_000, () => 1);
    state = db.getOverlayState(overlay.id);
    assert.equal(updates.length, 1);
    assert.equal(state.race.status, 'finished');
    assert.equal(state.race.finishReason, 'inactivity_goal');
    assert.ok(state.race.winnerTeam);
    assert.equal(state.teams['1'].cups + state.teams['2'].cups, 0);

    const preset = db.createSpeedPreset(user.id, 'Rápido', { comment: 2, like: 3, likeTaps: 20, share: 4, follow: 5 });
    assert.deepEqual(db.listSpeedPresets(user.id), [{
      id: preset.id,
      name: 'Rápido',
      speed: { comment: 2, like: 3, likeTaps: 20, share: 4, follow: 5 },
      createdAt: preset.createdAt
    }]);
    assert.equal(db.deleteSpeedPreset(user.id, preset.id), 1);
    assert.deepEqual(db.listSpeedPresets(user.id), []);
  `);
});
