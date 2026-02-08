/**
 * Inventory — render inventory list, drag-to-equip, right-click use/equip, unequip-drop handler.
 */

import { getItemName } from './items.js';
import { showTooltip, moveTooltip, hideTooltip, getCurrentTooltip, getTooltipKeepOpen, setTooltipKeepOpen } from './tooltip.js';
import { emitOrApi } from './api.js';
import { getErrorMessage } from './utils.js';

/**
 * Render the inventory items list.
 */
export function displayInventory(items) {
  document.getElementById('inventory-loading').style.display = 'none';

  const container = document.getElementById('inventory-items');
  const footer = document.getElementById('inventory-footer');

  // Reset scroll to top on refresh
  container.scrollTop = 0;
  container.innerHTML = '';

  if (items.length === 0) {
    document.getElementById('inventory-empty').style.display = 'block';
    footer.style.display = 'none';
    return;
  }

  document.getElementById('inventory-items').style.display = 'block';
  footer.style.display = 'flex';

  let totalGold = 0;

  items.forEach((item) => {
    if (getItemName(item) === 'Gold') {
      totalGold += item.quantity;
    }

    const itemDiv = document.createElement('div');
    itemDiv.className = 'inventory-item';

    const iconName = item.iconName;
    const iconSrc = iconName ? `https://cor-forum.de/regnum/RegnumNostalgia/items/${iconName}` : '';
    const iconHtml = iconSrc ? `<img src="${iconSrc}" alt="${getItemName(item)}">` : '';
    const rarityClass = item.rarity || 'common';

    itemDiv.innerHTML = `
      <div class="item-icon">${iconHtml}</div>
      <div class="item-name ${rarityClass}">${getItemName(item)}${typeof item.level !== 'undefined' ? ` <span class="item-level">Lv ${item.level}</span>` : ''}</div>
      ${item.quantity > 1 ? `<div class="item-quantity">×${item.quantity}</div>` : ''}
    `;

    const invId = item.inventoryId;
    const equipSlot = item.equipmentSlot ?? null;
    itemDiv.draggable = true;
    itemDiv.dataset.inventoryId = invId;
    itemDiv.dataset.equipmentSlot = equipSlot || '';

    itemDiv.addEventListener('dragstart', (ev) => {
      const payload = JSON.stringify({ inventoryId: invId, equipmentSlot: equipSlot });
      try { ev.dataTransfer.setData('application/json', payload); } catch (_) { ev.dataTransfer.setData('text/plain', payload); }
    });

    // Tooltip on hover
    itemDiv.addEventListener('mouseenter', (e) => showTooltip(e, item));
    itemDiv.addEventListener('mouseleave', () => { if (!getTooltipKeepOpen()) hideTooltip(); });
    itemDiv.addEventListener('mousemove', (e) => moveTooltip(e));
    itemDiv.addEventListener('click', () => { setTooltipKeepOpen(true); });
    itemDiv.addEventListener('mousedown', () => {
      try { const ct = getCurrentTooltip(); if (ct) ct.style.zIndex = '50000'; } catch (e) {}
    });

    // Right-click context menu (use / equip)
    itemDiv.addEventListener('contextmenu', async (e) => {
      try {
        e.preventDefault();
        const id = itemDiv.dataset.inventoryId;
        if (!id) return;

        const getItemDetails = () => new Promise((resolve, reject) => {
          if (window.socket && window.socket.connected) {
            window.socket.emit('item:details', { inventoryId: id }, (resp) => {
              if (resp && resp.success) resolve(resp.item);
              else reject(new Error('Failed to fetch item details'));
            });
          } else {
            reject(new Error('Not connected'));
          }
        });

        const itemDetails = await getItemDetails();
        const isUsable = itemDetails.type === 'premium' && itemDetails.stats && itemDetails.stats.loot_table;

        if (isUsable) {
          try {
            const useItem = () => new Promise((resolve, reject) => {
              if (window.socket && window.socket.connected) {
                window.socket.emit('item:use', { inventoryId: id }, (resp) => {
                  if (resp && resp.success) resolve(resp);
                  else reject(new Error(resp?.error || 'Failed to use item'));
                });
              } else {
                reject(new Error('Not connected'));
              }
            });
            await useItem();
          } catch (err) {
            if (window.addLogMessage) window.addLogMessage(getErrorMessage(err, 'Failed to use item'), 'error');
          }
        } else {
          // Equip
          const form = new URLSearchParams();
          form.append('inventoryId', id);
          try {
            await emitOrApi('equipment:equip', { inventoryId: id }, '/equipment/equip', form);
          } catch (err) {
            if (window.addLogMessage) window.addLogMessage(getErrorMessage(err, 'Failed to equip item'), 'error');
          }
          // Refresh open windows
          const { openWindow } = await import('./windows.js');
          try { if (document.getElementById('character-window')?.style.display !== 'none') await openWindow('character-window'); } catch (e) {}
          try { if (document.getElementById('inventory-window')?.style.display !== 'none') await openWindow('inventory-window'); } catch (e) {}
        }
      } catch (e) { console.error('inventory right-click failed', e); }
    });

    container.appendChild(itemDiv);
  });

  document.getElementById('inventory-gold').textContent = `${totalGold.toLocaleString()} Gold`;
}

/**
 * Set up the inventory container to accept drops from equipment slots (unequip via drag).
 * Call once after DOM ready.
 */
export function initInventoryDropZone() {
  const invContainer = document.getElementById('inventory-items');
  if (!invContainer) return;

  invContainer.addEventListener('dragover', (e) => { e.preventDefault(); });
  invContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    try {
      const payload = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
      if (!payload) return;
      const data = JSON.parse(payload);
      if (data.fromSlot && data.slot) {
        const form = new URLSearchParams();
        form.append('slot', data.slot);
        try {
          await emitOrApi('equipment:unequip', { slot: data.slot }, '/equipment/unequip', form);
        } catch (err) {
          if (window.addLogMessage) window.addLogMessage(getErrorMessage(err, 'Failed to unequip item'), 'error');
        }
        const { openWindow } = await import('./windows.js');
        try { await openWindow('inventory-window'); } catch (e) {}
      }
    } catch (err) { console.error('Failed to unequip:', err); }
  });
}
