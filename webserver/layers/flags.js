/* Tortulive · catálogo de banderas (países y clubes) dibujadas en SVG, sin imágenes externas.
 * Mini-lenguaje:  "h:col,col*2,col|extra;extra"  (h = franjas horizontales, v = verticales, *n = peso)
 * extras: r:x,y,w,h,col  c:x,y,r,col  s:x,y,r,col (estrella)  t:col (triángulo)  g:x y x y x y,col (polígono)
 *         l:x1,y1,x2,y2,ancho,col  T:x,y,tamaño,TEXTO,col       Lienzo 60x40.
 * Los escudos de clubes son aproximaciones por colores (no los logos oficiales). */
(function () {
  'use strict';
  var KEY = 'tortulive.flags';
  var C = function (c) { return /^[0-9a-f]{3,6}$/i.test(c) ? '#' + c : c; };
  function star(x, y, r, col) {
    var p = [];
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * .4 : r; p.push((x + Math.cos(a) * d).toFixed(1) + ',' + (y + Math.sin(a) * d).toFixed(1)); }
    return '<polygon points="' + p.join(' ') + '" fill="' + C(col) + '"/>';
  }
  function svg(spec) {
    var parts = spec.split('|'), L = parts[0].split(':'), dir = L[0], items = L[1].split(',').map(function (s) { var m = s.split('*'); return { c: m[0], w: +m[1] || 1 }; });
    var tot = items.reduce(function (a, b) { return a + b.w; }, 0), pos = 0, out = '';
    items.forEach(function (it) {
      var f = it.w / tot * (dir === 'h' ? 40 : 60);
      out += dir === 'h' ? '<rect y="' + pos + '" width="60" height="' + (f + .3) + '" fill="' + C(it.c) + '"/>' : '<rect x="' + pos + '" width="' + (f + .3) + '" height="40" fill="' + C(it.c) + '"/>';
      pos += f;
    });
    (parts[1] || '').split(';').forEach(function (e) {
      if (!e) return;
      var k = e[0], a = e.slice(2).split(',');
      if (k === 'r') out += '<rect x="' + a[0] + '" y="' + a[1] + '" width="' + a[2] + '" height="' + a[3] + '" fill="' + C(a[4]) + '"/>';
      else if (k === 'c') out += '<circle cx="' + a[0] + '" cy="' + a[1] + '" r="' + a[2] + '" fill="' + C(a[3]) + '"/>';
      else if (k === 's') out += star(+a[0], +a[1], +a[2], a[3]);
      else if (k === 't') out += '<polygon points="0,0 26,20 0,40" fill="' + C(a[0]) + '"/>';
      else if (k === 'g') out += '<polygon points="' + a[0].replace(/(\S+) (\S+)(?: |$)/g, '$1,$2 ').trim() + '" fill="' + C(a[1]) + '"/>';
      else if (k === 'l') out += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + a[2] + '" y2="' + a[3] + '" stroke="' + C(a[5]) + '" stroke-width="' + a[4] + '"/>';
      else if (k === 'T') out += '<text x="' + a[0] + '" y="' + a[1] + '" font-size="' + a[2] + '" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" fill="' + C(a[4]) + '" stroke="#000" stroke-width=".6" paint-order="stroke">' + a[3] + '</text>';
    });
    return '<svg viewBox="0 0 60 40" preserveAspectRatio="none">' + out + '</svg>';
  }
  var UK = 'h:012169|l:0,0,60,40,6,fff;l:60,0,0,40,6,fff;l:0,0,60,40,2.5,c8102e;l:60,0,0,40,2.5,c8102e;r:26,0,8,40,fff;r:0,16,60,8,fff;r:27.5,0,5,40,c8102e;r:0,17.5,60,5,c8102e';
  var CAN = 'r:0,0,30,20,012169;l:0,0,30,20,3,fff;l:30,0,0,20,3,fff;r:12,0,6,20,fff;r:0,7,30,6,fff;r:13,0,4,20,c8102e;r:0,8,30,4,c8102e';
  var P = [
    ['Argentina', 'h:75aadb,fff,75aadb|c:30,20,4,f6b40e'], ['Paraguay', 'h:d52b1e,fff,0038a8|c:30,20,5,2a8a3a;c:30,20,3,f9e300'], ['Brasil', 'h:009739|g:30 4 56 20 30 36 4 20,fedd00;c:30,20,8,012169'],
    ['Uruguay', 'h:fff,0038a8,fff,0038a8,fff,0038a8,fff,0038a8,fff|r:0,0,26,22,fff;c:13,11,5,fcd116'], ['Chile', 'h:fff,d52b1e|r:0,0,22,20,0039a6;s:11,10,6,fff'], ['Colombia', 'h:fcd116*2,003893,ce1126'],
    ['Perú', 'v:d91023,fff,d91023'], ['Ecuador', 'h:ffdd00*2,034ea2,ed1c24|c:30,20,5,8a5a2b'], ['Bolivia', 'h:d52b1e,f9e300,007934'], ['Venezuela', 'h:ffcc00,00247d,cf142b|s:30,17,3,fff'],
    ['México', 'v:006847,fff,ce1126|c:30,20,5,8a5a2b'], ['Estados Unidos', 'h:b22234,fff,b22234,fff,b22234,fff,b22234,fff,b22234,fff,b22234,fff,b22234|r:0,0,26,21.5,3c3b6e;s:13,10,5,fff'],
    ['Canadá', 'v:d52b1e,fff*2,d52b1e|s:30,20,8,d52b1e'], ['Costa Rica', 'h:002b7f,fff,ce1126*2,fff,002b7f'], ['Panamá', 'h:fff|r:30,0,30,20,d21034;r:0,20,30,20,005293;s:15,10,5,005293;s:45,30,5,d21034'],
    ['Cuba', 'h:002a8f,fff,002a8f,fff,002a8f|t:cf142b;s:8,20,5,fff'], ['Rep. Dominicana', 'h:fff|r:0,0,26,16,002d62;r:34,0,26,16,ce1126;r:0,24,26,16,ce1126;r:34,24,26,16,002d62;r:26,0,8,40,fff;r:0,16,60,8,fff'],
    ['Guatemala', 'v:4997d0,fff,4997d0'], ['Honduras', 'h:0073cf,fff,0073cf|s:24,20,3,0073cf;s:36,20,3,0073cf'], ['El Salvador', 'h:0f47af,fff,0f47af'], ['Nicaragua', 'h:0067c6,fff,0067c6'], ['Haití', 'h:00209f,d21034'],
    ['España', 'h:aa151b,f1bf00*2,aa151b'], ['Portugal', 'v:006600*2,ff0000*3|c:24,20,7,ffcc00'], ['Francia', 'v:0055a4,fff,ef4135'], ['Italia', 'v:009246,fff,ce2b37'], ['Alemania', 'h:000,dd0000,ffce00'],
    ['Inglaterra', 'h:fff|r:26,0,8,40,ce1124;r:0,16,60,8,ce1124'], ['Reino Unido', UK], ['Escocia', 'h:0065bd|l:0,0,60,40,6,fff;l:60,0,0,40,6,fff'], ['Irlanda', 'v:169b62,fff,ff883e'],
    ['Países Bajos', 'h:ae1c28,fff,21468b'], ['Bélgica', 'v:000,fae042,ed2939'], ['Suiza', 'h:da291c|r:26,8,8,24,fff;r:18,16,24,8,fff'], ['Austria', 'h:ed2939,fff,ed2939'], ['Polonia', 'h:fff,dc143c'],
    ['Rep. Checa', 'h:fff,d7141a|g:0 0 30 20 0 40,11457e'], ['Croacia', 'h:f00,fff,171796|c:30,20,5,f00'], ['Serbia', 'h:c6363c,0c4076,fff'], ['Eslovenia', 'h:fff,005da4,ed1c24'], ['Hungría', 'h:ce2939,fff,477050'],
    ['Rumanía', 'v:002b7f,fcd116,ce1126'], ['Bulgaria', 'h:fff,00966e,d62612'], ['Grecia', 'h:0d5eaf,fff,0d5eaf,fff,0d5eaf,fff,0d5eaf,fff,0d5eaf|r:0,0,22,22,0d5eaf;r:9,0,4,22,fff;r:0,9,22,4,fff'],
    ['Turquía', 'h:e30a17|c:22,20,10,fff;c:25,20,8,e30a17;s:34,20,4,fff'], ['Ucrania', 'h:0057b7,ffd700'], ['Rusia', 'h:fff,0039a6,d52b1e'], ['Suecia', 'h:006aa7|r:16,0,6,40,fecc00;r:0,17,60,6,fecc00'],
    ['Noruega', 'h:ba0c2f|r:16,0,10,40,fff;r:0,15,60,10,fff;r:18,0,6,40,00205b;r:0,17,60,6,00205b'], ['Dinamarca', 'h:c8102e|r:16,0,6,40,fff;r:0,17,60,6,fff'], ['Finlandia', 'h:fff|r:16,0,8,40,003580;r:0,16,60,8,003580'],
    ['Islandia', 'h:02529c|r:16,0,8,40,fff;r:0,16,60,8,fff;r:17.5,0,5,40,dc1e35;r:0,17.5,60,5,dc1e35'], ['Japón', 'h:fff|c:30,20,12,bc002d'], ['China', 'h:de2910|s:10,10,6,ffde00'], ['Corea del Sur', 'h:fff|c:30,20,10,cd2e3a;c:30,25,5,0047a0'],
    ['India', 'h:ff9933,fff,138808|c:30,20,4,000080'], ['Arabia Saudita', 'h:006c35|r:14,24,32,2.5,fff'], ['Emiratos Árabes', 'h:00732f,fff,000|r:0,0,16,40,ff0000'], ['Israel', 'h:fff|r:0,4,60,5,0038b8;r:0,31,60,5,0038b8;s:30,20,7,0038b8'],
    ['Irán', 'h:239f40,fff,da0000'], ['Irak', 'h:ce1126,fff,000'], ['Tailandia', 'h:a51931,f4f5f8,2d2a4a*2,f4f5f8,a51931'], ['Vietnam', 'h:da251d|s:30,20,11,ffff00'], ['Indonesia', 'h:f00,fff'], ['Filipinas', 'h:0038a8,ce1126|t:fff;c:6,20,2.5,fcd116'],
    ['Australia', 'h:012169|' + CAN + ';s:15,30,6,fff;s:45,10,3,fff;s:50,24,3,fff;s:38,34,3,fff'], ['Nueva Zelanda', 'h:012169|' + CAN + ';s:45,10,3,cc142b;s:50,24,3,cc142b;s:38,34,3,cc142b'],
    ['Egipto', 'h:ce1126,fff,000|c:30,20,3,c09300'], ['Marruecos', 'h:c1272d|s:30,20,10,006233'], ['Argelia', 'v:006233,fff|c:30,20,8,d21034;c:32,20,6.5,fff;s:33,20,4,d21034'], ['Túnez', 'h:e70013|c:30,20,11,fff;c:30,20,7,e70013'],
    ['Nigeria', 'v:008751,fff,008751'], ['Ghana', 'h:ce1126,fcd116,006b3f|s:30,20,6,000'], ['Senegal', 'v:00853f,fdef42,e31b23|s:30,20,6,00853f'], ['Camerún', 'v:007a5e,ce1126,fcd116|s:30,20,6,fcd116'],
    ['Costa de Marfil', 'v:f77f00,fff,009e60'], ['Sudáfrica', 'h:de3831,002395|t:007a4d'], ['Kenia', 'h:000,bb0000,006600|c:30,20,7,fff'], ['Etiopía', 'h:078930,fcdd09,da121a|c:30,20,7,0f47af']
  ];
  var S = function (n, p, a, b) { return [n, p + ':' + a + (b ? '|' + b : '')]; };
  var K = [
    ['River Plate', 'h:fff|g:0 34 0 22 60 6 60 18,e30613'], ['Boca Juniors', 'h:0a2a6e|r:0,13,60,14,f5c400'], ['Racing Club', 'v:75aadb,fff,75aadb,fff,75aadb'], ['Independiente', 'h:d4001a'],
    ['San Lorenzo', 'v:0b2a6f,c8102e,0b2a6f,c8102e,0b2a6f,c8102e'], ['Estudiantes LP', 'v:d4001a,fff,d4001a,fff,d4001a'], ['Vélez Sarsfield', 'h:fff|g:0 0 14 0 30 30 46 0 60 0 30 40,1a3c8c'],
    ['Olimpia', 'h:fff|r:0,13,60,14,000'], ['Cerro Porteño', 'v:0033a0,c8102e,0033a0,c8102e,0033a0,c8102e'], ['Libertad', 'h:fff,000'], ['Guaraní', 'v:ffd100,000,ffd100,000,ffd100'],
    ['Flamengo', 'h:c8102e,000,c8102e,000,c8102e,000'], ['Corinthians', 'h:fff|r:0,17,60,6,000'], ['Palmeiras', 'h:006437'], ['São Paulo', 'h:fff,e30613,000'], ['Santos', 'h:fff|r:0,17,60,6,000'],
    ['Fluminense', 'v:006b3c,fff,7a0f2e'], ['Grêmio', 'v:0099d8,000,0099d8,000,0099d8'], ['Internacional', 'h:e30613'], ['Atlético Mineiro', 'v:000,fff,000,fff,000,fff'], ['Cruzeiro', 'h:0033a0'],
    ['Peñarol', 'v:ffd100,000,ffd100,000'], ['Nacional UY', 'h:fff,0033a0,c8102e'], ['Colo-Colo', 'h:fff,000'], ['U. de Chile', 'h:0033a0'], ['U. Católica', 'h:fff,0033a0'],
    ['Atl. Nacional', 'v:00a550,fff,00a550'], ['Millonarios', 'h:0033a0'], ['América de Cali', 'h:c8102e'], ['LDU Quito', 'h:fff,c8102e,0033a0'], ['Barcelona SC', 'h:ffd100,c8102e'],
    ['Alianza Lima', 'v:0033a0,fff,0033a0'], ['Universitario', 'h:fff,8b0000'], ['Club América', 'h:ffd100,0033a0'], ['Chivas', 'v:c8102e,fff,c8102e,fff,c8102e'], ['Cruz Azul', 'h:0033a0'],
    ['Pumas UNAM', 'h:0a2a6e,d4af37'], ['Tigres', 'h:ffd100,0033a0'], ['Monterrey', 'v:0a2a6e,fff'], ['Inter Miami', 'h:f7b5cd,000'], ['LA Galaxy', 'h:fff,0a2a6e'],
    ['Real Madrid', 'h:fff|r:0,17,60,6,febe10'], ['FC Barcelona', 'v:a50044,004d98,a50044,004d98,a50044,004d98'], ['Atlético Madrid', 'v:cb3524,fff,cb3524,fff,cb3524,fff'], ['Sevilla', 'h:fff|r:0,17,60,6,d4001a'], ['Valencia', 'h:fff,000'],
    ['Manchester United', 'h:da020e'], ['Manchester City', 'h:6cabdd'], ['Liverpool', 'h:c8102e'], ['Chelsea', 'h:034694'], ['Arsenal', 'h:ef0107,fff,ef0107'], ['Tottenham', 'h:fff,132257'],
    ['Bayern Múnich', 'v:dc052d,0066b2'], ['Borussia Dortmund', 'h:fde100,000'], ['Juventus', 'v:fff,000,fff,000,fff,000'], ['Inter de Milán', 'v:010e80,000,010e80,000,010e80,000'], ['AC Milan', 'v:fb090b,000,fb090b,000,fb090b,000'],
    ['Napoli', 'h:12a0d7'], ['AS Roma', 'h:8e1f2f,f0bc42'], ['Lazio', 'h:87d8f7'], ['PSG', 'h:004170|r:25,0,10,40,da291c;r:23,0,2,40,fff;r:35,0,2,40,fff'], ['Olympique Marsella', 'h:fff,2faee0'],
    ['Ajax', 'h:fff|r:20,0,20,40,d2122e'], ['Benfica', 'h:e30613'], ['FC Porto', 'v:0a3d8f,fff,0a3d8f,fff,0a3d8f,fff'], ['Sporting CP', 'h:00774d,fff'], ['Celtic', 'h:00a651,fff,00a651,fff,00a651,fff'],
    ['Rangers', 'h:0b3d91'], ['Galatasaray', 'h:ffa500,c8102e'], ['Fenerbahçe', 'v:ffd100,0a1f5c']
  ];
  K.forEach(function (k) { k[1] += (k[1].indexOf('|') > -1 ? ';' : '|') + 'c:30,20,10,fff;T:30,24,11,' + k[0].replace(/[^A-ZÁÉÍÓÚÑ]/g, '').slice(0, 3) + ',000'; });
  // Iniciales: si el nombre no tiene 2 mayúsculas se toma el principio.
  K.forEach(function (k) { var m = k[1].match(/T:30,24,11,([^,]*),/); if (m && m[1].length < 2) k[1] = k[1].replace(m[0], 'T:30,24,11,' + k[0].slice(0, 2).toUpperCase() + ','); });

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[null,null]'); } catch (e) { return [null, null]; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* */ } }
  window.TortuFlags = {
    svg: svg, paises: P, clubes: K, read: read,
    set: function (i, item) {
      var v = read();
      v[i] = item ? { n: item[0].toUpperCase().slice(0, 14), s: item[1] } : null;
      write(v);
      window.dispatchEvent(new CustomEvent('tortulive:team-flags-change', { detail: { flags: v } }));
    },
    sync: write,
    watch: function (i, cb) {
      function go() { cb(read()[i] || null); }
      window.addEventListener('storage', function (e) { if (e.key === KEY) go(); }); go();
    }
  };
})();
