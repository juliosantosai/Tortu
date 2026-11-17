const { randomUUID } = require('node:crypto');

const RETRY_INTERVAL_MS = 5_000;
const RETRY_WINDOW_MS = 5 * 60_000;
const BROWSER_HEARTBEAT_TIMEOUT_MS = 60_000;

function createConnector(username) {
  return import('tiktok-live-connector').then(({ TikTokLiveConnection }) =>
    new TikTokLiveConnection(username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true
    })
  );
}

function getAvatarUrl(roomInfo) {
  const owner = roomInfo?.owner || roomInfo?.data?.owner;
  const pictures = [
    owner?.avatar_thumb,
    owner?.avatarThumb,
    owner?.avatar_medium,
    owner?.avatarMedium,
    owner?.avatar_large,
    owner?.avatarLarge
  ];
  for (const picture of pictures) {
    const url = picture?.url_list?.[0] || picture?.urlList?.[0];
    if (typeof url === 'string' && url.startsWith('https://')) return url;
  }
  const directUrl = owner?.profilePictureUrl || owner?.avatarUrl;
  return typeof directUrl === 'string' && directUrl.startsWith('https://') ? directUrl : null;
}

function getViewerCount(data) {
  const candidates = [
    data?.viewerCount,
    data?.viewer_count,
    data?.userCount,
    data?.user_count,
    data?.totalUser,
    data?.total_user,
    data?.room_user_count,
    data?.stats?.user_count,
    data?.stats?.total_user,
    data?.stats?.viewer_count,
    data?.data?.viewerCount,
    data?.data?.viewer_count,
    data?.data?.user_count,
    data?.data?.total_user,
    data?.data?.room_user_count,
    data?.data?.stats?.user_count
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const viewers = Number(candidate);
    if (Number.isSafeInteger(viewers) && viewers >= 0) return viewers;
  }
  return null;
}

class TikTokConnectionManager {
  constructor({
    saveStatus,
    onEvent,
    onAudience = () => {},
    onProfileUpdate = () => {},
    onStatus = () => {},
    connectorFactory = createConnector,
    browserHeartbeatTimeoutMs = BROWSER_HEARTBEAT_TIMEOUT_MS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    this.saveStatus = saveStatus;
    this.onEvent = onEvent;
    this.onAudience = onAudience;
    this.onProfileUpdate = onProfileUpdate;
    this.onStatus = onStatus;
    this.connectorFactory = connectorFactory;
    this.browserHeartbeatTimeoutMs = browserHeartbeatTimeoutMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.connections = new Map();
    this.pendingStarts = new Map();
    this.pendingAccounts = new Map();
    this.browserHeartbeats = new Map();
  }

  reportBrowserHeartbeat(userId, account) {
    const previousHeartbeat = this.browserHeartbeats.get(userId);
    const wasInactive = !previousHeartbeat;
    if (previousHeartbeat) this.clearTimer(previousHeartbeat.timer);
    const heartbeat = {
      lastSeenAt: this.now(),
      timer: null,
      accountId: previousHeartbeat?.accountId || null
    };
    this.browserHeartbeats.set(userId, heartbeat);
    heartbeat.timer = this.setTimer(
      () => this.checkBrowserHeartbeat(userId, heartbeat),
      this.browserHeartbeatTimeoutMs
    );

    const accountChanged = account && heartbeat.accountId !== account.id;
    const shouldConnect = wasInactive
      ? !this.hasActiveConnection(userId)
      : accountChanged || (!heartbeat.accountId && !this.hasActiveConnection(userId));
    if (account) heartbeat.accountId = account.id;
    if (account && shouldConnect) {
      void this.connectUser(userId, account);
    }
  }

  hasActiveConnection(userId) {
    const entry = this.connections.get(userId);
    return this.pendingStarts.has(userId) || Boolean(entry && !entry.expired);
  }

  checkBrowserHeartbeat(userId, heartbeat) {
    if (this.browserHeartbeats.get(userId) !== heartbeat) return;
    const elapsed = this.now() - heartbeat.lastSeenAt;
    if (elapsed < this.browserHeartbeatTimeoutMs) {
      heartbeat.timer = this.setTimer(
        () => this.checkBrowserHeartbeat(userId, heartbeat),
        this.browserHeartbeatTimeoutMs - elapsed
      );
      return;
    }
    this.browserHeartbeats.delete(userId);
    void this.stopUser(userId);
  }

  async connectUser(userId, account) {
    const generation = randomUUID();
    this.pendingStarts.set(userId, generation);
    this.pendingAccounts.set(userId, account.id);
    await this.stopUser(userId, false, false);
    if (this.pendingStarts.get(userId) !== generation) return;
    this.pendingStarts.delete(userId);
    this.pendingAccounts.delete(userId);
    const entry = {
      userId,
      accountId: account.id,
      username: account.username,
      generation,
      attempt: 0,
      retryDeadline: this.now() + RETRY_WINDOW_MS,
      retryTimer: null,
      deadlineTimer: null,
      connection: null,
      connected: false,
      expired: false
    };
    this.connections.set(userId, entry);
    entry.deadlineTimer = this.setTimer(() => this.expire(entry), RETRY_WINDOW_MS);
    this.updateStatus(entry, 'connecting', { expiresAt: new Date(entry.retryDeadline).toISOString() });
    void this.attemptConnection(entry);
  }

  async stopUser(userId, persistStatus = true, invalidatePending = true) {
    if (invalidatePending) {
      this.pendingStarts.delete(userId);
      this.pendingAccounts.delete(userId);
    }
    const entry = this.connections.get(userId);
    if (!entry) return;
    this.connections.delete(userId);
    this.clearTimer(entry.retryTimer);
    this.clearTimer(entry.deadlineTimer);
    if (entry.connection) {
      try {
        await entry.connection.disconnect();
      } catch (error) {
        console.error('Error cerrando la conexión TikTok:', error);
      }
    }
    this.reportAudience(userId, null);
    if (persistStatus) {
      this.updateStatus(entry, 'disconnected', {
        expiresAt: null,
        nextRetryAt: null,
        lastError: null
      });
    }
  }

  async stopAll() {
    this.pendingStarts.clear();
    this.pendingAccounts.clear();
    for (const heartbeat of this.browserHeartbeats.values()) this.clearTimer(heartbeat.timer);
    this.browserHeartbeats.clear();
    await Promise.all([...this.connections.keys()].map(userId => this.stopUser(userId)));
  }

  async refreshAccountStatuses(accounts) {
    const results = [];
    for (let index = 0; index < accounts.length; index += 3) {
      const batch = accounts.slice(index, index + 3);
      results.push(...await Promise.all(batch.map(async account => {
        let connection;
        try {
          connection = await this.connectorFactory(account.username);
          const live = await connection.fetchIsLive();
          let avatarUrl = account.avatar_url || null;
          try {
            const roomInfo = await connection.fetchRoomInfo();
            avatarUrl = getAvatarUrl(roomInfo) || avatarUrl;
          } catch (error) {
            console.error(`No se pudo actualizar el avatar de @${account.username}:`, error);
          }
          if (avatarUrl) this.onProfileUpdate(account, avatarUrl);
          return { id: account.id, username: account.username, live, avatarUrl, checked: true };
        } catch (error) {
          return {
            id: account.id,
            username: account.username,
            live: null,
            avatarUrl: account.avatar_url || null,
            checked: false,
            error: error instanceof Error ? error.message : String(error)
          };
        } finally {
          if (connection) {
            try {
              await connection.disconnect();
            } catch (error) {
              console.error(`Error cerrando la consulta de @${account.username}:`, error);
            }
          }
        }
      })));
    }
    return results;
  }

  async attemptConnection(entry) {
    if (!this.isCurrent(entry)) return;
    if (this.now() >= entry.retryDeadline) {
      this.expire(entry);
      return;
    }

    entry.attempt += 1;
    this.updateStatus(entry, entry.attempt === 1 ? 'connecting' : 'retrying', {
      attempt: entry.attempt,
      nextRetryAt: null,
      expiresAt: new Date(entry.retryDeadline).toISOString()
    });

    let connection;
    try {
      connection = await this.connectorFactory(entry.username);
      if (!this.isCurrent(entry)) {
        await connection.disconnect();
        return;
      }
      entry.connection = connection;
      this.attachListeners(entry, connection);
      await connection.connect();
      if (!this.isCurrent(entry)) return;
      entry.connected = true;
      this.clearTimer(entry.deadlineTimer);
      entry.retryDeadline = null;
      const roomInfo = connection.roomInfo;
      const avatarUrl = getAvatarUrl(roomInfo);
      if (avatarUrl) {
        this.onProfileUpdate({
          id: entry.accountId,
          userId: entry.userId,
          username: entry.username
        }, avatarUrl);
      }
      const viewers = getViewerCount(roomInfo);
      if (viewers !== null) this.reportAudience(entry.userId, viewers);
      this.updateStatus(entry, 'connected', {
        attempt: entry.attempt,
        nextRetryAt: null,
        expiresAt: null,
        lastError: null
      });
    } catch (error) {
      if (!this.isCurrent(entry)) return;
      entry.connected = false;
      entry.connection = null;
      if (connection) {
        try {
          await connection.disconnect();
        } catch (disconnectError) {
          console.error('Error cerrando un intento de conexión TikTok:', disconnectError);
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      this.scheduleRetry(entry, message);
    }
  }

  attachListeners(entry, connection) {
    connection.on('connected', () => {
      if (!this.isCurrent(entry) || entry.connection !== connection) return;
      entry.connected = true;
      this.clearTimer(entry.deadlineTimer);
      entry.retryDeadline = null;
      this.updateStatus(entry, 'connected', {
        attempt: entry.attempt,
        nextRetryAt: null,
        expiresAt: null,
        lastError: null
      });
    });
    connection.on('disconnected', details => {
      if (!this.isCurrent(entry) || entry.connection !== connection) return;
      entry.connected = false;
      entry.connection = null;
      this.reportAudience(entry.userId, null);
      this.scheduleRetry(entry, details?.reason || 'TikTok cerró la conexión');
    });
    connection.on('streamEnd', () => {
      if (!this.isCurrent(entry) || entry.connection !== connection) return;
      entry.connected = false;
      entry.connection = null;
      this.reportAudience(entry.userId, null);
      this.scheduleRetry(entry, 'El LIVE terminó');
    });
    connection.on('error', error => {
      if (this.isCurrent(entry) && entry.connection === connection) {
        this.updateStatus(entry, entry.connected ? 'connected' : 'retrying', {
          lastError: error instanceof Error ? error.message : String(error)
        });
      }
    });
    for (const eventName of ['chat', 'member', 'gift', 'like', 'follow', 'share']) {
      connection.on(eventName, data => {
        if (this.isCurrent(entry) && entry.connection === connection) {
          this.forwardEvent(entry, eventName, data);
        }
      });
    }
    connection.on('roomUser', data => {
      if (!this.isCurrent(entry) || entry.connection !== connection) return;
      const viewers = getViewerCount(data);
      if (viewers !== null) {
        this.reportAudience(entry.userId, viewers);
      }
    });
  }

  reportAudience(userId, viewers) {
    void Promise.resolve(this.onAudience(userId, viewers)).catch(error => {
      console.error('No se pudo guardar la estadística de audiencia:', error);
    });
  }

  forwardEvent(entry, eventName, data) {
    if (!this.isCurrent(entry)) return;
    if (eventName === 'gift' && data.giftDetails?.giftType === 1 && !data.repeatEnd) return;
    const event = {
      type: 'event',
      event: ({
        chat: 'comment',
        member: 'join',
        gift: 'gift',
        like: 'like',
        follow: 'follow',
        share: 'share'
      })[eventName],
      user: String(data.user?.nickname || data.user?.uniqueId || 'TikTok').slice(0, 80),
      username: String(data.user?.uniqueId || data.user?.displayId || '').slice(0, 80),
      avatar: data.user?.avatarThumb?.urlList?.[0] || data.user?.avatarMedium?.urlList?.[0] || null,
      occurredAt: new Date().toISOString()
    };
    const platformEventId = data.common?.msgId;
    if (typeof platformEventId === 'string' && platformEventId !== '0') {
      event.platformEventId = platformEventId.slice(0, 160);
    }
    if (eventName === 'chat') event.message = String(data.comment || '').slice(0, 2_000);
    if (eventName === 'gift') {
      event.gift = String(data.giftDetails?.giftName || data.extendedGiftInfo?.name || data.giftId || '').slice(0, 100);
      event.count = data.repeatCount || 1;
    }
    if (eventName === 'like') event.count = data.likeCount || 1;
    void this.onEvent(entry.userId, event).catch(error => {
      console.error('No se pudo reenviar un evento TikTok al overlay:', error);
    });
  }

  scheduleRetry(entry, error) {
    if (!this.isCurrent(entry)) return;
    if (!entry.retryDeadline) {
      entry.retryDeadline = this.now() + RETRY_WINDOW_MS;
      entry.deadlineTimer = this.setTimer(() => this.expire(entry), RETRY_WINDOW_MS);
    }
    if (this.now() >= entry.retryDeadline) {
      this.expire(entry);
      return;
    }
    this.clearTimer(entry.retryTimer);
    const nextRetryAt = new Date(this.now() + RETRY_INTERVAL_MS).toISOString();
    this.updateStatus(entry, 'retrying', {
      attempt: entry.attempt,
      nextRetryAt,
      expiresAt: new Date(entry.retryDeadline).toISOString(),
      lastError: error
    });
    entry.retryTimer = this.setTimer(() => {
      entry.connection = null;
      void this.attemptConnection(entry);
    }, RETRY_INTERVAL_MS);
  }

  expire(entry) {
    if (!this.isCurrent(entry)) return;
    entry.expired = true;
    this.clearTimer(entry.retryTimer);
    this.clearTimer(entry.deadlineTimer);
    entry.retryTimer = null;
    entry.deadlineTimer = null;
    const connection = entry.connection;
    entry.connection = null;
    entry.connected = false;
    this.reportAudience(entry.userId, null);
    this.updateStatus(entry, 'expired', {
      nextRetryAt: null,
      expiresAt: null
    });
    if (connection) {
      void connection.disconnect().catch(error => {
        console.error('Error cerrando la conexión TikTok expirada:', error);
      });
    }
  }

  isCurrent(entry) {
    return this.connections.get(entry.userId) === entry && !entry.expired;
  }

  updateStatus(entry, status, extra = {}) {
    const value = {
      accountId: entry.accountId,
      username: entry.username,
      status,
      attempt: entry.attempt,
      nextRetryAt: null,
      expiresAt: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      ...extra
    };
    this.saveStatus(entry.userId, value);
    this.onStatus(entry.userId, value);
  }
}

module.exports = {
  BROWSER_HEARTBEAT_TIMEOUT_MS,
  RETRY_INTERVAL_MS,
  RETRY_WINDOW_MS,
  TikTokConnectionManager,
  getAvatarUrl,
  getViewerCount
};
