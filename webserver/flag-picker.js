/* Tortulive · botón BANDERA: elige la bandera/escudo de cada equipo (países y clubes). TortuFlagPicker.mount(host) */
(function () {
  'use strict';
  var css = '.tfp{position:relative;display:inline-block;font-family:Arial,sans-serif}' +
    '.tfp-btn{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:999px;padding:10px 18px;cursor:pointer;font:900 15px/1 "Arial Black",Impact,Arial,sans-serif;letter-spacing:1.5px;color:#2b1700;background:linear-gradient(180deg,#ffe27a,#f2b92b 60%,#d99412);box-shadow:0 3px 0 #8a5a10,0 6px 14px rgba(0,0,0,.45)}' +
    '.tfp-panel{position:absolute;z-index:60;top:calc(100% + 10px);left:0;width:400px;max-width:92vw;padding:12px;border-radius:16px;border:2px solid #f2c230;background:linear-gradient(180deg,#2d1b0b,#140b04);box-shadow:0 14px 34px rgba(0,0,0,.6);display:none;color:#fff}' +
    '.tfp.open .tfp-panel{display:block}.tfp-row{display:flex;gap:6px;margin-bottom:8px}' +
    '.tfp-tab{flex:1;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:#3b2610;color:#fff;font:800 12px Arial;padding:8px 4px;cursor:pointer}' +
    '.tfp-tab.on{background:#f2b92b;color:#2b1700;border-color:#ffd84d}.tfp-q{width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;border-radius:9px;border:1px solid #6b4a2a;background:#140b04;color:#fff;font:14px Arial}' +
    '.tfp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;max-height:300px;overflow:auto}' +
    '.tfp-tile{border:2px solid rgba(255,255,255,.15);border-radius:9px;background:#1b1004;cursor:pointer;padding:4px;color:#fff;font:700 10px/1.1 Arial;display:flex;flex-direction:column;align-items:center;gap:3px}' +
    '.tfp-tile:hover{border-color:#fff}.tfp-tile.sel{border-color:#ffd84d;box-shadow:0 0 8px #ffd84d}.tfp-tile svg{width:100%;height:34px;border-radius:3px;display:block}' +
    '.tfp-note{margin:8px 0 0;font:11px Arial;color:#c9b48a}';
  function mount(host) {
    var F = window.TortuFlags, team = 0, tab = 'paises', q = '';
    if (!document.getElementById('tfp-css')) { var st = document.createElement('style'); st.id = 'tfp-css'; st.textContent = css; document.head.appendChild(st); }
    var root = document.createElement('div'); root.className = 'tfp';
    root.innerHTML = '<button type="button" class="tfp-btn"><span>🏳️</span>BANDERA</button><div class="tfp-panel">' +
      '<div class="tfp-row" data-g="team"><button type="button" class="tfp-tab on" data-v="0">Equipo 1</button><button type="button" class="tfp-tab" data-v="1">Equipo 2</button></div>' +
      '<div class="tfp-row" data-g="tab"><button type="button" class="tfp-tab on" data-v="paises">🌍 Países</button><button type="button" class="tfp-tab" data-v="clubes">⚽ Clubes</button><button type="button" class="tfp-tab" data-v="orig">↩ Original</button></div>' +
      '<input class="tfp-q" type="search" placeholder="Buscar…" /><div class="tfp-grid"></div>' +
      '<p class="tfp-note">Escudos de clubes: aproximación por colores, no el logo oficial.</p></div>';
    var grid = root.querySelector('.tfp-grid');
    function draw() {
      var cur = F.read()[team], list = (tab === 'orig' ? [] : F[tab]).filter(function (f) { return f[0].toLowerCase().indexOf(q) > -1; });
      grid.innerHTML = '';
      list.forEach(function (f) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'tfp-tile' + (cur && cur.s === f[1] ? ' sel' : '');
        b.innerHTML = F.svg(f[1]) + '<span>' + f[0] + '</span>';
        b.addEventListener('click', function () { F.set(team, f); draw(); });
        grid.appendChild(b);
      });
    }
    root.querySelector('.tfp-btn').addEventListener('click', function (e) { e.stopPropagation(); root.classList.toggle('open'); draw(); });
    document.addEventListener('click', function (e) { if (!root.contains(e.target)) root.classList.remove('open'); });
    root.querySelectorAll('.tfp-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        var b = e.target.closest('.tfp-tab'); if (!b) return;
        row.querySelectorAll('.tfp-tab').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (row.dataset.g === 'team') team = +b.dataset.v;
        else if (b.dataset.v === 'orig') { F.set(team, null); row.querySelectorAll('.tfp-tab').forEach(function (x, i) { x.classList.toggle('on', i === 0); }); tab = 'paises'; }
        else tab = b.dataset.v;
        draw();
      });
    });
    root.querySelector('.tfp-q').addEventListener('input', function (e) { q = e.target.value.toLowerCase(); draw(); });
    host.appendChild(root); return root;
  }
  window.TortuFlagPicker = { mount: mount };
})();
