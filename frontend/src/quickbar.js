/**
 * Quickbar — 4 rows × 10 slots at the bottom-left, next to the HUD buttons.
 * Players drag items from inventory onto quickbar slots for quick use.
 * Left-click a filled slot to use/cast the item.
 * Drag items between slots to move/swap them, or drag outside to remove.
 * Scroll (mouse wheel or arrow buttons) to switch between the 4 rows.
 */

import { isCasting, startCasting } from './castbar.js';
import { isSpellOnCooldown, getActiveSpellCount, getSpellCooldownRemaining } from './spells.js';

const ROWS = 4;
const SLOTS = 10;

/** @type {Array<Array<{itemId:number, templateKey:string, name:string, iconName:string, type:string, rarity:string, spellKey:string|null, cooldown:number}|null>>} */
let quickbarData = Array.from({ length: ROWS }, () => Array(SLOTS).fill(null));

let activeRow = 0;
let initialized = false;

/**
 * Initialize quickbar: build DOM, load data, wire events.
 * Call once after DOM is ready and socket is available.
 */
export function initQuickbar() {
  if (initialized) return;
  initialized = true;

  buildQuickbarDOM();
  renderActiveRow();
  loadFromServer();

  // Listen for socket reconnect to reload
  window.addEventListener('websocket:connected', () => loadFromServer());
}

// ── DOM Construction ──

function buildQuickbarDOM() {
  const container = document.getElementById('quickbar');
  if (!container) return;

  // Arrow up button
  const arrowUp = document.createElement('div');
  arrowUp.id = 'quickbar-arrow-up';
  arrowUp.className = 'quickbar-arrow';
  arrowUp.addEventListener('click', () => setActiveRow((activeRow - 1 + ROWS) % ROWS));
  container.appendChild(arrowUp);

  // Row indicator
  const rowIndicator = document.createElement('img');
  rowIndicator.id = 'quickbar-row-indicator';
  rowIndicator.src = `https://cor-forum.de/regnum/RegnumNostalgia/ui/quickbar-pos${activeRow + 1}.png`;
  rowIndicator.draggable = false;
  container.appendChild(rowIndicator);

  // Arrow down button
  const arrowDown = document.createElement('div');
  arrowDown.id = 'quickbar-arrow-down';
  arrowDown.className = 'quickbar-arrow';
  arrowDown.addEventListener('click', () => setActiveRow((activeRow + 1) % ROWS));
  container.appendChild(arrowDown);

  // Slots container
  const slotsContainer = document.createElement('div');
  slotsContainer.id = 'quickbar-slots';
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'quickbar-slot';
    slot.dataset.slot = i;

    // Drop target
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => onSlotDrop(e, i));

    // Left-click = use
    slot.addEventListener('click', () => onSlotClick(i));

    // Prevent context menu
    slot.addEventListener('contextmenu', (e) => e.preventDefault());

    slotsContainer.appendChild(slot);
  }
  container.appendChild(slotsContainer);

  // Scroll wheel to change rows
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) setActiveRow((activeRow + 1) % ROWS);
    else setActiveRow((activeRow - 1 + ROWS) % ROWS);
  });

  // Keyboard shortcuts: keys 1-0 for slots, Shift+Scroll or arrows for row switch
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Number keys 1-0 for quick use
    const key = e.key;
    if (key >= '1' && key <= '9') {
      onSlotClick(parseInt(key, 10) - 1);
    } else if (key === '0') {
      onSlotClick(9);
    }
  });
}

// ── Row Management ──

function setActiveRow(row) {
  activeRow = row;
  const indicator = document.getElementById('quickbar-row-indicator');
  if (indicator) indicator.src = `https://cor-forum.de/regnum/RegnumNostalgia/ui/quickbar-pos${activeRow + 1}.png`;
  renderActiveRow();
}

// ── Rendering ──

function renderActiveRow() {
  const slotsContainer = document.getElementById('quickbar-slots');
  if (!slotsContainer) return;

  const slotEls = slotsContainer.querySelectorAll('.quickbar-slot');
  for (let i = 0; i < SLOTS; i++) {
    const el = slotEls[i];
    if (!el) continue;

    const data = quickbarData[activeRow][i];
    renderSlot(el, i, data);
  }
}

function renderSlot(el, slotIndex, data) {
  // Clear existing content
  el.innerHTML = '';
  el.draggable = false;
  el.classList.remove('filled');

  if (!data) {
    el.title = '';
    return;
  }

  el.classList.add('filled');
  el.title = data.name || data.templateKey;
  el.draggable = true;

  // Dragstart: set data for moving within quickbar
  el.ondragstart = (e) => {
    const payload = {
      fromQuickbar: true,
      row: activeRow,
      slot: slotIndex,
      itemId: data.itemId,
      templateKey: data.templateKey,
      name: data.name,
      iconName: data.iconName
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  };

  // Dragend: if dropped outside quickbar, remove item
  el.ondragend = (e) => {
    if (e.dataTransfer.dropEffect === 'none') {
      // Dragged outside any valid drop target - remove from quickbar
      const socket = window.socket || (window.getSocket && window.getSocket());
      if (socket && socket.connected) {
        socket.emit('quickbar:clear', { row: activeRow, slot: slotIndex }, (resp) => {
          if (resp && resp.success) {
            quickbarData[activeRow][slotIndex] = null;
            renderActiveRow();
          }
        });
      }
    }
  };

  // Add slot number
  const keyLabel = document.createElement('span');
  keyLabel.className = 'quickbar-slot-key';
  keyLabel.textContent = slotIndex === 9 ? '0' : `${slotIndex + 1}`;
  el.appendChild(keyLabel);

  if (data.iconName) {
    const img = document.createElement('img');
    img.src = `https://cor-forum.de/regnum/RegnumNostalgia/items/${data.iconName}`;
    img.alt = data.name || '';
    img.draggable = false;
    el.appendChild(img);
  }

  // Cooldown overlay
  if (data.spellKey) {
    const cd = getSpellCooldownRemaining(data.spellKey);
    if (cd) {
      const overlay = document.createElement('div');
      overlay.className = 'quickbar-cd-overlay';
      overlay.innerHTML = `<span class="quickbar-cd-timer">${cd.remaining}s</span>`;
      el.appendChild(overlay);
    }
  }
}

/**
 * Called externally (from spells.js tick) to update cooldown overlays on quickbar.
 */
export function updateQuickbarCooldowns() {
  const slotsContainer = document.getElementById('quickbar-slots');
  if (!slotsContainer) return;

  const slotEls = slotsContainer.querySelectorAll('.quickbar-slot');
  for (let i = 0; i < SLOTS; i++) {
    const el = slotEls[i];
    const data = quickbarData[activeRow][i];
    if (!data || !data.spellKey) continue;

    let overlay = el.querySelector('.quickbar-cd-overlay');
    const cd = getSpellCooldownRemaining(data.spellKey);

    if (cd) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'quickbar-cd-overlay';
        overlay.innerHTML = '<span class="quickbar-cd-timer"></span>';
        el.appendChild(overlay);
      }
      const timer = overlay.querySelector('.quickbar-cd-timer');
      if (timer) timer.textContent = `${cd.remaining}s`;
    } else {
      if (overlay) overlay.remove();
    }
  }
}

// ── Drag & Drop ──

function onSlotDrop(e, slotIndex) {
  e.preventDefault();
  const slotEl = e.currentTarget;
  slotEl.classList.remove('drag-over');

  let payload;
  try {
    const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (!raw) return;
    payload = JSON.parse(raw);
  } catch { return; }

  const socket = window.socket || (window.getSocket && window.getSocket());
  if (!socket || !socket.connected) return;

  // Check if dragging from another quickbar slot
  if (payload.fromQuickbar) {
    const sourceRow = payload.row;
    const sourceSlot = payload.slot;
    const targetRow = activeRow;
    const targetSlot = slotIndex;

    // Don't do anything if dropping on the same slot
    if (sourceRow === targetRow && sourceSlot === targetSlot) return;

    // Move/swap items
    socket.emit('quickbar:move', { 
      sourceRow, 
      sourceSlot, 
      targetRow, 
      targetSlot 
    }, (resp) => {
      if (resp && resp.success) {
        // Update local data
        const sourceData = quickbarData[sourceRow][sourceSlot];
        const targetData = quickbarData[targetRow][targetSlot];
        
        quickbarData[targetRow][targetSlot] = sourceData;
        quickbarData[sourceRow][sourceSlot] = targetData;
        
        renderActiveRow();
      }
    });
  } else {
    // Dragging from inventory - add to quickbar
    const itemId = payload.itemId;
    if (!itemId) return;

    socket.emit('quickbar:set', { row: activeRow, slot: slotIndex, itemId }, (resp) => {
      if (resp && resp.success && resp.slot) {
        quickbarData[activeRow][slotIndex] = resp.slot;
        renderActiveRow();
      }
    });
  }
}

// ── Slot Click (Use) ──

async function onSlotClick(slotIndex) {
  const data = quickbarData[activeRow][slotIndex];
  if (!data) return;

  const socket = window.socket || (window.getSocket && window.getSocket());
  if (!socket || !socket.connected) return;

  // Helper: find an inventory item matching this template_key
  const findInventoryItem = () => new Promise((resolve, reject) => {
    socket.emit('inventory:get', (resp) => {
      if (resp && resp.success && Array.isArray(resp.items)) {
        resolve(resp.items.find(it => it.templateKey === data.templateKey) || null);
      } else {
        reject(new Error('Failed to load inventory'));
      }
    });
  });

  // Helper: find which equipment slot holds this template_key (returns { slot, inventoryId } or null)
  const findEquippedSlot = () => new Promise((resolve, reject) => {
    socket.emit('equipment:get', (resp) => {
      if (!resp || !resp.success) return reject(new Error('Failed to load equipment'));
      const eq = resp.equipment;
      // Slot names from the equipment response
      const slotNames = ['head', 'body', 'hands', 'shoulders', 'legs',
                         'weaponRight', 'weaponLeft', 'ringRight', 'ringLeft', 'amulet'];
      for (const sn of slotNames) {
        const entry = eq[sn];
        if (entry && entry.item && entry.item.templateKey === data.templateKey) {
          return resolve({ slot: sn, inventoryId: entry.inventoryId });
        }
      }
      resolve(null);
    });
  });

  try {
    const invItem = await findInventoryItem();

    // If the item is in inventory, get its details and use/equip it
    if (invItem) {
      const itemDetails = await getItemDetails(socket, invItem.inventoryId);
      const isUsable = itemDetails.type === 'premium' && itemDetails.stats && itemDetails.stats.loot_table;
      const isSpell = itemDetails.type === 'consumable' && itemDetails.stats && itemDetails.stats.spell;

      if (isSpell) {
        if (isCasting()) { if (window.addLogMessage) window.addLogMessage('Already casting a spell', 'error'); return; }
        const _spellKey = itemDetails.stats.spell;
        const _cdRemaining = getSpellCooldownRemaining(_spellKey);
        if (isSpellOnCooldown(_spellKey)) { if (window.addLogMessage) window.addLogMessage(`Spell is on cooldown (${_cdRemaining ? _cdRemaining.remaining + 's' : ''})`, 'error'); return; }
        const maxStack = itemDetails.stats.max_spell_stack || 1;
        if (getActiveSpellCount(_spellKey) >= maxStack) { if (window.addLogMessage) window.addLogMessage('Maximum spell stacks reached', 'error'); return; }

        const castTime = itemDetails.stats.cast_time || 0;
        if (castTime > 0) {
          await startCasting({
            name: itemDetails.name || itemDetails.stats.spell,
            castTime,
            inventoryId: invItem.inventoryId,
            iconName: itemDetails.icon_name
          });
        } else {
          await emitAsync(socket, 'spell:cast', { inventoryId: invItem.inventoryId });
        }
      } else if (isUsable) {
        await emitAsync(socket, 'item:use', { inventoryId: invItem.inventoryId });
      } else {
        // Equip from inventory
        const { emitOrApi } = await import('./api.js');
        const form = new URLSearchParams();
        form.append('inventoryId', invItem.inventoryId);
        await emitOrApi('equipment:equip', { inventoryId: invItem.inventoryId }, '/equipment/equip', form);
        await refreshWindows();
      }
    } else {
      // Item not in inventory — maybe it's already equipped → unequip it
      const equipped = await findEquippedSlot();
      if (equipped) {
        const { emitOrApi } = await import('./api.js');
        const form = new URLSearchParams();
        form.append('slot', equipped.slot);
        await emitOrApi('equipment:unequip', { slot: equipped.slot }, '/equipment/unequip', form);
        await refreshWindows();
      } else {
        if (window.addLogMessage) window.addLogMessage('You don\'t have this item', 'warning');
      }
    }
  } catch (err) {
    if (window.addLogMessage) window.addLogMessage(err.message || 'Failed to use quickbar item', 'error');
  }
}

/** Emit a socket event and return a promise */
function emitAsync(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (resp) => {
      if (resp && resp.success) resolve(resp);
      else reject(new Error(resp?.error || `Failed: ${event}`));
    });
  });
}

/** Get full item details by inventoryId */
function getItemDetails(socket, inventoryId) {
  return new Promise((resolve, reject) => {
    socket.emit('item:details', { inventoryId }, (resp) => {
      if (resp && resp.success) resolve(resp.item);
      else reject(new Error('Failed to get item details'));
    });
  });
}

/** Refresh open inventory/character windows */
async function refreshWindows() {
  try {
    const { openWindow } = await import('./windows.js');
    if (document.getElementById('character-window')?.style.display !== 'none') await openWindow('character-window');
    if (document.getElementById('inventory-window')?.style.display !== 'none') await openWindow('inventory-window');
  } catch (e) { /* ignore */ }
}

// ── Server Load ──

function loadFromServer() {
  const socket = window.socket || (window.getSocket && window.getSocket());
  if (!socket || !socket.connected) return;

  socket.emit('quickbar:load', {}, (resp) => {
    if (resp && resp.success && Array.isArray(resp.slots)) {
      // Reset data
      quickbarData = Array.from({ length: ROWS }, () => Array(SLOTS).fill(null));
      for (const s of resp.slots) {
        if (s.row >= 0 && s.row < ROWS && s.slot >= 0 && s.slot < SLOTS) {
          quickbarData[s.row][s.slot] = s;
        }
      }
      renderActiveRow();
    }
  });
}
