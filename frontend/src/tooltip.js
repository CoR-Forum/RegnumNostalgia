/**
 * Item tooltip system — show, move, hide tooltips with lazy detail fetching.
 */

import { getItemName, getItemTypeLabel } from './items.js';

// Tooltip state
let currentTooltip = null;
let pendingTooltipTimer = null;
let lastMouseX = 0;
let lastMouseY = 0;
let tooltipKeepOpen = false;

/** Accessors for modules that need to read/write tooltip internal state */
export function getCurrentTooltip() { return currentTooltip; }
export function getTooltipKeepOpen() { return tooltipKeepOpen; }
export function setTooltipKeepOpen(v) { tooltipKeepOpen = !!v; }

export function positionTooltip(tooltip, mouseX, mouseY) {
  if (!tooltip) return;
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  const tipRect = tooltip.getBoundingClientRect();
  const tipWidth = tipRect.width;
  const tipHeight = tipRect.height;
  const gap = 6;
  let left = mouseX - tipWidth - gap;
  if (left < 4) {
    left = mouseX + gap;
  }
  let top = mouseY - (tipHeight / 2);
  top = Math.max(4, Math.min(top, window.innerHeight - tipHeight - 4));
  tooltip.style.left = Math.round(left) + 'px';
  tooltip.style.top = Math.round(top) + 'px';
  const finalRect = tooltip.getBoundingClientRect();
  if (finalRect.right > window.innerWidth - 4) {
    left = window.innerWidth - finalRect.width - 4;
    tooltip.style.left = Math.round(left) + 'px';
  }
  if (finalRect.left < 4) {
    left = 4;
    tooltip.style.left = Math.round(left) + 'px';
  }
}

export function showTooltip(event, item) {
  hideTooltip();

  try { if (pendingTooltipTimer) { clearTimeout(pendingTooltipTimer.timer); pendingTooltipTimer = null; } } catch (e) {}

  const anchorEl = event.currentTarget || event.target;
  const tooltipIconName = item.iconName;
  const tooltipIconSrc = tooltipIconName ? `https://cor-forum.de/regnum/RegnumNostalgia/items/${tooltipIconName}` : '';
  const rarityClass = (item.rarity || 'common');

  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
  tooltipKeepOpen = false;

  const timer = setTimeout(() => {
    const tooltip = document.createElement('div');
    tooltip.className = 'item-tooltip';

    tooltip.innerHTML = `
      <div class="tooltip-header">
        <div class="tooltip-icon">${tooltipIconSrc ? `<img src="${tooltipIconSrc}" alt="${getItemName(item)}">` : ''}</div>
        <div class="tooltip-title">
          <div class="tooltip-name ${rarityClass}">${getItemName(item)} ${typeof item.level !== 'undefined' ? `<span class="tooltip-level">Lv ${item.level}</span>` : ''}</div>
        </div>
      </div>
      <div class="tooltip-type">${getItemTypeLabel(item)}</div>
      <div class="tooltip-rarity ${rarityClass}">${rarityClass}</div>
    `;

    document.body.appendChild(tooltip);
    tooltip.style.zIndex = '40000';
    currentTooltip = tooltip;
    requestAnimationFrame(() => positionTooltip(tooltip, event.clientX, event.clientY));

    // Fetch fresh item details from server
    const invId = item.inventoryId || null;
    if (invId && window.getSocket) {
      try {
        const sock = window.getSocket();
        const doEmit = (s) => {
          try {
            tooltip.__requestInventoryId = String(invId);
            s.emit('item:details', { inventoryId: invId }, (resp) => {
              try {
                if (!resp || !resp.success) return;
                const det = resp.item || {};
                if (!currentTooltip || currentTooltip !== tooltip) return;
                if (String(tooltip.__requestInventoryId) !== String(invId)) return;

                let newStatsHtml = '';
                if (det.stats && Object.keys(det.stats || {}).length > 0) {
                  const parts = Object.entries(det.stats).map(([k, v]) => `+${v} ${k.replace('_', ' ')}`);
                  newStatsHtml = `<div class="tooltip-stats">${parts.join('<br>')}</div>`;
                }

                const newIconName = det.iconName || null;
                const newIconSrc = newIconName ? `https://cor-forum.de/regnum/RegnumNostalgia/items/${newIconName}` : (tooltipIconSrc || '');
                const newRarity = det.rarity || rarityClass;

                tooltip.innerHTML = `
                  <div class="tooltip-header">
                    <div class="tooltip-icon">${newIconSrc ? `<img src="${newIconSrc}" alt="${getItemName(det)}">` : ''}</div>
                    <div class="tooltip-title">
                      <div class="tooltip-name ${newRarity}">${getItemName(det)} ${typeof det.level !== 'undefined' ? `<span class="tooltip-level">Lv ${det.level}</span>` : ''}</div>
                    </div>
                  </div>
                  <div class="tooltip-type">${getItemTypeLabel(det)}</div>
                  ${det.description ? `<div class="tooltip-description">"${det.description}"</div>` : ''}
                  ${newStatsHtml}
                  <div class="tooltip-rarity ${newRarity}">${newRarity}</div>
                `;

                requestAnimationFrame(() => positionTooltip(tooltip, lastMouseX, lastMouseY));
              } catch (e) { console.error('Failed to apply item details to tooltip', e); }
            });
          } catch (e) { /* ignore socket emit errors */ }
        };

        if (sock && sock.connected) {
          doEmit(sock);
        } else if (sock) {
          let retries = 0;
          const maxRetries = 20;
          tooltip.__socketRetry = setInterval(() => {
            try {
              const s2 = window.getSocket && window.getSocket();
              if (s2 && s2.connected) {
                clearInterval(tooltip.__socketRetry);
                tooltip.__socketRetry = null;
                doEmit(s2);
                return;
              }
              retries += 1;
              if (retries >= maxRetries) {
                clearInterval(tooltip.__socketRetry);
                tooltip.__socketRetry = null;
              }
            } catch (e) { clearInterval(tooltip.__socketRetry); tooltip.__socketRetry = null; }
          }, 250);
        }
      } catch (e) { /* ignore socket errors */ }
    }
  }, 200);

  pendingTooltipTimer = { timer, anchorEl };
}

export function moveTooltip(event) {
  if (!currentTooltip) return;
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
  positionTooltip(currentTooltip, event.clientX, event.clientY);
}

export function hideTooltip() {
  if (currentTooltip) {
    try { if (currentTooltip.__detailsTimer) { clearTimeout(currentTooltip.__detailsTimer); currentTooltip.__detailsTimer = null; } } catch (e) {}
    try { if (currentTooltip.__socketRetry) { clearInterval(currentTooltip.__socketRetry); currentTooltip.__socketRetry = null; } } catch (e) {}
    try { if (currentTooltip.__requestInventoryId) { currentTooltip.__requestInventoryId = null; } } catch (e) {}
    currentTooltip.remove();
    currentTooltip = null;
  }
  try { if (pendingTooltipTimer) { clearTimeout(pendingTooltipTimer.timer); pendingTooltipTimer = null; } } catch (e) {}
}
