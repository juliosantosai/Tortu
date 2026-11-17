(function () {
  'use strict';

  function start(options) {
    var layers = Array.from(options.layers || document.querySelectorAll('.layer'));
    var latestStateMessages = new Map();
    var currentDisplaySettings = null;
    var currentLayout = { ext: 0, hdr: 0 };
    var apiBase = String(options.apiBase || '').replace(/\/+$/, '');
    var stream = new EventSource(apiBase + '/api/public/' + encodeURIComponent(options.publicId) + '/stream');

    function computeLayout(settings) {
      settings = settings || {};
      var off = function (key) { return settings[key] === false; };
      var header = off('flags') && off('donTortu') ? 67 : 0;
      var footer = off('progressBar') ? 57 : off('honor') ? 36 : 0;
      return { ext: header + footer, hdr: header };
    }

    function applyLayoutTo(layer) {
      try {
        var root = layer.contentDocument && layer.contentDocument.documentElement;
        if (!root) return;
        root.style.setProperty('--ext', currentLayout.ext + 'px');
        root.style.setProperty('--hdr', currentLayout.hdr + 'px');
      } catch (error) {
        console.warn('No se pudo ajustar el largo de la pista:', error);
      }
    }

    function applyDisplaySettings(settings) {
      var layersBySetting = {
        flags: ['.bandera1', '.bandera2'],
        donTortu: ['.don'],
        teamEvents: ['.contadores', '.eventos', '.estadisticas'],
        honor: ['.agradecimiento'],
        progressBar: ['.progreso1', '.progreso2']
      };
      Object.keys(layersBySetting).forEach(function (setting) {
        layersBySetting[setting].forEach(function (selector) {
          var layer = document.querySelector(selector);
          if (layer) layer.style.display = settings[setting] === false ? 'none' : 'block';
        });
      });
      currentLayout = computeLayout(settings);
      layers.forEach(applyLayoutTo);
    }

    function postMessage(layer, message) {
      if (layer.contentWindow) {
        layer.contentWindow.postMessage({ channel: 'tortulive', message: message }, location.origin);
      }
    }

    function receive(message) {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'snapshot') latestStateMessages.clear();
      if (['snapshot', 'race', 'state', 'progress', 'display_settings', 'speed_settings', 'team_settings']
        .includes(message.type)) {
        latestStateMessages.set(message.type, message);
      }
      layers.forEach(function (layer) { postMessage(layer, message); });

      if (message.type === 'snapshot') {
        currentDisplaySettings = message.state && message.state.displaySettings || {
          flags: true,
          donTortu: true,
          teamEvents: true,
          honor: true,
          progressBar: true
        };
        applyDisplaySettings(currentDisplaySettings);
      } else if (message.type === 'display_settings' && message.settings) {
        currentDisplaySettings = message.settings;
        applyDisplaySettings(currentDisplaySettings);
      }
    }

    function onLayerLoad(layer) {
      applyLayoutTo(layer);
      latestStateMessages.forEach(function (message) { postMessage(layer, message); });
      if (currentDisplaySettings) applyDisplaySettings(currentDisplaySettings);
    }

    layers.forEach(function (layer) {
      layer.addEventListener('load', function () { onLayerLoad(layer); });
    });

    stream.onmessage = function (event) {
      try {
        receive(JSON.parse(event.data));
      } catch (error) {
        console.warn('Mensaje del stream ignorado (no es JSON válido):', error);
      }
    };

    return {
      close: function () { stream.close(); },
      receive: receive
    };
  }

  window.TortuOverlayCoordinator = { start: start };
})();
