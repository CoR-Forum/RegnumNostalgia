/**
 * Screenshot markers — load screenshots from API and display as dot markers on the map.
 */

import { gameState } from './state.js';
import { getMap, getTotalH } from './map-state.js';

export async function loadAndDisplayScreenshots() {
  try {
    const headers = {};
    if (gameState && gameState.sessionToken) {
      headers['X-Session-Token'] = gameState.sessionToken;
    }
    const res = await fetch('/api/screenshots', {
      method: 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await res.json();
    if (data.success && data.screenshots) {
      displayScreenshotMarkers(data.screenshots);
    }
  } catch (e) {
    console.error('Failed to load screenshots:', e);
  }
}

export function displayScreenshotMarkers(screenshots) {
  const map = getMap();
  const totalH = getTotalH();
  if (!map) return;

  if (!gameState.screenshots) {
    gameState.screenshots = new Map();
  }

  const currentIds = new Set();

  screenshots.forEach(screenshot => {
    currentIds.add(screenshot.id);
    const latLng = [totalH - screenshot.y, screenshot.x];

    const dotIcon = L.divIcon({
      className: 'screenshot-marker',
      html: '<div class="screenshot-dot"></div>',
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    });

    if (gameState.screenshots.has(screenshot.id)) {
      const oldMarker = gameState.screenshots.get(screenshot.id);
      map.removeLayer(oldMarker);
    }

    const marker = L.marker(latLng, { icon: dotIcon }).addTo(map);

    const name = screenshot.name?.en || screenshot.name?.de || screenshot.name?.es || 'Unnamed';
    const description = screenshot.description?.en || screenshot.description?.de || screenshot.description?.es || '';
    const location = screenshot.location || '';
    const visibleCharacters = screenshot.visibleCharacters || '';

    const tooltipHtml = `
      <div style="max-width: 250px;">
        <div style="margin-bottom: 6px;">
          <img src="${window.screenshotManager ? window.screenshotManager.getScreenshotUrl(screenshot.filename) : ''}" style="width: 100%; height: auto; border-radius: 3px; display: block;">
        </div>
        <div style="font-weight: 700; margin-bottom: 4px; font-size: 13px; color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">${name}</div>
        ${location ? `<div style="color: #aaa; font-size: 10px; margin-bottom: 4px; font-weight: 500;">${location}</div>` : ''}
        ${visibleCharacters ? `<div style="color: #60a5fa; font-size: 10px; margin-bottom: 4px; font-weight: 500;">👥 ${visibleCharacters}</div>` : ''}
        ${description ? `<div style="font-size: 10px; line-height: 1.3; color: #ccc;">${description}</div>` : ''}
      </div>
    `;

    marker.bindTooltip(tooltipHtml, {
      className: 'screenshot-tooltip',
      direction: 'top',
      offset: [0, -4]
    });

    gameState.screenshots.set(screenshot.id, marker);
  });

  // Remove markers for deleted screenshots
  for (const [id, marker] of gameState.screenshots.entries()) {
    if (!currentIds.has(id)) {
      map.removeLayer(marker);
      gameState.screenshots.delete(id);
    }
  }
}
