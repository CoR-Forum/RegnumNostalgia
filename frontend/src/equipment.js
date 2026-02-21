/**
 * Equipment — render character equipment slots, drag-to-equip/unequip, tooltip bindings.
 */

import { showTooltip, moveTooltip, hideTooltip, getCurrentTooltip } from './tooltip.js';
import { emitOrApi } from './api.js';
import { getErrorMessage } from './utils.js';
import { nextZIndex } from './windows.js';
import { ITEM_CDN_BASE } from './state.js';

function getEquipIconSrc(item) {
  const iconName = item.iconName;
  return iconName ? `${ITEM_CDN_BASE}/${iconName}` : '';
}

/**
 * Render all equipment slots for the character window.
 */
export function displayEquipment(equipment) {
  try {
    const slots = ['head', 'body', 'hands', 'shoulders', 'legs', 'weaponRight', 'weaponLeft', 'ringRight', 'ringLeft', 'amulet'];

    slots.forEach((slot) => {
      const el = document.querySelector(`.equipment-slot[data-slot="${slot}"]`);
      if (!el) return;

      const info = equipment[slot] || { inventoryId: null, item: null };
      el.classList.toggle('empty', !info || !info.inventoryId);
      el.dataset.slot = slot;

      // Clear previous listeners by cloning node
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      const target = newEl;

      if (info && info.inventoryId) {
        const it = info.item || {};
        const iconSrc = getEquipIconSrc(it || {});
        target.innerHTML = iconSrc ? `<div class="slot-icon"><img src="${iconSrc}" alt="${it.name || it.itemName || 'Item'}"></div>` : '';
        target.dataset.inventoryId = info.inventoryId;

        // Tooltip
        target.addEventListener('mouseenter', (e) => {
          const tooltipItem = {
            itemName: it.name || it.itemName || '',
            itemType: it.type || it.itemType || '',
            equipmentSlot: it.equipmentSlot || null,
            description: it.description || '',
            stats: it.stats || {},
            rarity: it.rarity || 'common',
            quantity: it.quantity || 1,
            level: typeof it.level !== 'undefined' ? it.level : 1,
            iconName: it.iconName || null,
            inventoryId: info.inventoryId || null,
          };
          showTooltip(e, tooltipItem);
        });
        target.addEventListener('mousemove', moveTooltip);
        target.addEventListener('mouseleave', hideTooltip);
        target.addEventListener('mousedown', () => {
          try {
            const ct = getCurrentTooltip();
            if (ct) ct.style.zIndex = String(nextZIndex());
          } catch (e) {}
        });

        // Make slot draggable to allow unequip (drag to inventory)
        target.draggable = true;
        target.addEventListener('dragstart', (ev) => {
          const payload = JSON.stringify({ fromSlot: true, slot, inventoryId: info.inventoryId });
          try { ev.dataTransfer.setData('application/json', payload); } catch (_) { ev.dataTransfer.setData('text/plain', payload); }
        });

        // Right-click to unequip
        target.addEventListener('contextmenu', async (e) => {
          try {
            e.preventDefault();
            const form = new URLSearchParams();
            form.append('slot', slot);
            try {
              await emitOrApi('equipment:unequip', { slot }, '/equipment/unequip', form);
            } catch (err) {
              if (window.addLogMessage) window.addLogMessage(getErrorMessage(err, 'Failed to unequip item'), 'error');
            }
            const { openWindow } = await import('./windows.js');
            try { if (document.getElementById('inventory-window')?.style.display !== 'none') await openWindow('inventory-window'); } catch (e) {}
            try { if (document.getElementById('character-window')?.style.display !== 'none') await openWindow('character-window'); } catch (e) {}
          } catch (e) { console.error('equipment right-click unequip failed', e); }
        });
      } else {
        // Empty slot
        target.innerHTML = '';
        target.removeAttribute('data-inventory-id');
        target.draggable = false;

      }

      // Accept drops from inventory items
      target.addEventListener('dragover', (e) => { e.preventDefault(); target.classList.add('drag-over'); });
      target.addEventListener('dragleave', () => { target.classList.remove('drag-over'); });
      target.addEventListener('drop', async (e) => {
        e.preventDefault();
        target.classList.remove('drag-over');
        try {
          const payload = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
          if (!payload) return;
          const data = JSON.parse(payload);
          if (data.inventoryId) {
            const form = new URLSearchParams();
            form.append('inventoryId', data.inventoryId);
            try {
              await emitOrApi('equipment:equip', { inventoryId: data.inventoryId }, '/equipment/equip', form);
            } catch (err) {
              if (window.addLogMessage) window.addLogMessage(getErrorMessage(err, 'Failed to equip item'), 'error');
            }
            const { openWindow } = await import('./windows.js');
            try { if (document.getElementById('character-window')?.style.display !== 'none') await openWindow('character-window'); } catch (e) {}
            try { if (document.getElementById('inventory-window')?.style.display !== 'none') await openWindow('inventory-window'); } catch (e) {}
          }
        } catch (err) { console.error('Equip failed', err); }
      });
    });
  } catch (err) { console.error('displayEquipment error', err); }
}
