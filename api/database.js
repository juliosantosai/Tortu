const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID } = require('node:crypto');

const databasePath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tortulive.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
const DEFAULT_SPEED = { comment: 1, like: 1, likeTaps: 15, share: 3, follow: 10 };
const RACE_RESULT_DISPLAY_MS = 3_000;
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS overlays (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    api_token_hash TEXT NOT NULL,
    state_json TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS overlays_user_id_idx ON overlays(user_id);

  CREATE TABLE IF NOT EXISTS overlay_events (
    id TEXT PRIMARY KEY,
    overlay_id TEXT NOT NULL REFERENCES overlays(id) ON DELETE CASCADE,
    platform_event_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(overlay_id, platform_event_id)
  );

  CREATE INDEX IF NOT EXISTS overlay_events_created_at_idx ON overlay_events(overlay_id, created_at);

  CREATE TABLE IF NOT EXISTS tiktok_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    last_selected_at TEXT NOT NULL,
    UNIQUE(user_id, username_normalized)
  );

  CREATE TABLE IF NOT EXISTS selected_tiktok_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS tiktok_accounts_history_idx ON tiktok_accounts(user_id, last_selected_at DESC);

  CREATE TABLE IF NOT EXISTS tiktok_connection_status (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT,
    username TEXT,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    expires_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS overlay_event_counters (
    overlay_id TEXT NOT NULL REFERENCES overlays(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (overlay_id, event_type)
  );

  CREATE TABLE IF NOT EXISTS overlay_lifetime_gifts (
    overlay_id TEXT PRIMARY KEY REFERENCES overlays(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS overlay_audience_stats (
    overlay_id TEXT PRIMARY KEY REFERENCES overlays(id) ON DELETE CASCADE,
    current_viewers INTEGER NOT NULL DEFAULT 0,
    peak_viewers INTEGER NOT NULL DEFAULT 0,
    viewer_total INTEGER NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS speed_presets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    speed_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
  );

  UPDATE overlay_audience_stats SET current_viewers = 0;
`);

if (!db.prepare('PRAGMA table_info(tiktok_accounts)').all().some(column => column.name === 'avatar_url')) {
  db.exec('ALTER TABLE tiktok_accounts ADD COLUMN avatar_url TEXT');
}

const statements = {
  createUser: db.prepare(`
    INSERT INTO users (id, email, password_salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  findUser: db.prepare('SELECT * FROM users WHERE email = ?'),
  findUserById: db.prepare('SELECT id, email FROM users WHERE id = ?'),
  createSession: db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `),
  findSession: db.prepare(`
    SELECT sessions.user_id, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  createOverlay: db.prepare(`
    INSERT INTO overlays (id, public_id, user_id, name, api_token_hash, state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  findOverlayById: db.prepare('SELECT * FROM overlays WHERE id = ? AND user_id = ?'),
  findOverlayByPublicId: db.prepare('SELECT * FROM overlays WHERE public_id = ?'),
  findOverlayByToken: db.prepare('SELECT * FROM overlays WHERE id = ? AND api_token_hash = ?'),
  listOverlays: db.prepare('SELECT * FROM overlays WHERE user_id = ? ORDER BY created_at'),
  listOverlayStates: db.prepare('SELECT id, public_id, state_json, sequence FROM overlays'),
  updateOverlayName: db.prepare('UPDATE overlays SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
  rotateOverlayToken: db.prepare('UPDATE overlays SET api_token_hash = ?, updated_at = ? WHERE id = ?'),
  insertEvent: db.prepare(`
    INSERT INTO overlay_events (id, overlay_id, platform_event_id, event_type, payload_json, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  findEventByPlatformId: db.prepare(`
    SELECT sequence FROM overlay_events WHERE overlay_id = ? AND platform_event_id = ?
  `),
  incrementSequence: db.prepare('UPDATE overlays SET sequence = sequence + 1, updated_at = ? WHERE id = ?'),
  updateOverlayState: db.prepare('UPDATE overlays SET state_json = ?, updated_at = ? WHERE id = ?'),
  getSequence: db.prepare('SELECT sequence FROM overlays WHERE id = ?'),
  listEvents: db.prepare(`
    SELECT id, event_type, payload_json, sequence, created_at
    FROM overlay_events
    WHERE overlay_id = ? AND sequence < ?
    ORDER BY sequence DESC
    LIMIT ?
  `),
  clearEvents: db.prepare('DELETE FROM overlay_events WHERE overlay_id = ?')
};

const presetStatements = {
  list: db.prepare('SELECT id, name, speed_json, created_at FROM speed_presets WHERE user_id = ? ORDER BY name COLLATE NOCASE'),
  findByName: db.prepare('SELECT id FROM speed_presets WHERE user_id = ? AND name = ?'),
  insert: db.prepare(`
    INSERT INTO speed_presets (id, user_id, name, speed_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  delete: db.prepare('DELETE FROM speed_presets WHERE id = ? AND user_id = ?')
};

db.exec(`
  INSERT OR IGNORE INTO overlay_event_counters (overlay_id, event_type, count)
  SELECT overlay_id, event_type, COUNT(*)
  FROM overlay_events
  GROUP BY overlay_id, event_type;

  INSERT OR IGNORE INTO overlay_lifetime_gifts (overlay_id, count, updated_at)
  SELECT overlay_id,
    SUM(CASE
      WHEN json_valid(payload_json) AND json_type(payload_json, '$.count') = 'integer'
        AND json_extract(payload_json, '$.count') > 0
      THEN json_extract(payload_json, '$.count')
      ELSE 1
    END),
    MAX(created_at)
  FROM overlay_events
  WHERE event_type = 'gift'
  GROUP BY overlay_id;
`);

const counterStatements = {
  increment: db.prepare(`
    INSERT INTO overlay_event_counters (overlay_id, event_type, count)
    VALUES (?, ?, 1)
    ON CONFLICT(overlay_id, event_type) DO UPDATE SET count = count + 1
  `),
  incrementLifetimeGifts: db.prepare(`
    INSERT INTO overlay_lifetime_gifts (overlay_id, count, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(overlay_id) DO UPDATE SET
      count = count + excluded.count,
      updated_at = excluded.updated_at
  `),
  list: db.prepare('SELECT event_type, count FROM overlay_event_counters WHERE overlay_id = ?'),
  lifetimeGifts: db.prepare('SELECT count FROM overlay_lifetime_gifts WHERE overlay_id = ?'),
  reset: db.prepare('UPDATE overlay_event_counters SET count = 0 WHERE overlay_id = ?')
};

const audienceStatements = {
  record: db.prepare(`
    INSERT INTO overlay_audience_stats
      (overlay_id, current_viewers, peak_viewers, viewer_total, sample_count, updated_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(overlay_id) DO UPDATE SET
      current_viewers = excluded.current_viewers,
      peak_viewers = MAX(overlay_audience_stats.peak_viewers, excluded.current_viewers),
      viewer_total = overlay_audience_stats.viewer_total + excluded.viewer_total,
      sample_count = overlay_audience_stats.sample_count + 1,
      updated_at = excluded.updated_at
  `),
  disconnect: db.prepare(`
    INSERT INTO overlay_audience_stats
      (overlay_id, current_viewers, peak_viewers, viewer_total, sample_count, updated_at)
    VALUES (?, 0, 0, 0, 0, ?)
    ON CONFLICT(overlay_id) DO UPDATE SET
      current_viewers = 0,
      updated_at = excluded.updated_at
  `),
  get: db.prepare('SELECT * FROM overlay_audience_stats WHERE overlay_id = ?'),
  reset: db.prepare(`
    UPDATE overlay_audience_stats
    SET peak_viewers = current_viewers,
        viewer_total = current_viewers,
        sample_count = CASE WHEN current_viewers > 0 THEN 1 ELSE 0 END,
        updated_at = ?
    WHERE overlay_id = ?
  `)
};

const tiktokStatements = {
  list: db.prepare(`
    SELECT tiktok_accounts.id, tiktok_accounts.username, tiktok_accounts.avatar_url,
      tiktok_accounts.created_at,
      tiktok_accounts.last_selected_at,
      CASE WHEN selected_tiktok_accounts.account_id = tiktok_accounts.id THEN 1 ELSE 0 END AS selected
    FROM tiktok_accounts
    LEFT JOIN selected_tiktok_accounts ON selected_tiktok_accounts.user_id = tiktok_accounts.user_id
    WHERE tiktok_accounts.user_id = ?
    ORDER BY tiktok_accounts.last_selected_at DESC
    LIMIT 20
  `),
  find: db.prepare('SELECT * FROM tiktok_accounts WHERE user_id = ? AND username_normalized = ?'),
  insert: db.prepare(`
    INSERT INTO tiktok_accounts (id, user_id, username, username_normalized, created_at, last_selected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  touch: db.prepare('UPDATE tiktok_accounts SET last_selected_at = ? WHERE id = ? AND user_id = ?'),
  select: db.prepare(`
    INSERT INTO selected_tiktok_accounts (user_id, account_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET account_id = excluded.account_id
  `),
  findById: db.prepare('SELECT id, username FROM tiktok_accounts WHERE id = ? AND user_id = ?'),
  remove: db.prepare('DELETE FROM tiktok_accounts WHERE id = ? AND user_id = ?'),
  setAvatar: db.prepare('UPDATE tiktok_accounts SET avatar_url = ? WHERE id = ? AND user_id = ?'),
  deleteStatusForAccount: db.prepare(
    'DELETE FROM tiktok_connection_status WHERE user_id = ? AND account_id = ?'
  ),
  latest: db.prepare(`
    SELECT tiktok_accounts.id, tiktok_accounts.username
    FROM selected_tiktok_accounts
    JOIN tiktok_accounts ON tiktok_accounts.id = selected_tiktok_accounts.account_id
    WHERE selected_tiktok_accounts.user_id = ?
  `),
  listSelected: db.prepare(`
    SELECT selected_tiktok_accounts.user_id, tiktok_accounts.id AS account_id, tiktok_accounts.username
    FROM selected_tiktok_accounts
    JOIN tiktok_accounts ON tiktok_accounts.id = selected_tiktok_accounts.account_id
  `),
  findStatus: db.prepare('SELECT * FROM tiktok_connection_status WHERE user_id = ?'),
  upsertStatus: db.prepare(`
    INSERT INTO tiktok_connection_status
      (user_id, account_id, username, status, attempt, next_retry_at, expires_at, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      account_id = excluded.account_id,
      username = excluded.username,
      status = excluded.status,
      attempt = excluded.attempt,
      next_retry_at = excluded.next_retry_at,
      expires_at = excluded.expires_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `),
  overlayForUser: db.prepare('SELECT * FROM overlays WHERE user_id = ? ORDER BY created_at LIMIT 1')
};

function createUser(email, salt, hash) {
  const user = { id: randomUUID(), email, password_salt: salt, password_hash: hash, created_at: new Date().toISOString() };
  statements.createUser.run(user.id, user.email, user.password_salt, user.password_hash, user.created_at);
  return user;
}

function normalizeOverlayState(state) {
  state.race = {
    status: 'idle',
    maxMeters: 100,
    winnerTeam: null,
    matchStartedAt: null,
    lastActivityAt: null,
    inactivitySecondsRemaining: 60,
    finishedAt: null,
    finishReason: null,
    ...(state.race || {}),
    authority: 'server'
  };
  state.teams = state.teams || {
    '1': { name: 'OLIMPIA', meters: 0, events: 0, eventCounts: {}, cups: 0, flag: null, turbo: false },
    '2': { name: 'CERRO', meters: 0, events: 0, eventCounts: {}, cups: 0, flag: null, turbo: false }
  };
  for (const id of ['1', '2']) {
    state.teams[id] = {
      name: id === '1' ? 'OLIMPIA' : 'CERRO',
      meters: 0,
      events: 0,
      eventCounts: {},
      cups: 0,
      flag: null,
      turbo: false,
      ...(state.teams[id] || {})
    };
  }
  state.speed = { ...DEFAULT_SPEED, ...(state.speed || {}) };
  state.displaySettings = {
    flags: true,
    donTortu: true,
    teamEvents: true,
    honor: true,
    progressBar: true,
    ...(state.displaySettings || {})
  };
  state._participants = Object.assign(Object.create(null), state._participants || {});
  state._likeRemainders ||= { '1': 0, '2': 0 };
  state._idleLastTickAt ||= state.race.lastActivityAt;
  return state;
}

function publicOverlayState(rawState) {
  const state = normalizeOverlayState(JSON.parse(rawState));
  const { _participants, _likeRemainders, _idleLastTickAt, ...publicState } = state;
  return publicState;
}

function createOverlay(userId, name, apiTokenHash) {
  const id = randomUUID();
  const publicId = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  const initialState = {
    race: {
      status: 'idle', maxMeters: 100, winnerTeam: null,
      matchStartedAt: null, lastActivityAt: null,
      inactivitySecondsRemaining: 60, finishedAt: null, finishReason: null,
      authority: 'server'
    },
    teams: {
      '1': { name: 'OLIMPIA', meters: 0, events: 0, eventCounts: {}, cups: 0, flag: null, turbo: false },
      '2': { name: 'CERRO', meters: 0, events: 0, eventCounts: {}, cups: 0, flag: null, turbo: false }
    },
    speed: DEFAULT_SPEED,
    displaySettings: {
      flags: true,
      donTortu: true,
      teamEvents: true,
      honor: true,
      progressBar: true
    },
    alert: null,
    _participants: {},
    _idleLastTickAt: null,
    _likeRemainders: { '1': 0, '2': 0 }
  };
  statements.createOverlay.run(id, publicId, userId, name, apiTokenHash, JSON.stringify(initialState), now, now);
  return statements.findOverlayById.get(id, userId);
}

function normalizedTeamText(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function teamChoice(message, teams) {
  const text = normalizedTeamText(message);
  if (!text) return null;
  const scores = ['1', '2'].map(id => {
    const words = normalizedTeamText(teams[id].name).split(' ')
      .filter(word => word.length >= 3 && word !== 'club' && word !== 'futbol');
    let best = 0;
    for (const name of words) {
      if (text.split(' ').includes(name) || (name.length >= 4 && text.includes(name))) {
        best = 1;
        continue;
      }
      for (const word of text.split(' ')) {
        if (word.length < 4 || name.length < 4) continue;
        const distance = editDistance(word, name);
        const similarity = 1 - distance / Math.max(word.length, name.length);
        if (distance <= (name.length >= 7 ? 2 : 1) && similarity >= 0.7) {
          best = Math.max(best, similarity);
        }
      }
    }
    return best;
  });
  if (scores[0] >= 0.7 && scores[0] > scores[1]) return '1';
  if (scores[1] >= 0.7 && scores[1] > scores[0]) return '2';
  return null;
}

function stableTeamFor(identity) {
  let hash = 0;
  for (const char of identity) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2 === 0 ? '1' : '2';
}

function resetRaceState(state) {
  const maxMeters = state.race.maxMeters;
  state.race = {
    status: 'idle',
    maxMeters,
    winnerTeam: null,
    matchStartedAt: null,
    lastActivityAt: null,
    inactivitySecondsRemaining: 60,
    finishedAt: null,
    finishReason: null,
    authority: 'server'
  };
  state._idleLastTickAt = null;
  for (const id of ['1', '2']) {
    state.teams[id].meters = 0;
    state.teams[id].events = 0;
    state.teams[id].eventCounts = {};
  }
  state._participants = {};
  state._likeRemainders = { '1': 0, '2': 0 };
}

function finishRace(state, winnerTeam, reason, finishedAt) {
  state.race.status = 'finished';
  state.race.winnerTeam = winnerTeam;
  state.race.finishReason = reason;
  state.race.finishedAt = finishedAt;
  state.race.inactivitySecondsRemaining = 0;
}

function applyRaceEvent(state, payload, receivedAt) {
  normalizeOverlayState(state);
  if (payload.event === 'reset') {
    resetRaceState(state);
    return { ...payload, teamId: null, previousTeamId: null, teamChanged: false };
  }

  if (['comment', 'like', 'follow', 'share', 'gift'].includes(payload.event) &&
      state.race.status !== 'finished') {
    state.race.matchStartedAt ||= receivedAt;
    state.race.lastActivityAt = receivedAt;
    state.race.inactivitySecondsRemaining = 60;
    state._idleLastTickAt = receivedAt;
    if (state.race.status === 'idle') state.race.status = 'running';
  }

  const rawUser = payload.username || payload.user;
  if (!rawUser) return { ...payload, teamId: null, previousTeamId: null, teamChanged: false };
  const identity = String(rawUser).replace(/^@/, '').toLowerCase();
  if (!identity) return { ...payload, teamId: null, previousTeamId: null, teamChanged: false };

  const participants = state._participants;
  let participant = participants[identity];
  if (!participant) {
    participant = participants[identity] = {
      teamId: stableTeamFor(identity),
      chosen: false,
      eventCounts: {}
    };
  }
  const previousTeamId = participant.teamId;
  const choice = payload.event === 'comment' ? teamChoice(payload.message, state.teams) : null;
  if (choice) {
    participant.chosen = true;
    participant.teamId = choice;
  }
  const teamId = participant.teamId;
  const teamChanged = previousTeamId !== teamId;
  if (teamChanged) {
    const from = state.teams[previousTeamId];
    const to = state.teams[teamId];
    for (const [kind, count] of Object.entries(participant.eventCounts)) {
      from.eventCounts[kind] = Math.max(0, (from.eventCounts[kind] || 0) - count);
      to.eventCounts[kind] = (to.eventCounts[kind] || 0) + count;
      from.events = Math.max(0, from.events - count);
      to.events += count;
    }
    if (state.race.status !== 'finished') {
      const contribution = participant.meters || 0;
      from.meters = Math.max(0, from.meters - contribution);
      to.meters = Math.min(state.race.maxMeters, to.meters + contribution);
      state.race.status = to.meters >= state.race.maxMeters
        ? 'finished'
        : (from.meters > 0 || to.meters > 0 ? 'running' : 'idle');
      if (state.race.status === 'finished') {
        finishRace(state, teamId, 'activity', receivedAt);
        to.cups = (to.cups || 0) + 1;
      }
    }
  }

  const metricKinds = ['comment', 'share', 'like', 'gift'];
  if (metricKinds.includes(payload.event)) {
    const count = ['like', 'gift'].includes(payload.event)
      ? (Number.isSafeInteger(payload.count) && payload.count > 0 ? payload.count : 1)
      : 1;
    participant.eventCounts[payload.event] = (participant.eventCounts[payload.event] || 0) + count;
    const team = state.teams[teamId];
    team.eventCounts[payload.event] = (team.eventCounts[payload.event] || 0) + count;
    team.events += count;
  }

  const maxMeters = state.race.maxMeters;
  if (state.race.status !== 'finished') {
    let meters = 0;
    if (payload.event === 'comment') meters = state.speed.comment;
    else if (payload.event === 'share') meters = state.speed.share;
    else if (payload.event === 'follow') meters = state.speed.follow;
    else if (payload.event === 'like') {
      const taps = Number.isSafeInteger(payload.count) && payload.count > 0 ? payload.count : 1;
      const totalTaps = state._likeRemainders[teamId] + taps;
      meters = Math.floor(totalTaps / state.speed.likeTaps) * state.speed.like;
      state._likeRemainders[teamId] = totalTaps % state.speed.likeTaps;
    } else if (payload.event === 'gift') {
      meters = maxMeters;
    }

    if (meters > 0) {
      const team = state.teams[teamId];
      const wasFinished = state.race.status === 'finished';
      const addedMeters = payload.event === 'gift'
        ? Math.max(0, maxMeters - team.meters)
        : meters;
      team.meters = Math.min(maxMeters, team.meters + addedMeters);
      participant.meters = (participant.meters || 0) + addedMeters;
      if (team.meters >= maxMeters) {
        finishRace(state, teamId, 'activity', receivedAt);
        if (!wasFinished) team.cups = (team.cups || 0) + 1;
      } else {
        state.race.status = 'running';
      }
    }
  }
  return { ...payload, teamId, previousTeamId, teamChanged };
}

function logEvent(overlayId, payload) {
  const platformEventId = payload.platformEventId || null;
  const giftCount = payload.event === 'gift' &&
    Number.isSafeInteger(payload.count) && payload.count > 0 && payload.count <= 1_000_000
    ? payload.count
    : 1;
  if (platformEventId) {
    const existing = statements.findEventByPlatformId.get(overlayId, platformEventId);
    if (existing) return { duplicate: true, sequence: existing.sequence, eventId: null };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    statements.incrementSequence.run(new Date().toISOString(), overlayId);
    const sequence = statements.getSequence.get(overlayId).sequence;
    const eventId = randomUUID();
    const overlay = db.prepare('SELECT state_json FROM overlays WHERE id = ?').get(overlayId);
    const state = normalizeOverlayState(JSON.parse(overlay.state_json));
    const receivedAt = new Date().toISOString();
    const eventPayload = applyRaceEvent(state, payload, receivedAt);
    statements.insertEvent.run(
      eventId,
      overlayId,
      platformEventId,
      payload.event,
      JSON.stringify(eventPayload),
      sequence,
      new Date().toISOString()
    );
    statements.updateOverlayState.run(JSON.stringify(state), new Date().toISOString(), overlayId);
    counterStatements.increment.run(overlayId, payload.event);
    if (payload.event === 'gift') {
      counterStatements.incrementLifetimeGifts.run(overlayId, giftCount, new Date().toISOString());
    }
    db.exec('COMMIT');
    return {
      duplicate: false,
      sequence,
      eventId,
      payload: eventPayload,
      state: publicOverlayState(JSON.stringify(state))
    };
  } catch (error) {
    db.exec('ROLLBACK');
    if (platformEventId) {
      const existing = statements.findEventByPlatformId.get(overlayId, platformEventId);
      if (existing) return { duplicate: true, sequence: existing.sequence, eventId: null };
    }
    throw error;
  }
}

function addTikTokAccount(userId, username) {
  const usernameNormalized = username.toLowerCase();
  const now = new Date().toISOString();
  let account = tiktokStatements.find.get(userId, usernameNormalized);
  if (account) {
    tiktokStatements.touch.run(now, account.id, userId);
  } else {
    const id = randomUUID();
    tiktokStatements.insert.run(id, userId, username, usernameNormalized, now, now);
    account = { id, username };
  }
  tiktokStatements.select.run(userId, account.id);
  return tiktokStatements.findById.get(account.id, userId);
}

function advanceIdleRaces(now = Date.now(), random = Math.random) {
  const updates = [];
  for (const overlay of statements.listOverlayStates.all()) {
    const state = normalizeOverlayState(JSON.parse(overlay.state_json));
    const race = state.race;
    if (race.status === 'finished') {
      const finishedAt = Date.parse(race.finishedAt);
      if (Number.isFinite(finishedAt) && now - finishedAt < RACE_RESULT_DISPLAY_MS) continue;

      resetRaceState(state);
      statements.updateOverlayState.run(JSON.stringify(state), new Date(now).toISOString(), overlay.id);
      updates.push({
        publicId: overlay.public_id,
        sequence: overlay.sequence,
        state: publicOverlayState(JSON.stringify(state)),
        raceReset: true
      });
      continue;
    }
    if (race.status !== 'running') continue;

    let lastActivity = Date.parse(race.lastActivityAt);
    let changed = false;
    if (!Number.isFinite(lastActivity)) {
      lastActivity = now;
      race.matchStartedAt ||= new Date(now).toISOString();
      race.lastActivityAt = new Date(now).toISOString();
      state._idleLastTickAt = race.lastActivityAt;
      changed = true;
    }

    let lastTick = Date.parse(state._idleLastTickAt || race.lastActivityAt);
    if (!Number.isFinite(lastTick) || lastTick < lastActivity) lastTick = lastActivity;
    const tickCount = Math.max(0, Math.min(60, Math.floor((now - lastTick) / 1000)));
    changed = changed || tickCount > 0;

    for (let tick = 1; tick <= tickCount && race.status === 'running'; tick++) {
      const tickAt = lastTick + tick * 1000;
      const idleSeconds = Math.floor((tickAt - lastActivity) / 1000);
      if (idleSeconds < 10 || idleSeconds >= 60) continue;

      const deltas = ['1', '2'].map(() => 0.5 + Math.max(0, Math.min(1, Number(random()) || 0)) * 2.5);
      const candidates = ['1', '2'].map((id, index) => ({
        id,
        fraction: (race.maxMeters - state.teams[id].meters) / deltas[index]
      })).filter(candidate => candidate.fraction >= 0 && candidate.fraction <= 1)
        .sort((left, right) => left.fraction - right.fraction);

      if (candidates.length) {
        const winner = candidates[0];
        for (let index = 0; index < 2; index++) {
          const id = index === 0 ? '1' : '2';
          state.teams[id].meters = Math.min(
            race.maxMeters,
            state.teams[id].meters + deltas[index] * winner.fraction
          );
        }
        state.teams[winner.id].meters = race.maxMeters;
        finishRace(state, winner.id, 'inactivity_goal', new Date(tickAt).toISOString());
      } else {
        for (let index = 0; index < 2; index++) {
          const id = index === 0 ? '1' : '2';
          state.teams[id].meters = Math.min(race.maxMeters, state.teams[id].meters + deltas[index]);
        }
      }
    }

    state._idleLastTickAt = new Date(lastTick + tickCount * 1000).toISOString();
    const elapsed = Math.max(0, Math.floor((now - lastActivity) / 1000));
    race.inactivitySecondsRemaining = Math.max(0, 60 - elapsed);
    if (race.status === 'running' && race.inactivitySecondsRemaining === 0) {
      finishRace(state, null, 'inactivity_timeout', new Date(now).toISOString());
    }

    if (changed || race.status === 'finished') {
      statements.updateOverlayState.run(JSON.stringify(state), new Date(now).toISOString(), overlay.id);
      updates.push({
        publicId: overlay.public_id,
        sequence: overlay.sequence,
        state: publicOverlayState(JSON.stringify(state))
      });
    }
  }
  return updates;
}

function updateOverlayDisplaySettings(overlayId, settings) {
  const overlay = db.prepare('SELECT state_json FROM overlays WHERE id = ?').get(overlayId);
  if (!overlay) return null;
  const state = normalizeOverlayState(JSON.parse(overlay.state_json));
  state.displaySettings = settings;
  statements.updateOverlayState.run(JSON.stringify(state), new Date().toISOString(), overlayId);
  return state;
}

function updateOverlaySpeedSettings(overlayId, speed) {
  const overlay = db.prepare('SELECT state_json FROM overlays WHERE id = ?').get(overlayId);
  if (!overlay) return null;
  const state = normalizeOverlayState(JSON.parse(overlay.state_json));
  state.speed = speed;
  statements.updateOverlayState.run(JSON.stringify(state), new Date().toISOString(), overlayId);
  return state;
}

function updateOverlayTeamSettings(overlayId, teams) {
  const overlay = db.prepare('SELECT state_json FROM overlays WHERE id = ?').get(overlayId);
  if (!overlay) return null;
  const state = normalizeOverlayState(JSON.parse(overlay.state_json));
  for (const id of ['1', '2']) {
    state.teams[id].name = teams[id].name;
    state.teams[id].flag = teams[id].flag || null;
  }
  statements.updateOverlayState.run(JSON.stringify(state), new Date().toISOString(), overlayId);
  return {
    '1': { name: state.teams['1'].name, flag: state.teams['1'].flag },
    '2': { name: state.teams['2'].name, flag: state.teams['2'].flag }
  };
}

function resetOverlayRace(overlayId) {
  const overlay = db.prepare('SELECT state_json FROM overlays WHERE id = ?').get(overlayId);
  if (!overlay) return null;
  const state = normalizeOverlayState(JSON.parse(overlay.state_json));
  resetRaceState(state);
  statements.updateOverlayState.run(JSON.stringify(state), new Date().toISOString(), overlayId);
  return publicOverlayState(JSON.stringify(state));
}

module.exports = {
  addTikTokAccount,
  createOverlay,
  createUser,
  findOverlayById: (id, userId) => statements.findOverlayById.get(id, userId),
  findOverlayByPublicId: publicId => statements.findOverlayByPublicId.get(publicId),
  findOverlayByTokenHash: (id, tokenHash) => statements.findOverlayByToken.get(id, tokenHash),
  findUserByEmail: email => statements.findUser.get(email),
  getOverlayState: overlayId => {
    const overlay = db.prepare('SELECT state_json FROM overlays WHERE id = ?').get(overlayId);
    return overlay ? publicOverlayState(overlay.state_json) : null;
  },
  getUserOverlays: userId => statements.listOverlays.all(userId),
  getSelectedTikTokAccount: userId => tiktokStatements.latest.get(userId) || null,
  getTikTokAccountHistory: userId => tiktokStatements.list.all(userId),
  deleteTikTokAccount: (userId, accountId) => {
    if (!tiktokStatements.findById.get(accountId, userId)) return false;
    tiktokStatements.deleteStatusForAccount.run(userId, accountId);
    return tiktokStatements.remove.run(accountId, userId).changes > 0;
  },
  getSelectedTikTokAccounts: () => tiktokStatements.listSelected.all(),
  getTikTokConnectionStatus: userId => tiktokStatements.findStatus.get(userId) || null,
  getOverlayForUser: userId => tiktokStatements.overlayForUser.get(userId) || null,
  setTikTokAccountAvatar: (userId, accountId, avatarUrl) =>
    tiktokStatements.setAvatar.run(avatarUrl, accountId, userId).changes,
  updateOverlayDisplaySettings,
  updateOverlaySpeedSettings,
  updateOverlayTeamSettings,
  advanceIdleRaces,
  listSpeedPresets: userId => presetStatements.list.all(userId).map(preset => ({
    id: preset.id,
    name: preset.name,
    speed: JSON.parse(preset.speed_json),
    createdAt: preset.created_at
  })),
  findSpeedPresetByName: (userId, name) => presetStatements.findByName.get(userId, name) || null,
  createSpeedPreset: (userId, name, speed) => {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    presetStatements.insert.run(id, userId, name, JSON.stringify(speed), createdAt);
    return { id, name, speed, createdAt };
  },
  deleteSpeedPreset: (userId, presetId) => presetStatements.delete.run(presetId, userId).changes,
  resetOverlayRace,
  resetLifetimeGifts: overlayId => db.prepare(`
    UPDATE overlay_lifetime_gifts SET count = 0, updated_at = ? WHERE overlay_id = ?
  `).run(new Date().toISOString(), overlayId).changes,
  logEvent,
  getOverlayEvents: (overlayId, beforeSequence = Number.MAX_SAFE_INTEGER, limit = 50) =>
    statements.listEvents.all(overlayId, beforeSequence, limit).map(event => ({
      ...JSON.parse(event.payload_json),
      id: event.id,
      event: event.event_type,
      sequence: event.sequence,
      occurredAt: event.created_at
    })),
  getOverlayEventSummary: overlayId => {
    const counts = Object.fromEntries(
      counterStatements.list.all(overlayId).map(row => [row.event_type, row.count])
    );
    return {
      counts,
      total: Object.values(counts).reduce((total, count) => total + count, 0),
      lifetimeGiftCount: counterStatements.lifetimeGifts.get(overlayId)?.count || 0,
      audience: (() => {
        const stats = audienceStatements.get.get(overlayId);
        return {
          current: stats?.current_viewers || 0,
          peak: stats?.peak_viewers || 0,
          average: stats?.sample_count ? Math.round(stats.viewer_total / stats.sample_count) : 0,
          samples: stats?.sample_count || 0,
          updatedAt: stats?.updated_at || null
        };
      })(),
      sequence: statements.getSequence.get(overlayId)?.sequence || 0
    };
  },
  resetOverlayEventCounters: overlayId => {
    const resetCounts = counterStatements.reset.run(overlayId).changes;
    audienceStatements.reset.run(new Date().toISOString(), overlayId);
    resetOverlayRace(overlayId);
    return resetCounts;
  },
  saveOverlayAudience: (overlayId, viewers) => {
    const updatedAt = new Date().toISOString();
    if (viewers === null) {
      audienceStatements.disconnect.run(overlayId, updatedAt);
      return;
    }
    if (!Number.isSafeInteger(viewers) || viewers < 0) {
      throw new TypeError('Audience count must be a non-negative safe integer or null');
    }
    audienceStatements.record.run(overlayId, viewers, viewers, viewers, updatedAt);
  },
  clearOverlayEvents: overlayId => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const deleted = statements.clearEvents.run(overlayId).changes;
      counterStatements.reset.run(overlayId);
      db.exec('COMMIT');
      return deleted;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
  removeSession: tokenHash => statements.deleteSession.run(tokenHash),
  saveSession: {
    create: (userId, tokenHash, expiresAt) =>
      statements.createSession.run(tokenHash, userId, expiresAt, new Date().toISOString()),
    lookup: tokenHash => {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      return statements.findSession.get(tokenHash, Date.now());
    }
  },
  updateOverlayName: Object.assign(
    (id, userId, name) => statements.updateOverlayName.run(name, new Date().toISOString(), id, userId),
    { rotateToken: (id, tokenHash) => statements.rotateOverlayToken.run(tokenHash, new Date().toISOString(), id) }
  ),
  selectTikTokAccount: (userId, accountId) => {
    const account = tiktokStatements.findById.get(accountId, userId);
    if (!account) return null;
    tiktokStatements.touch.run(new Date().toISOString(), accountId, userId);
    tiktokStatements.select.run(userId, accountId);
    return account;
  },
  saveTikTokConnectionStatus: (userId, status) => tiktokStatements.upsertStatus.run(
    userId,
    status.accountId || null,
    status.username || null,
    status.status,
    status.attempt || 0,
    status.nextRetryAt || null,
    status.expiresAt || null,
    status.lastError || null,
    status.updatedAt || new Date().toISOString()
  )
};
