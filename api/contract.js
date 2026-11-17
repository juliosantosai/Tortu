const EVENT_NAMES = new Set([
  'comment',
  'follow',
  'share',
  'like',
  'gift',
  'join',
  'reset',
  'winner'
]);

function validateIncomingEvent(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return 'El cuerpo debe ser un objeto JSON';
  }
  if (message.type !== 'event') return 'type debe ser "event"';
  if (!EVENT_NAMES.has(message.event)) return 'event no está permitido';
  if (message.user !== undefined &&
      (typeof message.user !== 'string' || message.user.length > 80)) {
    return 'user debe ser texto de hasta 80 caracteres';
  }
  if (message.username !== undefined &&
      (typeof message.username !== 'string' || message.username.length > 80)) {
    return 'username debe ser texto de hasta 80 caracteres';
  }
  if (message.platformEventId !== undefined &&
      (typeof message.platformEventId !== 'string' || message.platformEventId.length > 160)) {
    return 'platformEventId debe ser texto de hasta 160 caracteres';
  }
  if (message.message !== undefined &&
      (typeof message.message !== 'string' || message.message.length > 2_000)) {
    return 'message debe ser texto de hasta 2000 caracteres';
  }
  if (message.avatar !== undefined && message.avatar !== null) {
    if (typeof message.avatar !== 'string' || message.avatar.length > 2_048) {
      return 'avatar debe ser una URL HTTPS válida';
    }
    try {
      if (new URL(message.avatar).protocol !== 'https:') return 'avatar debe ser una URL HTTPS válida';
    } catch {
      return 'avatar debe ser una URL HTTPS válida';
    }
  }
  if (message.gift !== undefined &&
      (typeof message.gift !== 'string' || message.gift.length > 100)) {
    return 'gift debe ser texto de hasta 100 caracteres';
  }
  if (message.count !== undefined &&
      (!Number.isSafeInteger(message.count) || message.count < 1 || message.count > 1_000_000)) {
    return 'count debe ser un entero de 1 a 1000000';
  }
  if (message.occurredAt !== undefined &&
      (typeof message.occurredAt !== 'string' || Number.isNaN(Date.parse(message.occurredAt)))) {
    return 'occurredAt debe ser una fecha ISO válida';
  }
  return null;
}

module.exports = { EVENT_NAMES, validateIncomingEvent };
