(function () {
  'use strict';
  var team = Number(document.body.dataset.team) - 1;
  if (team !== 0 && team !== 1) throw new Error('El progreso debe indicar data-team="1" o data-team="2"');

  TortuGame.onState(function (state) {
    var progress = state.teams[team];
    document.querySelector('.wrap').style.setProperty('--pct', (progress.p * 100).toFixed(1) + '%');
    document.querySelector('.count').textContent =
      Math.round(progress.p * TortuGame.GOAL) + '/' + TortuGame.GOAL;
  });

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || event.data.channel !== 'tortulive') return;
    var message = event.data.message;
    var settings = message && message.type === 'snapshot'
      ? message.state && message.state.displaySettings
      : message && message.type === 'display_settings' ? message.settings : null;
    if (settings) document.querySelector('.honor').style.display = settings.honor === false ? 'none' : 'flex';
  });
})();
