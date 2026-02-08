/**
 * Server time UI — day/night cycle display and time fetching.
 */

import { gameState } from './state.js';

const ICON = document.getElementById('server-time-icon');
const TOOLTIP = document.getElementById('server-time-tooltip');

function getDaytimeLabel(h) {
  const hour = Number(h) || 0;
  if (hour === 5) return 'Dawn';
  if (hour >= 6 && hour <= 8) return 'Morning';
  if (hour >= 9 && hour <= 11) return 'Day';
  if (hour >= 12 && hour <= 16) return 'Afternoon';
  if (hour === 17) return 'Sunset';
  if (hour === 18) return 'Dusk';
  if (hour >= 19 && hour <= 20) return 'Nightfall';
  return 'Night';
}

/**
 * Update the server time icon and tooltip text.
 * @param {object} data - May be a full player state or a { ingameHour, ingameMinute } object
 */
export function updateServerTimeUI(data) {
  try {
    if (!data) return;
    const st = data.serverTime || data;
    const hour = Number(st && st.ingameHour) || 0;
    const minute = Number(st && st.ingameMinute) || 0;

    if (data.daytimeIcon && ICON) ICON.src = data.daytimeIcon;
    else if (data.icon && ICON) ICON.src = data.icon;

    if (TOOLTIP) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(minute).padStart(2, '0');
      const label = getDaytimeLabel(hour);
      TOOLTIP.textContent = `${hh}:${mm} — ${label}`;
      TOOLTIP.setAttribute('aria-hidden', 'false');
    }
  } catch (e) { console.warn('updateServerTimeUI failed', e); }
}

// Expose on window for backward compatibility
window.updateServerTimeUI = updateServerTimeUI;

/**
 * Fetch server time via WebSocket.
 */
export function fetchServerTime() {
  try {
    const socket = window.getSocket && window.getSocket();
    if (socket && socket.connected) {
      socket.emit('player:stats:get', (resp) => {
        if (resp && resp.success && resp.state) {
          updateServerTimeUI(resp.state);
        }
      });
    } else {
      console.warn('WebSocket not connected — skipping server time fetch');
    }
  } catch (e) { console.warn('Failed to fetch server time', e); }
}
