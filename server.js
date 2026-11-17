const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const SERVER_ROLE = process.env.SERVER_ROLE || 'all';
if (!['all', 'api', 'web'].includes(SERVER_ROLE)) {
  throw new Error('SERVER_ROLE must be all, api, or web');
}

const database = SERVER_ROLE === 'web' ? {} : require('./api/database');
const credentials = SERVER_ROLE === 'web' ? {} : require('./api/credentials');
const contract = SERVER_ROLE === 'web' ? {} : require('./api/contract');
const { TikTokConnectionManager } = SERVER_ROLE === 'web'
  ? {}
  : require('./api/tiktok-connection-manager');
const {
  addTikTokAccount,
  deleteTikTokAccount,
  createOverlay,
  createUser,
  findOverlayById,
  findOverlayByPublicId,
  findOverlayByTokenHash,
  findUserByEmail,
  getSelectedTikTokAccount,
  getTikTokConnectionStatus,
  getTikTokAccountHistory,
  getOverlayEventSummary,
  getOverlayEvents,
  saveOverlayAudience,
  getOverlayForUser,
  getUserOverlays,
  listSpeedPresets,
  findSpeedPresetByName,
  createSpeedPreset,
  deleteSpeedPreset,
  advanceIdleRaces,
  logEvent,
  removeSession,
  resetLifetimeGifts,
  saveSession,
  selectTikTokAccount,
  saveTikTokConnectionStatus,
  setTikTokAccountAvatar,
  updateOverlayDisplaySettings,
  updateOverlaySpeedSettings,
  updateOverlayTeamSettings,
  updateOverlayName,
  getOverlayState,
} = database;
const {
  createSessionToken,
  hashToken,
  makePasswordHash,
  newOpaqueToken,
  verifyPassword
} = credentials;
const { validateIncomingEvent } = contract;

const ROOT = __dirname;
const WEB_ROOT = path.join(ROOT, 'webserver');
const HOST = process.env.HOST || process.env[SERVER_ROLE === 'api' ? 'API_HOST' : 'WEB_HOST'] || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env[SERVER_ROLE === 'api' ? 'API_PORT' : 'WEB_PORT'] || 8080);
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_COOKIE = 'tortulive_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'Lax';
const API_ALLOWED_ORIGINS = new Set(
  (process.env.API_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
);
const streams = new Map();
const DISPLAY_SETTING_KEYS = ['flags', 'donTortu', 'teamEvents', 'honor', 'progressBar'];
const SPEED_SETTING_KEYS = ['comment', 'like', 'likeTaps', 'share', 'follow'];
const loginAttempts = new Map();
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;

    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error('El cuerpo de la solicitud es demasiado grande'), { status: 413 }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('El cuerpo debe ser JSON válido'), { status: 400 }));
      }
    });
    req.on('error', error => {
      if (!settled) reject(error);
    });
  });
}

function getCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function sessionCookie(token, maxAge) {
  const secure = COOKIE_SECURE || COOKIE_SAME_SITE.toLowerCase() === 'none';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${COOKIE_SAME_SITE}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function originIsAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host === req.headers.host) return true;
    return API_ALLOWED_ORIGINS.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}

function addCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!originIsAllowed(req)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Vary', 'Origin');
  return true;
}

function getSession(req) {
  const token = getCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return saveSession.lookup(hashToken(token));
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Inicia sesión para continuar' });
    return null;
  }
  return session;
}

function checkRateLimit(req, res) {
  const now = Date.now();
  const key = req.socket.remoteAddress || 'unknown';
  const attempt = loginAttempts.get(key);
  if (!attempt || now >= attempt.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (attempt.count >= 20) {
    sendJson(res, 429, { error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' });
    return false;
  }
  attempt.count += 1;
  return true;
}

function writeSse(res, message) {
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

function publish(publicId, message) {
  const clients = streams.get(publicId);
  if (!clients) return;
  for (const res of clients) writeSse(res, message);
}

const tiktokConnections = SERVER_ROLE === 'web' ? null : new TikTokConnectionManager({
  saveStatus: saveTikTokConnectionStatus,
  onProfileUpdate: (account, avatarUrl) => {
    if (account.id) setTikTokAccountAvatar(account.userId || account.user_id, account.id, avatarUrl);
  },
  onAudience: async (userId, viewers) => {
    const overlay = getOverlayForUser(userId);
    if (!overlay) return;
    saveOverlayAudience(overlay.id, viewers);
    const audience = getOverlayEventSummary(overlay.id).audience;
    publish(overlay.public_id, { type: 'audience', audience });
  },
  onEvent: async (userId, payload) => {
    const overlay = getOverlayForUser(userId);
    if (!overlay) return;
    const logged = logEvent(overlay.id, payload);
    if (!logged.duplicate) {
      publish(overlay.public_id, {
        type: 'event',
        version: 1,
        sequence: logged.sequence,
        eventId: logged.eventId,
        ...logged.payload
      });
      publish(overlay.public_id, {
        type: 'race',
        version: 1,
        sequence: logged.sequence,
        state: logged.state
      });
    }
  }
});

function openStream(req, res, overlay) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  if (!streams.has(overlay.public_id)) streams.set(overlay.public_id, new Set());
  streams.get(overlay.public_id).add(res);
  writeSse(res, {
    type: 'snapshot',
    version: 1,
    overlay: { id: overlay.public_id, name: overlay.name },
    state: getOverlayState(overlay.id),
    sequence: overlay.sequence
  });

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = streams.get(overlay.public_id);
    if (!clients) return;
    clients.delete(res);
    if (clients.size === 0) streams.delete(overlay.public_id);
  });
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' || pathname.startsWith('/overlay/')
    ? '/index.html'
    : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    sendJson(res, 400, { error: 'Ruta inválida' });
    return;
  }
  const filePath = path.resolve(WEB_ROOT, `.${decodedPath}`);
  if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + path.sep)) {
    sendJson(res, 403, { error: 'Prohibido' });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(res, 404, { error: 'No encontrado' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', service: 'tortulive' });
    return true;
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    if (!checkRateLimit(req, res)) return true;
    const body = await readJson(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const overlayName = typeof body.overlayName === 'string' ? body.overlayName.trim().slice(0, 60) : 'Mi overlay';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      sendJson(res, 400, { error: 'Escribe un correo electrónico válido' });
      return true;
    }
    if (password.length < 12 || password.length > 200) {
      sendJson(res, 400, { error: 'La contraseña debe tener entre 12 y 200 caracteres' });
      return true;
    }
    if (findUserByEmail(email)) {
      sendJson(res, 409, { error: 'Ya existe una cuenta con ese correo' });
      return true;
    }

    const passwordCredentials = makePasswordHash(password);
    const user = createUser(email, passwordCredentials.salt, passwordCredentials.hash);
    const apiToken = newOpaqueToken('tl_live_');
    const overlay = createOverlay(user.id, overlayName || 'Mi overlay', hashToken(apiToken));
    const sessionToken = createSessionToken();
    saveSession.create(user.id, hashToken(sessionToken), Date.now() + SESSION_TTL_SECONDS * 1000);
    sendJson(res, 201, {
      user: { id: user.id, email: user.email },
      overlay: publicOverlay(overlay),
      apiToken
    }, { 'Set-Cookie': sessionCookie(sessionToken, SESSION_TTL_SECONDS) });
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    if (!checkRateLimit(req, res)) return true;
    const body = await readJson(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      sendJson(res, 401, { error: 'Correo o contraseña incorrectos' });
      return true;
    }
    const sessionToken = createSessionToken();
    saveSession.create(user.id, hashToken(sessionToken), Date.now() + SESSION_TTL_SECONDS * 1000);
    sendJson(res, 200, { user: { id: user.id, email: user.email } }, {
      'Set-Cookie': sessionCookie(sessionToken, SESSION_TTL_SECONDS)
    });
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const token = getCookies(req)[SESSION_COOKIE];
    if (token) removeSession(hashToken(token));
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    return true;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const session = requireSession(req, res);
    if (session) sendJson(res, 200, { user: { id: session.user_id, email: session.email } });
    return true;
  }

  if (url.pathname === '/api/dashboard/heartbeat' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    tiktokConnections.reportBrowserHeartbeat(
      session.user_id,
      getSelectedTikTokAccount(session.user_id)
    );
    sendJson(res, 200, { alive: true });
    return true;
  }

  if (url.pathname === '/api/overlays' && req.method === 'GET') {
    const session = requireSession(req, res);
    if (session) sendJson(res, 200, { overlays: getUserOverlays(session.user_id).map(publicOverlay) });
    return true;
  }

  if (url.pathname === '/api/speed-presets' && req.method === 'GET') {
    const session = requireSession(req, res);
    if (session) sendJson(res, 200, { presets: listSpeedPresets(session.user_id) });
    return true;
  }

  if (url.pathname === '/api/speed-presets' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    const body = await readJson(req);
    const validBody = body && typeof body === 'object' && !Array.isArray(body);
    const name = validBody && typeof body.name === 'string' ? body.name.trim() : '';
    const validSpeed = validBody && body.speed && typeof body.speed === 'object' &&
      !Array.isArray(body.speed) &&
      SPEED_SETTING_KEYS.every(key => Number.isSafeInteger(body.speed[key]) &&
        body.speed[key] >= 1 && body.speed[key] <= 1000) &&
      Object.keys(body.speed).every(key => SPEED_SETTING_KEYS.includes(key));
    if (!validBody || Object.keys(body).some(key => key !== 'name' && key !== 'speed') ||
        !name || name.length > 32 || !validSpeed) {
      sendJson(res, 400, { error: 'Indica un nombre de hasta 32 caracteres y una configuración de velocidad válida' });
      return true;
    }
    if (findSpeedPresetByName(session.user_id, name)) {
      sendJson(res, 409, { error: 'Ya existe un preset con ese nombre' });
      return true;
    }
    const preset = createSpeedPreset(session.user_id, name, body.speed);
    sendJson(res, 201, { preset });
    return true;
  }

  const speedPresetMatch = url.pathname.match(/^\/api\/speed-presets\/([a-f0-9-]{36})$/);
  if (speedPresetMatch && req.method === 'DELETE') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    if (!deleteSpeedPreset(session.user_id, speedPresetMatch[1])) {
      sendJson(res, 404, { error: 'Preset no encontrado' });
      return true;
    }
    sendJson(res, 200, { deleted: true });
    return true;
  }

  if (url.pathname === '/api/tiktok/accounts' && req.method === 'GET') {
    const session = requireSession(req, res);
    if (session) {
      sendJson(res, 200, {
        accounts: getTikTokAccountHistory(session.user_id),
        selected: getSelectedTikTokAccount(session.user_id),
        status: getTikTokConnectionStatus(session.user_id)
      });
    }
    return true;
  }

  if (url.pathname === '/api/tiktok/accounts/refresh' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    const accounts = getTikTokAccountHistory(session.user_id);
    const statuses = await tiktokConnections.refreshAccountStatuses(accounts);
    sendJson(res, 200, { statuses });
    return true;
  }

  if (url.pathname === '/api/tiktok/accounts' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    const body = await readJson(req);
    const username = typeof body.username === 'string'
      ? body.username.trim().replace(/^@/, '')
      : '';
    if (!/^[\p{L}\p{N}._]{2,24}$/u.test(username)) {
      sendJson(res, 400, { error: 'Escribe un usuario de TikTok válido (2–24 letras, números, puntos o guiones bajos)' });
      return true;
    }
    const account = addTikTokAccount(session.user_id, username);
    tiktokConnections.reportBrowserHeartbeat(session.user_id, account);
    sendJson(res, 201, {
      account,
      accounts: getTikTokAccountHistory(session.user_id),
      selected: getSelectedTikTokAccount(session.user_id),
      status: getTikTokConnectionStatus(session.user_id)
    });
    return true;
  }

  const deleteTikTokAccountMatch = url.pathname.match(/^\/api\/tiktok\/accounts\/([a-f0-9-]{36})$/);
  if (deleteTikTokAccountMatch && req.method === 'DELETE') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    const accountId = deleteTikTokAccountMatch[1];
    if (!getTikTokAccountHistory(session.user_id).some(account => account.id === accountId)) {
      sendJson(res, 404, { error: 'El perfil no está en el historial de esta cuenta' });
      return true;
    }
    if (getSelectedTikTokAccount(session.user_id)?.id === accountId) {
      await tiktokConnections.stopUser(session.user_id);
    }
    deleteTikTokAccount(session.user_id, accountId);
    sendJson(res, 200, {
      deleted: true,
      accounts: getTikTokAccountHistory(session.user_id),
      selected: getSelectedTikTokAccount(session.user_id),
      status: getTikTokConnectionStatus(session.user_id)
    });
    return true;
  }

  if (url.pathname === '/api/tiktok/status' && req.method === 'GET') {
    const session = requireSession(req, res);
    if (session) {
      const selected = getSelectedTikTokAccount(session.user_id);
      sendJson(res, 200, {
        status: getTikTokConnectionStatus(session.user_id) || {
          username: selected?.username || null,
          status: 'disconnected',
          attempt: 0,
          next_retry_at: null,
          expires_at: null,
          last_error: null
        }
      });
    }
    return true;
  }

  if (url.pathname === '/api/tiktok/connect' && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    const account = getSelectedTikTokAccount(session.user_id);
    if (!account) {
      sendJson(res, 409, { error: 'Selecciona primero un perfil de TikTok' });
      return true;
    }
    tiktokConnections.reportBrowserHeartbeat(session.user_id, account);
    sendJson(res, 202, { accepted: true });
    return true;
  }

  const tiktokAccountMatch = url.pathname.match(/^\/api\/tiktok\/accounts\/([a-f0-9-]{36})\/select$/);
  if (tiktokAccountMatch && req.method === 'POST') {
    if (!originIsAllowed(req)) {
      sendJson(res, 403, { error: 'Origen no permitido' });
      return true;
    }
    const session = requireSession(req, res);
    if (!session) return true;
    const account = selectTikTokAccount(session.user_id, tiktokAccountMatch[1]);
    if (!account) {
      sendJson(res, 404, { error: 'El perfil no está en el historial de esta cuenta' });
      return true;
    }
    tiktokConnections.reportBrowserHeartbeat(session.user_id, account);
    sendJson(res, 200, {
      account,
      accounts: getTikTokAccountHistory(session.user_id),
      selected: getSelectedTikTokAccount(session.user_id),
      status: getTikTokConnectionStatus(session.user_id)
    });
    return true;
  }

  const overlayMatch = url.pathname.match(/^\/api\/overlays\/([a-f0-9-]{36})(?:\/(rotate-token|events|events\/clear|events\/summary|events\/reset-counters|lifetime-gifts\/reset|display-settings|speed-settings|team-settings))?$/);
  if (overlayMatch) {
    const [, overlayId, action] = overlayMatch;
    if (action === 'lifetime-gifts/reset' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      resetLifetimeGifts(overlay.id);
      const summary = getOverlayEventSummary(overlay.id);
      publish(overlay.public_id, { type: 'lifetime_gifts_reset', summary });
      sendJson(res, 200, { reset: true, summary });
      return true;
    }

    if (action === 'display-settings' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      const body = await readJson(req);
      if (!body.settings || typeof body.settings !== 'object' ||
          Array.isArray(body.settings) ||
          DISPLAY_SETTING_KEYS.some(key => typeof body.settings[key] !== 'boolean') ||
          Object.keys(body.settings).some(key => !DISPLAY_SETTING_KEYS.includes(key))) {
        sendJson(res, 400, { error: 'La configuración visual no es válida' });
        return true;
      }
      const state = updateOverlayDisplaySettings(overlay.id, body.settings);
      publish(overlay.public_id, { type: 'display_settings', settings: state.displaySettings });
      sendJson(res, 200, { settings: state.displaySettings });
      return true;
    }

    if (action === 'speed-settings' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      const body = await readJson(req);
      if (!body.speed || typeof body.speed !== 'object' ||
          Array.isArray(body.speed) ||
          SPEED_SETTING_KEYS.some(key => !Number.isSafeInteger(body.speed[key]) ||
            body.speed[key] < 1 || body.speed[key] > 1000) ||
          Object.keys(body.speed).some(key => !SPEED_SETTING_KEYS.includes(key))) {
        sendJson(res, 400, { error: 'La configuración de velocidad debe contener valores enteros de 1 a 1000' });
        return true;
      }
      const state = updateOverlaySpeedSettings(overlay.id, body.speed);
      publish(overlay.public_id, { type: 'speed_settings', speed: state.speed });
      sendJson(res, 200, { speed: state.speed });
      return true;
    }

    if (action === 'team-settings' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      const body = await readJson(req);
      if (!body.teams || typeof body.teams !== 'object' ||
          Array.isArray(body.teams) ||
          Object.keys(body.teams).length !== 2 ||
          !['1', '2'].every(id =>
            body.teams[id] &&
            typeof body.teams[id] === 'object' &&
            !Array.isArray(body.teams[id]) &&
            typeof body.teams[id].name === 'string' &&
            body.teams[id].name.trim().length > 0 &&
            body.teams[id].name.trim().length <= 14 &&
            (body.teams[id].flag === null ||
              (typeof body.teams[id].flag === 'string' &&
                body.teams[id].flag.length <= 2048 &&
                /^[A-Za-z0-9 #.,:;|_*+-]+$/.test(body.teams[id].flag))) &&
            Object.keys(body.teams[id]).every(key => key === 'name' || key === 'flag') &&
            Object.keys(body.teams[id]).includes('name') &&
            Object.hasOwn(body.teams, id))) {
        sendJson(res, 400, { error: 'La configuración debe incluir nombres válidos y banderas seguras para los equipos 1 y 2' });
        return true;
      }
      const teams = updateOverlayTeamSettings(overlay.id, {
        '1': { name: body.teams['1'].name.trim().toUpperCase(), flag: body.teams['1'].flag || null },
        '2': { name: body.teams['2'].name.trim().toUpperCase(), flag: body.teams['2'].flag || null }
      });
      publish(overlay.public_id, { type: 'team_settings', teams });
      sendJson(res, 200, { teams });
      return true;
    }

    if (action === 'events/reset-counters' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      database.resetOverlayEventCounters(overlay.id);
      const summary = getOverlayEventSummary(overlay.id);
      publish(overlay.public_id, { type: 'counters_reset', summary });
      publish(overlay.public_id, {
        type: 'race',
        version: 1,
        sequence: summary.sequence,
        state: getOverlayState(overlay.id)
      });
      sendJson(res, 200, { reset: true, summary });
      return true;
    }

    if (action === 'events/summary' && req.method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      sendJson(res, 200, getOverlayEventSummary(overlay.id));
      return true;
    }

    if (action === 'events/clear' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      const deleted = database.clearOverlayEvents(overlay.id);
      const summary = getOverlayEventSummary(overlay.id);
      publish(overlay.public_id, { type: 'event_history_cleared', summary });
      sendJson(res, 200, { cleared: true, deleted });
      return true;
    }

    if (action === 'events' && req.method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      const requestedLimit = Number(url.searchParams.get('limit') || 50);
      const requestedBefore = Number(url.searchParams.get('before'));
      const limit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 100
        ? requestedLimit
        : null;
      const before = url.searchParams.has('before') &&
        Number.isSafeInteger(requestedBefore) && requestedBefore > 0
        ? requestedBefore
        : Number.MAX_SAFE_INTEGER;
      if (!limit || (url.searchParams.has('before') && before === Number.MAX_SAFE_INTEGER)) {
        sendJson(res, 400, { error: 'Paginación de eventos inválida' });
        return true;
      }
      const events = getOverlayEvents(overlay.id, before, limit);
      sendJson(res, 200, {
        events,
        hasMore: events.length === limit,
        nextBefore: events.length ? events[events.length - 1].sequence : null
      });
      return true;
    }

    if (action === 'events' && req.method === 'POST') {
      const body = await readJson(req);
      const eventError = validateIncomingEvent(body);
      if (eventError) {
        sendJson(res, 400, { error: eventError });
        return true;
      }
      const token = (req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
      const overlay = token ? findOverlayByTokenHash(overlayId, hashToken(token)) : null;
      if (!overlay) {
        sendJson(res, 401, { error: 'Credencial del overlay inválida' });
        return true;
      }
      const logged = logEvent(overlay.id, body);
      if (!logged.duplicate) {
        const message = {
          type: 'event',
          version: 1,
          sequence: logged.sequence,
          eventId: logged.eventId,
          ...logged.payload
        };
        publish(overlay.public_id, message);
        publish(overlay.public_id, {
          type: 'race',
          version: 1,
          sequence: logged.sequence,
          state: logged.state
        });
      }
      sendJson(res, logged.duplicate ? 200 : 202, {
        accepted: true,
        duplicate: logged.duplicate,
        sequence: logged.sequence
      });
      return true;
    }

    if (action === 'rotate-token' && req.method === 'POST') {
      if (!originIsAllowed(req)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return true;
      }
      const session = requireSession(req, res);
      if (!session) return true;
      const overlay = findOverlayById(overlayId, session.user_id);
      if (!overlay) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return true;
      }
      const apiToken = newOpaqueToken('tl_live_');
      updateOverlayName.rotateToken(overlayId, hashToken(apiToken));
      sendJson(res, 200, { apiToken });
      return true;
    }
  }

  const publicStreamMatch = url.pathname.match(/^\/api\/public\/([a-f0-9]+)\/stream$/);
  if (publicStreamMatch && req.method === 'GET') {
    const overlay = findOverlayByPublicId(publicStreamMatch[1]);
    if (!overlay) {
      sendJson(res, 404, { error: 'Overlay no encontrado' });
      return true;
    }
    openStream(req, res, overlay);
    return true;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Ruta API no encontrada' });
    return true;
  }
  return false;
}

function publicOverlay(overlay) {
  const state = JSON.parse(overlay.state_json);
  return {
    id: overlay.id,
    publicId: overlay.public_id,
    name: overlay.name,
    speed: state.speed || { comment: 1, like: 1, likeTaps: 15, share: 3, follow: 10 },
    teams: {
      '1': { name: state.teams?.['1']?.name || 'OLIMPIA', flag: state.teams?.['1']?.flag || null },
      '2': { name: state.teams?.['2']?.name || 'CERRO', flag: state.teams?.['2']?.flag || null }
    },
    displaySettings: state.displaySettings || {
      flags: true,
      donTortu: true,
      teamEvents: true,
      honor: true,
      progressBar: true
    },
    createdAt: overlay.created_at,
    sequence: overlay.sequence
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const isApiRequest = url.pathname.startsWith('/api/');
    if (SERVER_ROLE !== 'web' && isApiRequest) {
      if (!addCorsHeaders(req, res)) {
        sendJson(res, 403, { error: 'Origen no permitido' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const handled = await handleApi(req, res, url);
      if (handled) return;
    } else if (isApiRequest) {
      sendJson(res, 404, { error: 'La API está en el servidor independiente' });
      return;
    }

    if (SERVER_ROLE === 'api') {
      sendJson(res, 404, { error: 'El sitio web está en el servidor independiente' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Método no permitido' });
      return;
    }
    if (url.pathname.startsWith('/overlay/')) {
      const publicId = url.pathname.slice('/overlay/'.length);
      if (!/^[a-f0-9]{24}$/.test(publicId) ||
          (SERVER_ROLE !== 'web' && !findOverlayByPublicId(publicId))) {
        sendJson(res, 404, { error: 'Overlay no encontrado' });
        return;
      }
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    sendJson(res, error.status || 500, {
      error: error.status ? error.message : 'Error interno del servidor'
    });
    if (!error.status) console.error(error);
  }
});

const idleRaceTimer = SERVER_ROLE === 'web' ? null : setInterval(() => {
  try {
    for (const update of advanceIdleRaces()) {
      if (update.raceReset) {
        publish(update.publicId, { type: 'counters_reset' });
      }
      publish(update.publicId, {
        type: 'race',
        version: 1,
        sequence: update.sequence,
        state: update.state
      });
    }
  } catch (error) {
    console.error('No se pudo actualizar el reloj de inactividad:', error);
  }
}, 1000);

server.listen(PORT, HOST, () => {
  console.log(`Tortulive ${SERVER_ROLE} listo en http://localhost:${PORT}`);
  if (SERVER_ROLE !== 'web') {
    console.log(`Base SQLite: ${process.env.DB_PATH || path.join(ROOT, 'data', 'tortulive.sqlite')}`);
  }
});

async function shutdown() {
  if (idleRaceTimer) clearInterval(idleRaceTimer);
  if (tiktokConnections) await tiktokConnections.stopAll();
  for (const clients of streams.values()) {
    for (const res of clients) res.end();
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
