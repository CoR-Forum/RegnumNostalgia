const { gameDb } = require('../config/database');
const logger = require('../config/logger');

/**
 * Register quickbar-related socket handlers.
 *
 * Events:
 *   quickbar:load   — Load all quickbar slots for the current user
 *   quickbar:set    — Assign an item to a quickbar slot
 *   quickbar:clear  — Remove an item from a quickbar slot
 *   quickbar:move   — Move/swap items between quickbar slots
 */
function registerQuickbarHandlers(socket, user) {

  // ── Load all quickbar slots ──
  socket.on('quickbar:load', async (data, callback) => {
    try {
      const [rows] = await gameDb.query(
        `SELECT qb.row_index, qb.slot_index, qb.item_id, qb.template_key,
                i.name, i.icon_name, i.type, i.rarity, i.stats
         FROM quickbars qb
         JOIN items i ON qb.item_id = i.item_id
         WHERE qb.user_id = ?
         ORDER BY qb.row_index, qb.slot_index`,
        [user.userId]
      );

      const slots = rows.map(r => {
        let stats = null;
        try { stats = typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats; } catch (e) { /* ignore */ }
        return {
          row: r.row_index,
          slot: r.slot_index,
          itemId: r.item_id,
          templateKey: r.template_key,
          name: r.name,
          iconName: r.icon_name,
          type: r.type,
          rarity: r.rarity,
          spellKey: stats?.spell || null,
          cooldown: stats?.cooldown || 0
        };
      });

      if (callback) callback({ success: true, slots });
    } catch (error) {
      logger.error('quickbar:load error', { userId: user.userId, error: error.message });
      if (callback) callback({ success: false, error: 'Failed to load quickbar' });
    }
  });

  // ── Set a quickbar slot ──
  socket.on('quickbar:set', async (data, callback) => {
    try {
      const { row, slot, itemId } = data || {};
      if (row == null || slot == null || !itemId) {
        return callback({ success: false, error: 'Missing row, slot, or itemId' });
      }
      if (row < 0 || row >= 5 || slot < 0 || slot >= 10) {
        return callback({ success: false, error: 'Invalid row/slot index' });
      }

      // Verify the item exists
      const [itemRows] = await gameDb.query(
        'SELECT item_id, template_key FROM items WHERE item_id = ?',
        [itemId]
      );
      if (itemRows.length === 0) {
        return callback({ success: false, error: 'Item not found' });
      }

      const templateKey = itemRows[0].template_key;

      // Upsert: INSERT … ON DUPLICATE KEY UPDATE
      await gameDb.query(
        `INSERT INTO quickbars (user_id, row_index, slot_index, item_id, template_key)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE item_id = VALUES(item_id), template_key = VALUES(template_key)`,
        [user.userId, row, slot, itemId, templateKey]
      );

      // Return the saved slot with item info
      const [infoRows] = await gameDb.query(
        `SELECT i.name, i.icon_name, i.type, i.rarity, i.stats
         FROM items i WHERE i.item_id = ?`,
        [itemId]
      );
      const info = infoRows[0];
      let stats = null;
      try { stats = typeof info.stats === 'string' ? JSON.parse(info.stats) : info.stats; } catch (e) { /* ignore */ }

      callback({
        success: true,
        slot: {
          row, slot, itemId, templateKey,
          name: info.name,
          iconName: info.icon_name,
          type: info.type,
          rarity: info.rarity,
          spellKey: stats?.spell || null,
          cooldown: stats?.cooldown || 0
        }
      });

    } catch (error) {
      logger.error('quickbar:set error', { userId: user.userId, error: error.message });
      if (callback) callback({ success: false, error: 'Failed to set quickbar slot' });
    }
  });

  // ── Clear a quickbar slot ──
  socket.on('quickbar:clear', async (data, callback) => {
    try {
      const { row, slot } = data || {};
      if (row == null || slot == null) {
        return callback({ success: false, error: 'Missing row or slot' });
      }

      await gameDb.query(
        'DELETE FROM quickbars WHERE user_id = ? AND row_index = ? AND slot_index = ?',
        [user.userId, row, slot]
      );

      callback({ success: true });
    } catch (error) {
      logger.error('quickbar:clear error', { userId: user.userId, error: error.message });
      if (callback) callback({ success: false, error: 'Failed to clear quickbar slot' });
    }
  });

  // ── Move/swap quickbar slots ──
  socket.on('quickbar:move', async (data, callback) => {
    try {
      const { sourceRow, sourceSlot, targetRow, targetSlot } = data || {};
      if (sourceRow == null || sourceSlot == null || targetRow == null || targetSlot == null) {
        return callback({ success: false, error: 'Missing source or target indices' });
      }

      // Get both slots
      const [sourceRows] = await gameDb.query(
        'SELECT item_id, template_key FROM quickbars WHERE user_id = ? AND row_index = ? AND slot_index = ?',
        [user.userId, sourceRow, sourceSlot]
      );
      const [targetRows] = await gameDb.query(
        'SELECT item_id, template_key FROM quickbars WHERE user_id = ? AND row_index = ? AND slot_index = ?',
        [user.userId, targetRow, targetSlot]
      );

      const sourceItem = sourceRows[0] || null;
      const targetItem = targetRows[0] || null;

      if (!sourceItem) {
        return callback({ success: false, error: 'Source slot is empty' });
      }

      // Perform the swap/move in a transaction
      await gameDb.query('START TRANSACTION');

      try {
        // Clear both slots first
        await gameDb.query(
          'DELETE FROM quickbars WHERE user_id = ? AND ((row_index = ? AND slot_index = ?) OR (row_index = ? AND slot_index = ?))',
          [user.userId, sourceRow, sourceSlot, targetRow, targetSlot]
        );

        // Move source to target
        await gameDb.query(
          'INSERT INTO quickbars (user_id, row_index, slot_index, item_id, template_key) VALUES (?, ?, ?, ?, ?)',
          [user.userId, targetRow, targetSlot, sourceItem.item_id, sourceItem.template_key]
        );

        // If target had an item, move it to source
        if (targetItem) {
          await gameDb.query(
            'INSERT INTO quickbars (user_id, row_index, slot_index, item_id, template_key) VALUES (?, ?, ?, ?, ?)',
            [user.userId, sourceRow, sourceSlot, targetItem.item_id, targetItem.template_key]
          );
        }

        await gameDb.query('COMMIT');
        callback({ success: true });
      } catch (error) {
        await gameDb.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('quickbar:move error', { userId: user.userId, error: error.message });
      if (callback) callback({ success: false, error: 'Failed to move quickbar item' });
    }
  });
}

module.exports = { registerQuickbarHandlers };
