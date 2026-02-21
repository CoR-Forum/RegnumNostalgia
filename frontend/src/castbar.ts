/**
 * Cast Bar — shows a progress bar at the bottom of the screen while casting a spell.
 * Supports cancellation (e.g. on movement).
 *
 * Usage:
 *   import { startCasting, cancelCasting, isCasting } from './castbar';
 *   startCasting({ name, castTime, inventoryId, iconName });
 *   cancelCasting();   // aborts the cast
 *   isCasting();       // returns boolean
 */

/** @type {{ timer: number|null, raf: number|null, startTime: number, castTime: number, inventoryId: number, name: string } | null} */
let castState = null;

/**
 * Start casting a spell. Shows the cast bar and emits spell:cast after castTime.
 * @param {{ name: string, castTime: number, inventoryId: number, iconName?: string }} opts
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export function startCasting({ name, castTime, inventoryId, iconName }) {
  return new Promise((resolve) => {
    // If already casting, reject
    if (castState) {
      resolve({ success: false, error: 'Already casting' });
      return;
    }

    const bar = document.getElementById('cast-bar');
    const fill = document.getElementById('cast-bar-fill');
    const label = document.getElementById('cast-bar-label');
    const timeEl = document.getElementById('cast-bar-time');
    if (!bar || !fill || !label || !timeEl) {
      resolve({ success: false, error: 'Cast bar UI not found' });
      return;
    }

    // Setup UI
    label.textContent = name;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    timeEl.textContent = castTime.toFixed(1) + 's';
    bar.classList.add('visible');

    // Force reflow then animate
    void fill.offsetWidth;
    fill.style.transition = `width ${castTime}s linear`;
    fill.style.width = '100%';

    const startTime = performance.now();
    const castMs = castTime * 1000;

    // Update time counter via rAF
    const updateTime = () => {
      if (!castState) return;
      const elapsed = performance.now() - startTime;
      const remaining = Math.max(0, (castMs - elapsed) / 1000);
      timeEl.textContent = remaining.toFixed(1) + 's';
      if (remaining > 0) {
        castState.raf = requestAnimationFrame(updateTime);
      }
    };

    // Timer to complete the cast
    const timer = setTimeout(() => {
      if (!castState) return;
      hideCastBar();

      // Emit spell:cast to server
      const socket = window.getConnectedSocket && window.getConnectedSocket();
      if (socket) {
        socket.emit('spell:cast', { inventoryId }, (resp) => {
          if (resp && resp.success) {
            resolve({ success: true });
          } else {
            if (window.addLogMessage) window.addLogMessage(resp?.error || 'Failed to cast spell', 'error');
            resolve({ success: false, error: resp?.error });
          }
        });
      } else {
        resolve({ success: false, error: 'Not connected' });
      }
    }, castMs);

    castState = { timer, raf: null, startTime, castTime: castMs, inventoryId, name };
    castState.raf = requestAnimationFrame(updateTime);
  });
}

/**
 * Cancel the current cast (e.g. on movement).
 */
export function cancelCasting() {
  if (!castState) return;
  if (window.addLogMessage) window.addLogMessage('Cast interrupted', 'warning');
  hideCastBar();
}

/**
 * @returns {boolean} Whether a spell is currently being cast.
 */
export function isCasting() {
  return castState !== null;
}

/** Hide the cast bar and clean up timers. */
function hideCastBar() {
  if (castState) {
    if (castState.timer) clearTimeout(castState.timer);
    if (castState.raf) cancelAnimationFrame(castState.raf);
    castState = null;
  }
  const bar = document.getElementById('cast-bar');
  if (bar) bar.classList.remove('visible');
}
