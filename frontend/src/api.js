/**
 * HTTP API helper and WebSocket-with-fallback emit.
 */

import { API_BASE, gameState } from './state.js';

/**
 * Generic HTTP API helper with auth header injection.
 * @param {string} endpoint - API path (appended to API_BASE)
 * @param {object} options - fetch options
 * @returns {Promise<any>} parsed JSON response
 */
export async function apiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...options.headers
  };

  if (gameState && gameState.sessionToken && !options.skipAuth) {
    headers['X-Session-Token'] = gameState.sessionToken;
  }

  const response = await fetch(API_BASE + endpoint, {
    cache: 'no-store',
    ...options,
    headers
  });

  const status = response.status;
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }

  if (!response.ok) {
    const err = new Error((data && data.error) ? data.error : 'API call failed');
    err.status = status;
    err.body = data;
    throw err;
  }

  if (data && data.success === false) {
    const err = new Error(data.error || 'API call failed');
    err.status = status;
    err.body = data;
    throw err;
  }

  return data;
}

// Expose globally for non-module scripts (login.html, character.html, etc.)
window.apiCall = apiCall;

/**
 * Prefer WebSocket emit for an action, falling back to HTTP if socket is unavailable.
 */
export async function emitOrApi(eventName, payload, fallbackPath, fallbackForm) {
  // Lazy import to avoid circular dependency with socket-client
  const { getSocket } = await import('./socket-client.js');
  const socket = getSocket();

  if (socket && socket.connected) {
    return new Promise((resolve, reject) => {
      try {
        socket.emit(eventName, payload, (resp) => {
          if (!resp) return reject(new Error('No response from server'));
          if (resp.success === false) {
            const err = new Error(resp.error || 'Server error');
            err.body = resp;
            return reject(err);
          }
          resolve(resp);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  // Fallback to HTTP API
  return apiCall(fallbackPath, { method: 'POST', body: fallbackForm });
}
