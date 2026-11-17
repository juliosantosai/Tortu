# CONTRATO DEL WEBSERVER · Tortulive

Este es el contrato único de Tortulive: describe el dashboard, el overlay y las estructuras HTTP/SSE de la API.
Debe actualizarse cuando cambie un mensaje, endpoint, regla de negocio o comportamiento visible.

La API es la fuente de verdad para equipos, metros, ganador, copas y carrera. El overlay solo representa el estado
recibido. El código inline de `index.html` se limita al ajuste del escenario y controles locales; la coordinación
SSE, los mensajes a iframes, visibilidad y reproducción de estado viven en `overlay-coordinator.js`.

## 0. Integración vigente

- `state.race.authority` es `"server"`; el `game-core.js` compartido desactiva su cálculo local al recibir autoridad
  del servidor. `race` y `snapshot` llevan metros absolutos, nombres, banderas, copas y temporizadores.
- El dashboard persiste velocidad por overlay mediante `POST /api/overlays/:id/speed-settings`; los presets son
  compartidos por cuenta y usan `GET|POST /api/speed-presets` y `DELETE /api/speed-presets/:id`.
- La actividad que inicia o reinicia el reloj es comment, like, follow, share o gift. La API inicia avance aleatorio
  independiente para cada equipo después de 10 segundos sin actividad y finaliza por inactividad a los 60 segundos.
  Un gol durante ese avance termina la carrera sin sumar copa.
- El dashboard muestra equipos, duración de la carrera, duración de la sesión del navegador y segundos restantes,
  actualizados por SSE y un reloj de presentación local.
- Las respuestas y validaciones exactas, incluyendo campos de carrera y formatos de presets, están en la sección 12.

---

## 1. Visión general

```
TikTok LIVE ──► API ──► /api/public/<publicId>/stream  (SSE)
                         │
                         ├──► overlay (index.html) ──postMessage──► 18 capas (iframes)
                         │                                          └─ cada capa ejecuta game-core.js
                         └──► dashboard.html (contadores, eventos, ajustes)

dashboard.html ──► /api/... (HTTP, con cookie de sesión) ──► API
```

- El **overlay** es lo que ve el público y lo que captura OBS. Es de **solo lectura**: recibe eventos y dibuja.
- El **dashboard** es el panel privado del streamer: sesión, perfil de TikTok, ajustes visibles, **velocidad**,
  eventos, credenciales.
- El webserver **no tiene backend propio**: son archivos estáticos servidos desde el mismo origen que la API.
  Toda la persistencia vive en la API (salvo unos pocos datos locales del navegador, sección 9).
- **Quién decide qué:** la API valida y calcula la carrera y sus metros; el dashboard guarda preferencias, y el
  overlay anima el estado recibido.

## 2. Estructura de archivos

| Archivo | Función |
|---|---|
| `index.html` | Overlay: escenario 1080×1920, carga las capas, abre el stream SSE y reparte los mensajes a las capas. |
| `overlay-coordinator.js` | SSE, difusión `postMessage`, visibilidad, ajuste de layout y replay para iframes que cargan tarde. |
| `dashboard.html` | Panel privado (registro/login, perfil TikTok, ajustes del overlay, velocidad, eventos, credencial). |
| `config.html` | Redirige a `dashboard.html`. |
| `api-config.js` | Define `window.TORTULIVE_API_BASE_URL` (vacío = API en el mismo origen). |
| `layers/*.html` | Las capas del overlay (sección 4). |
| `layers/game-core.js` | **Núcleo del juego**, compartido por todas las capas (sección 6). |
| `layers/progress-controller.js`, `layers/turtle-controller.js` | Controladores compartidos por las dos capas de progreso y las dos tortugas. |
| `layers/flags.js`, `flag-picker.js` | Catálogo de banderas SVG y selector de bandera/nombre de equipo. |
| `scene-picker.js` | Selector de fondo/escenario. |
| `service-worker.js`, `manifest.webmanifest`, `assets/` | PWA instalable (red primero, caché de respaldo). Subir `CACHE_NAME` al cambiar archivos del shell. |

## 3. Dashboard

### 3.1 Secciones

| Sección | Qué hace |
|---|---|
| Acceso (registro / login) | Crea cuenta o inicia sesión; mantiene la sesión por cookie. |
| Contadores de eventos | Cuenta por tipo (comment, follow, share, like, gift, join…) y total de regalos permanente. |
| Audiencia en vivo | Actual, pico, promedio y muestras. |
| Usuario monitoreado / URL del overlay | Perfil TikTok seleccionado, estado de conexión y URL pública del overlay. |
| Partido | Equipos, duración desde el primer evento calificable, reloj de inactividad y estado final. |
| **Partes visibles del overlay** | Casillas (banderas, Don Tortu, eventos de equipo, Gracias, barra de progreso), fondo, bandera/nombre de equipos, modo demo y **vista previa** (iframe del overlay). |
| **🐢 Velocidad de la tortuga** | Metros por evento y presets compartidos por cuenta (sección 7). |
| Eventos recibidos | Historial filtrable, paginado, descarga CSV, limpiar historial. |
| Administrar perfiles y opciones | Agregar/cambiar perfil TikTok, credencial de eventos (clave), ejemplo de backend. |

### 3.2 Endpoints de la API que usa el dashboard

Formatos de petición/respuesta: **ver la sección 12.2**. Todas las llamadas usan `credentials: 'include'`
(cookie) y `Content-Type: application/json`.

**Endpoints usados por el dashboard:**

| Método | Endpoint | Para qué |
|---|---|---|
| GET | `/api/overlays` | Overlay(s) de la cuenta (`id`, `publicId`, `displaySettings`…). |
| GET | `/api/overlays/:id/events/summary` | Resumen/contadores de eventos. |
| GET | `/api/overlays/:id/events?limit&before` | Historial paginado. |
| POST | `/api/overlays/:id/events/clear` | Limpiar historial. |
| POST | `/api/overlays/:id/events/reset-counters` | Reiniciar contadores (la API emite `counters_reset`). |
| POST | `/api/overlays/:id/lifetime-gifts/reset` | Borrar total permanente de regalos. |
| POST | `/api/overlays/:id/display-settings` | Guardar las **5 casillas booleanas** (ninguna otra clave; la API responde `400`). |
| POST | `/api/overlays/:id/speed-settings` | Guardar y publicar velocidad del overlay. |
| POST | `/api/overlays/:id/team-settings` | Guardar nombres y banderas. |
| GET / POST | `/api/speed-presets` | Listar y guardar presets de la cuenta. |
| DELETE | `/api/speed-presets/:id` | Eliminar preset de la cuenta. |
| GET (SSE) | `/api/public/:publicId/stream` | Flujo en vivo (con `withCredentials`). |

**No lo llama el webserver:** `POST /api/overlays/:id/events` (solo se muestra como ejemplo para el backend del
streamer; usa la clave privada, que **nunca** va en el HTML público).

### 3.3 Mensajes del stream que consume el dashboard

El dashboard usa `snapshot`, `race`, `team_settings`, `speed_settings`, `display_settings`, `counters_reset`,
`event_history_cleared`, `audience`, `lifetime_gifts_reset` y `event` (con `sequence`).

## 4. Overlay: capas

`index.html` dibuja un escenario fijo de **1080×1920** escalado a la ventana. Cada capa es un `<iframe>` con el mismo
tamaño; dibujan sobre un **tablero de 316×562 unidades** (factor 3.4177). Orden de apilado (`z-index`):

| z | Capa | Qué hace | Lee |
|---|---|---|---|
| 1 | `fondo` | Marco, tarjetas de equipo y 5 escenarios de fondo (0 = madera). | escena |
| 2 | `pista` | Carriles, marcas 0–100 m, medidor. | progreso |
| 2 | `ruta` | Camino, huellas e hitos 25/50/75/100 m. | progreso |
| 3 | `meta` | Línea de llegada, rótulo META y contadores por equipo (comentarios, compartidos, likes, regalos). | stats |
| 4–5 | `progreso-1/2` | Barra `n/100` y chapa GRACIAS de cada equipo. | progreso |
| 6–7 | `bandera-1/2` | Escudo, nombre del equipo y **copas**. | nombres, copas |
| 8–9 | `tortuga-1/2` | La tortuga de cada equipo; su posición = progreso. Obedece las órdenes de `regalos`. | progreso, `tortulive-fx` |
| 10 | `eventos-ruta` | Burbujas de eventos con avatar sobre el carril. | eventos, cambios de equipo |
| 10 | `don-tortu` | Avatar decorativo. | — |
| 11 | `alertas` | Alerta de evento (oculta por defecto). | — |
| 12 | `agradecimiento` | Placa «Gracias» (oculta por defecto). | — |
| 13 | `contadores` | Contador de eventos de cada equipo. | stats |
| 14 | `ganador` | Corona del líder y banner WINNER. | progreso, ganador |
| 15 | `iconos` | Insignia VS. | — |
| 16 | **`regalos`** | Coreografía del regalo y **llegada a la meta** (sección 8). | eventos `gift`, estado |

Zonas de clic en el overlay privado: pie (abre el dashboard), esquina superior derecha (**simula un regalo**),
esquina superior izquierda (cerrar sesión). En el overlay público (`/overlay/<publicId>`) solo queda el pie.
El overlay público se reconoce por la ruta `/overlay/<24 hex>` (petición R8).

## 5. Comunicación entre piezas

### 5.1 Canal `tortulive` (overlay → capas)

`overlay-coordinator.js` recibe el SSE y reenvía cada mensaje a las capas:

```js
layer.contentWindow.postMessage({ channel: 'tortulive', message }, location.origin)
```

Las capas ignoran cualquier mensaje con otro origen o canal. Mensajes que el webserver entiende:

| `message.type` | ¿Lo publica la API hoy? | Qué hace |
|---|---|---|
| `snapshot` | Sí | Estado inicial autoritativo: carrera, equipos, velocidad y `displaySettings`. |
| `event` | Sí | Evento validado y asignado a equipo, con `sequence`; el API calcula el progreso. |
| `race` | Sí | Estado absoluto actualizado, incluido el reloj de inactividad. |
| `display_settings` | Sí | Nuevas casillas visibles (`settings`). |
| `speed_settings` | Sí | Actualiza velocidad usada para eventos posteriores. |
| `team_settings` | Sí | Actualiza nombres y banderas. |
| `counters_reset` | Sí | Reinicia contadores y carrera según la API. |
| `audience`, `lifetime_gifts_reset`, `event_history_cleared` | Sí | Las usa el dashboard; las capas las ignoran. |
| `scene` | No (local) | Cambia el escenario de fondo (solo del navegador). |

Al cargar tarde un iframe, el coordinador reproduce los últimos mensajes de estado y reaplica visibilidad y layout.
El coordinador y las capas validan origen/canal antes de reenviar o procesar mensajes.

### 5.2 Canal `tortulive-fx` (capa regalos → capas)

`regalos.html` dirige la coreografía y emite a **todos** los frames del overlay:

| `fx` | Quién obedece | Efecto |
|---|---|---|
| `eat` (`team`, `scale`) | tortuga del equipo | Se come el regalo y crece. |
| `run` (`team`, `user`, `avatar`, `pEnd`) | tortuga del equipo | Corre hacia la meta con el avatar del donante. |
| **`arrive`** (`team`) | tortuga del equipo **y `game-core.js` de todas las capas** | Llegó: la tortuga celebra y el equipo llega a la meta (sección 8). |
| `end` (`team`) | tortuga del equipo | Vuelve a su tamaño normal, ya en su posición real. |

### 5.3 Otros canales locales

- `BroadcastChannel('tortulive-scene')` + `localStorage`: el selector de fondo avisa a la capa `fondo`.
- Evento `storage` del navegador: sincroniza banderas/copas/velocidad entre capas del mismo navegador.
- Parámetros de URL del overlay: `?demo=1` (carrera simulada, ignora metros reales), `?fondo=N` (escenario).

## 6. Núcleo del juego (`layers/game-core.js`)

Lo carga **cada capa** y mantiene una copia idéntica del estado a partir de los mismos mensajes
(`TortuGame.onState`, `onStats`, `onSwitch`, `onScene`, `get`, `userTeam`, `assign`, `speed`, `meters`, `reachGoal`).

- **Una carrera:** dos equipos; la API define la meta mediante `race.maxMeters` (100 m por defecto).
  Estado: `{ teams:[{name, p(0..1), count, cups}×2], winner:-1|0|1 }`; `count` = metros; `p = count/100`.
  Equipos `"1"`/`"2"` de la API = índices 0/1.
- **Autoridad:** con `race.authority === "server"`, progreso, ganador y copas se leen del estado absoluto recibido.
  Las reglas locales solo se usan en preview antes de recibir estado autoritativo.
- **Capas compartidas:** `progress-controller.js` sirve las dos barras y `turtle-controller.js` las dos tortugas;
  `game-core.js` normaliza estado para todas las capas.
- **Fin de carrera:** las capas presentan `race.status`, `winnerTeam` y copas de la API; no los calculan localmente.

## 7. Velocidad de la tortuga (metros por evento)

### 7.1 Reglas por defecto (editables en el dashboard)

| Evento | Metros | Campo `speed` |
|---|---|---|
| 💬 Comentario | 1 m por comentario | `comment` |
| ❤️ Like / tap | cada **15 taps = 1 m** | `likeTaps` = 15, `like` = 1 |
| ↗️ Compartir | 3 m | `share` |
| 👤 Seguir | 10 m | `follow` |
| 🎁 Regalo | **llega a la meta** (no suma metros; sección 8) | — (no configurable) |
| join / reset / winner | no suman metros | — |

- **Mínimo 1** en todos los campos (menor, vacío o no numérico = valor por defecto; máximo 1000).
- Los taps que no completan un grupo se **acumulan** por equipo.
- La meta viene de `race.maxMeters` (100 m por defecto).

### 7.2 Persistencia y presets

```
Dashboard ─► POST /api/overlays/:id/speed-settings ─► API ─► snapshot/SSE ─► overlay
Cuenta ─► GET|POST /api/speed-presets; DELETE /api/speed-presets/:id
```

La velocidad se guarda en la API por overlay; al aplicar un preset, el dashboard también persiste esa velocidad
en el overlay seleccionado. Los presets pertenecen a la cuenta. Los errores de persistencia se muestran y no se
confirman como un guardado exitoso.

## 8. Regalo → la tortuga llega a la meta

El evento `gift` ya está definido en la capa `regalos`. Flujo:

`regalos.html` presenta la animación del regalo y la carrera. Los eventos y el avance autoritativo llegan de la API;
la finalización real ocurre cuando la API publica `race.status: "finished"`. Solo la API actualiza copas. El clic de
simulación es una prueba visual local, no una operación que cambie el estado persistido del servidor.

## 9. Datos locales del navegador (`localStorage`)

| Clave | Contenido | Quién escribe |
|---|---|---|
| `tortulive.speed` | Caché local de velocidad para la vista previa. | dashboard y capas |
| `tortulive.meters.v1` | Progreso local solo antes de recibir estado autoritativo. | capas |
| `tortulive.cups.v1` / `tortulive.cups.seq` | Caché local previo a autoridad del servidor. | capas |
| `tortulive.flags` | Caché del selector; el dashboard persiste ajustes en la API. | selector de bandera |
| `tortulive.scene` | Escenario de fondo. | selector de fondo |

Son datos **por navegador**: el dashboard y OBS no los comparten. Lo que deba ser común va por la API.

## 10. Ajustes visibles (`displaySettings`)

Exactamente **5 claves booleanas** (todas obligatorias al guardar; cualquier otra clave o valor no booleano → `400`):
`flags` (banderas), `donTortu`, `teamEvents` (eventos de cada equipo), `honor` (Gracias), `progressBar` (barra de
progreso). `false` oculta la capa y el overlay **alarga la pista** con el espacio liberado (`--ext`, `--hdr`).
La velocidad **no** forma parte de `displaySettings`.

## 11. Coordinación con la API

**Cambiar solo el webserver (sin avisar a la API):** estilos, animaciones, nuevas capas decorativas, textos,
reglas de metros que no cambian formatos.

**Requiere coordinar con la API y actualizar este contrato:**
- Nuevo tipo de mensaje del stream o nuevo campo en `snapshot`/`event`.
- Cambiar o añadir claves en `displaySettings` (la API rechaza claves desconocidas).
- Nuevo endpoint o cambio de ruta, método, cookie/credenciales o formato de `publicId`.
- Cambios de reglas o campos de carrera, presets, movimiento por inactividad o ganador/copas.
- Cualquier cambio de `version` en mensajes.

**Antes de cambiar, revisa:** (1) este contrato, (2) `game-core.js` si toca estado o metros, (3) subir
`CACHE_NAME` en `service-worker.js` si cambias archivos del shell.

## 12. Contrato HTTP y SSE de la API

### 12.1 Conexión y credenciales

- El dashboard, la API y el overlay público pueden servirse desde el mismo origen. También se pueden desplegar por
  separado si se configura `TORTULIVE_API_BASE_URL` y se permite el origen del frontend en `API_ALLOWED_ORIGINS`.
- URL pública del overlay para OBS: `https://<dominio>/overlay/<publicId>`. El `publicId` permite consultar el
  snapshot y el stream; tratar la URL como pública.
- El overlay recibe actualizaciones por Server-Sent Events (SSE): `GET /api/public/<publicId>/stream`.
- Un servicio emisor registra eventos con `POST /api/overlays/<overlayId>/events` y la credencial privada del
  overlay en `Authorization: Bearer <apiToken>`. Nunca incluir esa credencial en el HTML público.
- Los ajustes administrativos requieren sesión en cookie `HttpOnly`; el endpoint valida que el overlay pertenezca
  a esa cuenta. Las solicitudes con origen no permitido se rechazan.

### 12.2 Endpoints administrativos

Todas las llamadas del dashboard incluyen `credentials: 'include'` y `Content-Type: application/json`.

| Método y ruta | Cuerpo | Respuesta / efecto |
|---|---|---|
| `GET /api/overlays` | — | `{ "overlays": [...] }`; cada elemento incluye `id`, `publicId`, `name`, `teams`, `speed`, `displaySettings`, `createdAt` y `sequence`. |
| `POST /api/overlays/<id>/display-settings` | `{ "settings": { "flags": true, "donTortu": true, "teamEvents": true, "honor": true, "progressBar": true } }` | `200 { "settings": ... }`; publica `display_settings`. Deben venir las cinco claves booleanas exactas. |
| `POST /api/overlays/<id>/speed-settings` | `{ "speed": { "comment": 1, "like": 1, "likeTaps": 15, "share": 3, "follow": 10 } }` | `200 { "speed": ... }`; publica `speed_settings`. Valores enteros de 1 a 1000 y claves exactas. |
| `POST /api/overlays/<id>/team-settings` | `{ "teams": { "1": { "name": "OLIMPIA", "flag": null }, "2": { "name": "CERRO", "flag": null } } }` | `200 { "teams": ... }`; persiste y publica `team_settings`. Nombres de 1–14 caracteres. `flag` es `null` o una especificación SVG del selector limitada a 2048 caracteres y a caracteres seguros. |
| `GET /api/speed-presets` | — | `{ "presets": [...] }`; lista los presets de velocidad de la cuenta autenticada. |
| `POST /api/speed-presets` | `{ "name": "Rápido", "speed": { ... } }` | `201 { "preset": ... }`; nombre único por cuenta, hasta 32 caracteres; velocidad validada como arriba. |
| `DELETE /api/speed-presets/<id>` | — | `{ "deleted": true }`; elimina solo un preset de la cuenta autenticada. |
| `POST /api/overlays/<id>/events/reset-counters` | — | Reinicia contadores de eventos, estadísticas pico/promedio de audiencia y estado de carrera; conserva historial, audiencia actual, copas y velocidad. Publica `counters_reset` y un `race` con estado actual. |
| `POST /api/overlays/<id>/lifetime-gifts/reset` | — | Reinicia solo el total acumulado de regalos; conserva historial. |
| `POST /api/overlays/<id>/events/clear` | — | Borra el historial; no reinicia la secuencia ni la carrera. |
| `GET /api/overlays/<id>/events/summary` | — | Devuelve contadores, regalos acumulados, audiencia y secuencia. |
| `GET /api/overlays/<id>/events?limit=50&before=<sequence>` | — | Historial paginado; `limit` admite 1–100. |

Las rutas administrativas requieren sesión. Falta de sesión: `401`; overlay ajeno o inexistente: `404`; cuerpo
inválido: `400`; error JSON: `{ "error": "..." }`.

### 12.3 Ingreso y procesamiento de eventos

El endpoint `POST /api/overlays/<overlayId>/events` requiere `Content-Type: application/json` y la credencial
privada como `Bearer`:

```json
{
  "type": "event",
  "event": "comment",
  "user": "nombre_usuario",
  "username": "usuario_unico",
  "message": "Arriba Olimpia",
  "platformEventId": "id-unico-en-la-plataforma",
  "occurredAt": "2026-11-16T20:00:00.000Z",
  "avatar": "https://example.test/avatar.jpg",
  "gift": "Rosa",
  "count": 1
}
```

- `event` admite `comment`, `follow`, `share`, `like`, `gift`, `join`, `reset` y `winner`.
- Campos opcionales: `user` y `username` son texto de hasta 80 caracteres; `message`, hasta 2000; `gift`, hasta
  100; `platformEventId`, hasta 160; `count`, entero de 1 a 1 000 000; `avatar`, URL HTTPS de hasta 2048
  caracteres; `occurredAt`, texto que pueda interpretarse como fecha. Los campos inválidos producen `400`.
- La asignación se resuelve en servidor. El `teamId` enviado por el emisor no es autoritativo.
- Identidad de participante: `username` o, si falta, `user`, normalizados sin `@` inicial y sin distinguir
  mayúsculas/minúsculas. El primer equipo se asigna de forma estable. Un comentario que menciona inequívocamente
  el nombre de un equipo cambia al participante a ese equipo.
- El cambio transfiere los contadores personales ya aportados y, si la carrera sigue abierta, los metros
  acumulados. Los comentarios ambiguos que coinciden con ambos equipos no cambian la asignación.
- `comment`, `share` y `follow` avanzan según `speed`; `like` acumula taps por equipo de acuerdo con `likeTaps`;
  un regalo lleva al equipo a la meta. Al alcanzar la meta, la API fija ganador y suma una copa persistente. Una
  carrera terminada no avanza hasta reiniciarse.
- `comment`, `like`, `follow`, `share` y `gift` inician o reinician el reloj de inactividad en 60 segundos.
  Después de 10 segundos sin actividad, cada equipo avanza de forma independiente una distancia aleatoria de
  0.5–3 metros por segundo. Al llegar a 60 segundos la carrera termina sin ganador. Un equipo que llega a la meta
  durante este avance finaliza con `finishReason: "inactivity_goal"` y no recibe copa.
- `reset` reinicia la carrera. `winner` se conserva en el historial pero no permite que el emisor elija el ganador.
- Evento nuevo: `202 { "accepted": true, "duplicate": false, "sequence": 1 }`; evento duplicado:
  `200` con `duplicate: true`. Se deduplica por `platformEventId` dentro del overlay.

### 12.4 Snapshot y stream

Cada conexión SSE empieza con un snapshot. La forma simplificada del estado inicial es:

```json
{
  "type": "snapshot",
  "version": 1,
  "overlay": { "id": "<publicId>", "name": "Mi overlay" },
  "sequence": 0,
  "state": {
    "race": {
      "status": "idle", "maxMeters": 100, "winnerTeam": null, "authority": "server",
      "matchStartedAt": null, "lastActivityAt": null, "inactivitySecondsRemaining": 60,
      "finishedAt": null, "finishReason": null
    },
    "teams": {
      "1": { "name": "OLIMPIA", "flag": null, "meters": 0, "events": 0, "eventCounts": {}, "cups": 0, "turbo": false },
      "2": { "name": "CERRO", "flag": null, "meters": 0, "events": 0, "eventCounts": {}, "cups": 0, "turbo": false }
    },
    "speed": { "comment": 1, "like": 1, "likeTaps": 15, "share": 3, "follow": 10 },
    "displaySettings": {
      "flags": true,
      "donTortu": true,
      "teamEvents": true,
      "honor": true,
      "progressBar": true
    }
  }
}
```

`race.authority` siempre es `"server"`; `teams` usa IDs `"1"` y `"2"`. `turbo` aparece como `false` en el estado
inicial, pero actualmente no tiene efecto funcional. `finishReason` es `activity`, `inactivity_goal`,
`inactivity_timeout` o `null`. El estado interno de participantes y restos de likes no se publica. Después de cada
evento nuevo, el stream publica el evento enriquecido con `sequence`, `teamId`, `previousTeamId`, `teamChanged` y
los metadatos validados, seguido por:

```json
{ "type": "race", "version": 1, "sequence": 1, "state": { "race": {}, "teams": {} } }
```

Otros mensajes: `display_settings`, `speed_settings`, `team_settings`, `audience`, `counters_reset`,
`lifetime_gifts_reset` y `event_history_cleared`. Los eventos repetidos no vuelven a publicarse. El cliente debe
usar el snapshot inicial y descartar secuencias de eventos ya procesadas. Los comentarios SSE de keep-alive no
son mensajes de aplicación. Mientras haya una carrera activa, la API publica `race` cuando cambian el progreso o
el reloj de inactividad, normalmente una vez por segundo.

### 12.5 Compatibilidad

- Los IDs de equipo son `"1"` y `"2"`; `meters` y `race.maxMeters` son números.
- `displaySettings` conserva exactamente cinco claves booleanas; la velocidad y los equipos tienen endpoints
  separados.
- La autoridad de los relojes, progreso y resultado es la API; `browserLifetime` del dashboard es únicamente el
  tiempo de esa pestaña desde que se abrió.
- No incluir credenciales privadas en páginas públicas, URLs de OBS ni ejemplos con secretos reales.
- Los cambios incompatibles de estructura o mensaje requieren incrementar `version`.

## 12b. Sonido gamificado y voz en off

- `layers/event-sounds.js` (en `index.html`) recibe de `eventos-ruta.html` el mensaje
  `{ channel: "tortulive-sound", kind, count, user, team, text, delta, bump }`. `text` es el `message` del comentario y `team` el nombre del equipo.
- **XP y niveles:** comment 1, like 1 por tap, share 5, follow 10, join 2, gift 20 por regalo. Nivel = 1 + floor(sqrt(XP / 25)).
  Subir de nivel suena una fanfarria y la voz lo anuncia. El estado vive solo en memoria (se reinicia al recargar).
- **Combos:** eventos con menos de 4 s entre sí suben el combo; desde x3 suena una nota pentatónica ascendente y en
  x5, 10, 20, 35, 50 y 100 hay fanfarria y anuncio. Los likes acumulados (`bump`) dan XP pero no cuentan como combo.
- **Hitos por usuario:** a las 10, 25, 50, 100 y 250 interacciones suena un destello (sin voz).
- **Voz en off:** Web Speech API; prefiere una voz femenina en español (es-US/es-MX/es-419 primero), tono agudo.
  **Solo lee comentarios**, como "<apodo de TikTok>, del equipo <equipo>, dice: <texto>"; el resto de eventos y logros
  suenan sin voz. Quita enlaces y emojis, limita a 160 caracteres, acorta repeticiones y acelera hasta 1.5x si hay cola
  (máximo 8 pendientes; si se llena se descarta el comentario más antiguo). Los efectos bajan de volumen mientras habla.
- **Controles:** botones `🔊 Sonido` (necesita un clic para desbloquear el audio) y `🎙️ Voz`, más un indicador de nivel/combo.
  Las voces dependen del navegador del equipo; si no hay ninguna, el sonido funciona igual sin voz.

---

## 13. Pendientes para cerrar el proyecto

Esta lista separa el comportamiento que ya está implementado de las decisiones o verificaciones que aún faltan.
No implica que las funciones pendientes estén disponibles. Este documento es la referencia única para cambios de
reglas, mensajes y endpoints.

| Área | Pendiente | Criterio para darlo por cerrado |
|---|---|---|
| Producto / carrera | Definir qué significa **turbo**: cómo se activa, cuánto dura, a qué equipo aplica, cómo afecta el avance y si se guarda por overlay o por carrera. La API solo inicializa `turbo: false`; no hay reglas, controles ni mensajes que lo hagan funcionar. | Decisión aprobada e implementación coherente en API, dashboard y overlay; actualizar esta sección de contrato si cambia el estado publicado. |
| Producto / regalos | Definir si los regalos avanzan por clase, valor o cantidad, qué clases existen y cómo se combinan con la regla actual de que un regalo lleva al equipo a la meta. Hoy el conector envía nombre y cantidad; no existe velocidad configurable por clase. | Reglas aprobadas, datos del conector suficientes, validación del servidor y presentación del overlay probadas; documentar aquí los campos y su compatibilidad. |
| Webserver / experiencia | Validar visualmente todas las capas, escenarios, escalado, animaciones y estados (incluidos ocultos y ganador) en Chrome y en una escena real de OBS. | Lista de navegadores/escenarios acordada y recorrido visual completado, incluidas capas que cargan tarde. |
| Integración / aceptación | Completar una prueba de punta a punta con un LIVE real o una fuente de eventos de prueba: conexión/reconexión, eventos admitidos, asignación/cambio de equipo, duplicados, reinicio, finalización por meta e inactividad, y entrega SSE al overlay. La suite existente cubre partes de este flujo, no acredita por sí sola la aceptación de todos esos casos. | Casos acordados ejecutados y resultados registrados; los fallos se corrigen antes del lanzamiento. |
| Despliegue | Verificar en el entorno destino HTTPS, cookies seguras y orígenes CORS permitidos; confirmar que `DB_PATH` usa almacenamiento persistente y que el despliegue respeta la limitación actual de una sola instancia API. | Despliegue de prueba completado y comprobación de persistencia/reinicio realizada. Copias de seguridad y recuperación deben quedar definidas por quien opere el servicio. |
El turbo y las reglas de velocidad por clase de regalo son decisiones de producto; no se deben inferir ni activar
por conveniencia técnica. Los requisitos de operación (por ejemplo, copias de seguridad) dependen del entorno de
despliegue y deben confirmarse con quien lo administre.
