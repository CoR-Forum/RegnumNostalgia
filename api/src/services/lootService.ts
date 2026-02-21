/**
 * Loot Service
 *
 * Resolves loot tables into concrete item rewards.
 * Supports 3 modes: weighted (pick 1), multi-drop (pick N), independent (each rolls).
 *
 * Extracted from walkerQueue.ts to avoid circular dependencies
 * and make the loot system reusable across socket handlers and queues.
 */
import type { LootReward, LootTable } from '../types';

const { gameDb } = require('../config/database');
const { LOOT_TABLES } = require('../config/constants');
const logger = require('../config/logger');
const { getItemByTemplateKey } = require('../config/cache');

/**
 * Resolve a loot table key into concrete item rewards.
 * @param lootTableKey - key into LOOT_TABLES constant
 * @returns Array of { itemId, templateKey, quantity }
 */
async function resolveLootTable(lootTableKey: string): Promise<LootReward[]> {
  const lootTable: LootTable = LOOT_TABLES[lootTableKey];
  if (!lootTable) {
    logger.warn(`Loot table not found: ${lootTableKey}`);
    return [];
  }

  const rewards = [];

  if (lootTable.mode === 'weighted') {
    // Pick ONE item from pool using weights
    const totalWeight = lootTable.pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    let selectedItem = null;

    for (const item of lootTable.pool) {
      roll -= item.weight;
      if (roll <= 0) {
        selectedItem = item;
        break;
      }
    }

    if (!selectedItem) selectedItem = lootTable.pool[0];

    // Get item_id from template_key (Redis cached)
    const cachedItem = await getItemByTemplateKey(gameDb, selectedItem.item);

    if (cachedItem) {
      const [minQty, maxQty] = selectedItem.quantity;
      const quantity = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
      rewards.push({ itemId: cachedItem.item_id, templateKey: selectedItem.item, quantity });
    }

  } else if (lootTable.mode === 'multi-drop') {
    // Pick N times from pool
    const dropCount = lootTable.drops || lootTable.rolls || 1;
    for (let i = 0; i < dropCount; i++) {
      const totalWeight = lootTable.pool.reduce((sum, item) => sum + item.weight, 0);
      let roll = Math.random() * totalWeight;
      let selectedItem = null;

      for (const item of lootTable.pool) {
        roll -= item.weight;
        if (roll <= 0) {
          selectedItem = item;
          break;
        }
      }

      if (!selectedItem) selectedItem = lootTable.pool[0];

      const cachedItem = await getItemByTemplateKey(gameDb, selectedItem.item);

      if (cachedItem) {
        const [minQty, maxQty] = selectedItem.quantity;
        const quantity = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
        rewards.push({ itemId: cachedItem.item_id, templateKey: selectedItem.item, quantity });
      }
    }

  } else if (lootTable.mode === 'independent') {
    // Each item rolls independently
    for (const item of lootTable.pool) {
      const totalWeight = lootTable.pool.reduce((sum, i) => sum + i.weight, 0);
      const roll = Math.random() * totalWeight;

      if (roll <= item.weight) {
        const cachedItem = await getItemByTemplateKey(gameDb, item.item);

        if (cachedItem) {
          const [minQty, maxQty] = item.quantity;
          const quantity = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
          rewards.push({ itemId: cachedItem.item_id, templateKey: item.item, quantity });
        }
      }
    }
  }

  return rewards;
}

module.exports = { resolveLootTable };
