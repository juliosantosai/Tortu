/*
 * Tortulive · botón FONDOS (selector de los 5 escenarios de fondo).
 * Guarda la elección en localStorage y la avisa a la capa de fondo por BroadcastChannel,
 * por lo que cambia al instante en el overlay y en la vista previa del panel.
 * Uso: TortuScenes.mount(contenedor, { align: 'right' | 'left' });
 */
(function () {
  'use strict';
  var KEY = 'tortulive.scene';
  var SCENES = [
    { n: 1, name: 'Selva', icon: '🌴', bg: 'linear-gradient(160deg,#1f7a3a,#052212)' },
    { n: 2, name: 'Océano', icon: '🐠', bg: 'linear-gradient(160deg,#38b6e8,#021a3c)' },
    { n: 3, name: 'Espacio', icon: '🚀', bg: 'linear-gradient(160deg,#5b2bb8,#04010d)' },
    { n: 4, name: 'Desierto', icon: '🌅', bg: 'linear-gradient(160deg,#ff8a3d,#2a0f4a)' },
    { n: 5, name: 'Volcán', icon: '🌋', bg: 'linear-gradient(160deg,#ff5a14,#120202)' },
    { n: 6, name: 'Nieve', icon: '❄️', bg: 'linear-gradient(160deg,#cfe8ff,#0b1d44)' },
    { n: 7, name: 'Neón retro', icon: '🕹️', bg: 'linear-gradient(160deg,#ff2d95,#14002e)' },
    { n: 8, name: 'Estadio', icon: '🏟️', bg: 'linear-gradient(160deg,#14803a,#06210f)' },
    { n: 9, name: 'Dulces', icon: '🍭', bg: 'linear-gradient(160deg,#ffb3e6,#7fe7ff)' },
    { n: 10, name: 'Tormenta', icon: '⛈️', bg: 'linear-gradient(160deg,#2c3a5c,#0a0f1e)' }
  ];
  var channel = null;
  try { channel = new BroadcastChannel('tortulive-scene'); } catch (e) { /* sin BroadcastChannel */ }

  function current() {
    try { return parseInt(localStorage.getItem(KEY) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function save(n) {
    try { localStorage.setItem(KEY, String(n)); } catch (e) { /* sin storage */ }
    if (channel) channel.postMessage({ scene: n });
    // Capas del mismo documento (overlay privado): aviso directo por si no hay BroadcastChannel.
    document.querySelectorAll('iframe.fondo').forEach(function (f) {
      try { f.contentWindow.postMessage({ channel: 'tortulive', message: { type: 'scene', scene: n } }, location.origin); } catch (e) { /* */ }
    });
  }

  var css = '' +
    '.tsc{position:relative;display:inline-block;font-family:Arial,sans-serif}' +
    '.tsc-btn{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:999px;padding:10px 18px;cursor:pointer;font:900 15px/1 "Arial Black",Impact,Arial,sans-serif;letter-spacing:1.5px;color:#2b1700;' +
    'background:linear-gradient(180deg,#ffe27a,#f2b92b 60%,#d99412);box-shadow:0 3px 0 #8a5a10,0 6px 14px rgba(0,0,0,.45),0 0 14px rgba(255,200,60,.5);transition:transform .12s}' +
    '.tsc-btn:hover{transform:translateY(-1px) scale(1.04)}.tsc-btn:active{transform:translateY(2px);box-shadow:0 1px 0 #8a5a10}' +
    '.tsc-panel{position:absolute;z-index:50;top:calc(100% + 10px);width:312px;max-width:92vw;max-height:70vh;overflow:auto;padding:12px;border-radius:16px;border:2px solid #f2c230;' +
    'background:linear-gradient(180deg,#2d1b0b,#140b04);box-shadow:0 14px 34px rgba(0,0,0,.6),inset 0 0 14px rgba(242,194,48,.18);display:none}' +
    '.tsc.center .tsc-panel{left:50%;transform:translateX(-50%)}.tsc.center .tsc-btn{padding:7px 14px;font-size:12px}.tsc.right .tsc-panel{right:0}.tsc.left .tsc-panel{left:0}.tsc.open .tsc-panel{display:block;animation:tscin .22s ease-out}' +
    '@keyframes tscin{from{opacity:0}}' +
    '.tsc-title{margin:0 0 9px;color:#ffd84d;font:900 12px/1 "Arial Black",Impact,Arial,sans-serif;letter-spacing:2px}' +
    '.tsc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
    '.tsc-tile{position:relative;height:74px;border-radius:11px;border:2px solid rgba(255,255,255,.18);cursor:pointer;overflow:hidden;padding:0;color:#fff;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;padding-bottom:6px;font:800 11px/1 Arial,sans-serif;text-shadow:0 1px 3px #000;transition:transform .12s,border-color .12s}' +
    '.tsc-tile span.i{position:absolute;top:8px;font-size:25px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));animation:tscbob 2.4s ease-in-out infinite}' +
    '@keyframes tscbob{50%{transform:translateY(-3px)}}' +
    '.tsc-tile:hover{transform:translateY(-2px);border-color:#fff}' +
    '.tsc-tile.sel{border-color:#ffd84d;box-shadow:0 0 0 2px rgba(255,216,77,.35),0 0 12px rgba(255,216,77,.7)}' +
    '.tsc-tile.sel::after{content:"✓";position:absolute;top:3px;right:6px;color:#ffd84d;font-size:13px}' +
    '.tsc-orig{grid-column:1/-1;height:34px;flex-direction:row;justify-content:center;align-items:center;gap:7px;padding:0;background:linear-gradient(90deg,#533620,#3f2813)}' +
    '.tsc-orig span.i{position:static;font-size:15px;animation:none}';

  function mount(host, opts) {
    opts = opts || {};
    if (!document.getElementById('tsc-css')) {
      var st = document.createElement('style'); st.id = 'tsc-css'; st.textContent = css; document.head.appendChild(st);
    }
    var root = document.createElement('div');
    root.className = 'tsc ' + (opts.align || 'right');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'tsc-btn'; btn.innerHTML = '<span>🎮</span>FONDO';
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('div'); panel.className = 'tsc-panel';
    panel.innerHTML = '<p class="tsc-title">ELIGE TU FONDO (10)</p>';
    var grid = document.createElement('div'); grid.className = 'tsc-grid'; panel.appendChild(grid);
    var tiles = [];
    function tile(n, name, icon, bg, extra) {
      var t = document.createElement('button'); t.type = 'button'; t.className = 'tsc-tile' + (extra || '');
      t.style.background = bg; t.dataset.n = n;
      t.innerHTML = '<span class="i">' + icon + '</span><b>' + name + '</b>';
      t.addEventListener('click', function () { save(n); refresh(); });
      grid.appendChild(t); tiles.push(t);
    }
    SCENES.forEach(function (s) { tile(s.n, s.name, s.icon, s.bg); });
    tile(0, 'Original (madera)', '🪵', 'linear-gradient(90deg,#533620,#3f2813)', ' tsc-orig');
    function refresh() {
      var c = current();
      tiles.forEach(function (t) { t.classList.toggle('sel', Number(t.dataset.n) === c); });
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = root.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); refresh();
    });
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) { root.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
    window.addEventListener('storage', function (e) { if (e.key === KEY) refresh(); });
    root.appendChild(btn); root.appendChild(panel); host.appendChild(root); refresh();
    return root;
  }

  window.TortuScenes = { mount: mount, set: save, current: current };
})();
