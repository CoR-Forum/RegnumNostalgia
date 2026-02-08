/**
 * Audio Manager — music and SFX playback, volume controls, autoplay resume.
 */

let musicAudio = null;
let currentMusic = null;
let pendingMusic = null;
let defaultSfxVolume = 1.0;
let defaultCaptureSfxVolume = 1.0;
let musicEnabled = false;
let soundsEnabled = true;

function tryPlayMusic(file, volume = 0.6, loop = true) {
  if (!file) return Promise.resolve();
  if (currentMusic === file && musicAudio) return Promise.resolve();
  try {
    if (musicAudio) musicAudio.pause();
    musicAudio = new Audio('https://cor-forum.de/regnum/RegnumNostalgia/music/' + file);
    musicAudio.loop = !!loop;
    musicAudio.volume = typeof volume === 'number' ? volume : 0.6;
    return musicAudio.play().then(() => {
      currentMusic = file;
      pendingMusic = null;
    });
  } catch (e) {
    return Promise.reject(e);
  }
}

function playMusic(file, volume = 0.6, loop = true) {
  if (!file) return;
  try {
    tryPlayMusic(file, volume, loop).catch(() => {
      pendingMusic = { file, volume, loop };
    });
  } catch (e) {
    pendingMusic = { file, volume, loop };
  }
}

function stopMusic() {
  try {
    if (musicAudio) {
      musicAudio.pause();
      musicAudio.currentTime = 0;
    }
    currentMusic = null;
    pendingMusic = null;
  } catch (e) {
    console.debug('stopMusic failed', e);
  }
}

function playSfx(file, volume = 1.0) {
  if (!file) return;
  try {
    const s = new Audio('https://cor-forum.de/regnum/RegnumNostalgia/sounds/' + file);
    s.volume = typeof volume === 'number' ? volume : 1.0;
    s.play().catch(() => {});
  } catch (e) {
    console.debug('playSfx failed', e);
  }
}

function resumePendingMusic() {
  if (!pendingMusic) return;
  tryPlayMusic(pendingMusic.file, pendingMusic.volume, pendingMusic.loop).catch(() => {});
}

// Resume pending music on first user interaction
const resumeOnce = () => {
  resumePendingMusic();
  document.removeEventListener('click', resumeOnce);
  document.removeEventListener('keydown', resumeOnce);
};
document.addEventListener('click', resumeOnce);
document.addEventListener('keydown', resumeOnce);

/** Global AudioManager exposed on window for settings UI */
window.AudioManager = {
  setMusicVolume(v) {
    try { if (musicAudio) musicAudio.volume = parseFloat(v) || 0; } catch (e) {}
  },
  setSoundVolume(v) {
    try { defaultSfxVolume = parseFloat(v) || 0; } catch (e) {}
  },
  setCaptureSoundVolume(v) {
    try { defaultCaptureSfxVolume = parseFloat(v) || 0; } catch (e) {}
  },
  setMusicEnabled(enabled) {
    try { musicEnabled = !!enabled; if (!musicEnabled) stopMusic(); } catch (e) {}
  },
  setSoundsEnabled(enabled) {
    try { soundsEnabled = !!enabled; } catch (e) {}
  },
  _playMusicInternal(file, volume, loop) { if (musicEnabled) playMusic(file, volume, loop); },
  _playSfxInternal(file, volume) { if (soundsEnabled) playSfx(file, typeof volume === 'number' ? volume : defaultSfxVolume); },
};

/**
 * Bind audio socket events to a socket instance.
 */
export function bindAudioEvents(socket) {
  socket.on('audio:play', (data) => {
    if (!data) return;
    if (data.type === 'music') {
      window.AudioManager._playMusicInternal(data.file, data.volume, data.loop);
    } else if (data.type === 'sfx') {
      const vol = (typeof data.volume === 'number')
        ? data.volume
        : (data.file && data.file.indexOf('capture') !== -1 ? defaultCaptureSfxVolume : undefined);
      window.AudioManager._playSfxInternal(data.file, vol);
    }
  });

  socket.on('audio:stop', (data) => {
    if (!data) return;
    if (data.type === 'music') stopMusic();
  });
}
