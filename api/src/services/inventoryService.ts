/**
 * Inventory Service
 *
 * Handles adding items to player inventories with stackability logic.
 *
 * Extracted from walkerQueue.ts to avoid circular dependencies
 * and make inventory operations reusable across socket handlers and queues.
 */
export {};

const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const { getItemById } = require('../config/cache');

/**
 * Add an item to a player's inventory, handling stackable items.
 * @param userId - player to receive the item
 * @param itemId - item_id from the items table
 * @param quantity - how many to add
 * @returns inventoryId of the new/updated row, or null on failure
 */
async function addToInventory(userId: number, itemId: number, quantity: number): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000);

  // Check if item is stackable (Redis cached)
  const cachedItem = await getItemById(gameDb, itemId);

  if (!cachedItem) {
    logger.warn(`Item not found: ${itemId}`);
    return null;
  }

  if (cachedItem.stackable) {
    // Try to stack with existing item
    const [existing] = await gameDb.query(
      'SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
      [userId, itemId]
    );

    if (existing.length > 0) {
      // Update existing stack
      await gameDb.query(
        'UPDATE inventory SET quantity = quantity + ? WHERE inventory_id = ?',
        [quantity, existing[0].inventory_id]
      );
      return existing[0].inventory_id;
    }
  }

  // Create new inventory entry
  const [result] = await gameDb.query(
    'INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?)',
    [userId, itemId, quantity, now]
  );

  return result.insertId;
}

module.exports = { addToInventory };
