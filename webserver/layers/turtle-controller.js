(function () {
  'use strict';
  var team = Number(document.body.dataset.team) - 1;
  if (team !== 0 && team !== 1) throw new Error('La tortuga debe indicar data-team="1" o data-team="2"');

  var racer = document.getElementById('racer');
  var previousProgress = null;
  var animationTimer = 0;
  var override = false;
  var realProgress = 0;
  var palette = ['#e11d48', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899'];

  TortuGame.onState(function (state) {
    var progress = state.teams[team].p;
    var otherProgress = state.teams[1 - team].p;
    realProgress = progress;
    if (!override) racer.style.setProperty('--p', progress);
    racer.classList.toggle('leader', progress > 0 && progress > otherProgress);
    if (previousProgress !== null && progress !== previousProgress && !override) {
      racer.classList.add('go');
      clearTimeout(animationTimer);
      animationTimer = setTimeout(function () { racer.classList.remove('go'); }, 1500);
    }
    previousProgress = progress;
  });

  function hash(value) {
    var result = 0;
    for (var index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) | 0;
    return Math.abs(result);
  }

  function setRider(user, url) {
    var avatar = document.getElementById('rider-av');
    var name = String(user || '?').replace(/^@/, '');
    avatar.textContent = (name[0] || '?').toUpperCase();
    avatar.style.setProperty('--bg', palette[hash(name) % palette.length]);
    if (typeof url === 'string' && /^(https:\/\/|data:image\/)/i.test(url)) {
      var image = document.createElement('img');
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.onerror = function () { image.remove(); };
      image.src = url;
      avatar.appendChild(image);
    }
    document.getElementById('rider-nm').textContent = '@' + name;
  }

  function munch() {
    racer.classList.remove('munch');
    void racer.offsetWidth;
    racer.classList.add('munch');
    setTimeout(function () { racer.classList.remove('munch'); }, 760);
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.origin !== location.origin || !message ||
        message.channel !== 'tortulive-fx' || message.team !== team) return;
    if (message.fx === 'eat') {
      racer.classList.add('giant');
      racer.style.setProperty('--sc', message.scale);
      munch();
    } else if (message.fx === 'run') {
      override = true;
      setRider(message.user, message.avatar);
      racer.classList.add('go', 'riding', 'giant');
      racer.style.transition = '--p 2.6s cubic-bezier(.45,.05,.3,1), --sc .7s cubic-bezier(.2,1.8,.4,1)';
      racer.style.setProperty('--p', message.pEnd);
    } else if (message.fx === 'arrive') {
      racer.classList.remove('go');
      racer.classList.add('arrive');
    } else if (message.fx === 'end') {
      racer.classList.remove('arrive', 'riding');
      racer.style.setProperty('--sc', 1);
      racer.style.transition = '--p 1.6s ease-in-out, --sc .7s cubic-bezier(.2,1.8,.4,1)';
      racer.classList.add('go');
      racer.style.setProperty('--p', realProgress);
      setTimeout(function () {
        override = false;
        racer.classList.remove('go', 'giant');
        racer.style.transition = '';
        racer.style.setProperty('--p', realProgress);
      }, 1700);
    }
  });
})();
