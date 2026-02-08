const { gameDb } = require('../config/database');
const logger = require('../config/logger');
const { getItemByTemplateKey, getActiveSpells, setActiveSpells, addActiveSpell } = require('../config/cache');

/**
 * Register spell-related socket handlers.
 * 
 * Events:
 *   spell:cast   — Cast a consumable spell from inventory (uses 1 quantity)
 *   spell:active — Get all active spells for the current user
 */
function registerSpellHandlers(socket, user, io, deps) {
  const { addPlayerLog } = deps;

  // ── Cast a spell ──
  socket.on('spell:cast', async (data, callback) => {
    try {
      const { inventoryId } = data || {};
      if (!inventoryId) return callback({ success: false, error: 'Missing inventoryId' });

      // Verify ownership and get item details
      const [invRows] = await gameDb.query(
        `SELECT i.inventory_id, i.item_id, i.quantity, it.template_key, it.name, it.type, it.stats, it.icon_name
         FROM inventory i
         JOIN items it ON i.item_id = it.item_id
         WHERE i.inventory_id = ? AND i.user_id = ?`,
        [inventoryId, user.userId]
      );

      if (invRows.length === 0) {
        return callback({ success: false, error: 'Item not found in your inventory' });
      }

      const invItem = invRows[0];

      // Must be a consumable with spell stats
      if (invItem.type !== 'consumable') {
        return callback({ success: false, error: 'This item cannot be cast as a spell' });
      }

      let stats;
      try {
        stats = typeof invItem.stats === 'string' ? JSON.parse(invItem.stats) : invItem.stats;
      } catch (e) {
        return callback({ success: false, error: 'Invalid item data' });
      }

      if (!stats || !stats.spell) {
        return callback({ success: false, error: 'This item is not a spell' });
      }

      // Check if this spell is already active (prevent stacking same spell)
      const [existingSpells] = await gameDb.query(
        'SELECT spell_id FROM active_spells WHERE user_id = ? AND spell_key = ? AND remaining > 0',
        [user.userId, stats.spell]
      );
      if (existingSpells.length > 0) {
        return callback({ success: false, error: 'This spell is already active' });
      }

      // Consume 1 quantity
      if (invItem.quantity > 1) {
        await gameDb.query(
          'UPDATE inventory SET quantity = quantity - 1 WHERE inventory_id = ?',
          [inventoryId]
        );
      } else {
        await gameDb.query(
          'DELETE FROM inventory WHERE inventory_id = ?',
          [inventoryId]
        );
      }

      // Insert active spell
      const now = Math.floor(Date.now() / 1000);
      const duration = stats.duration || 10;
      const [insertResult] = await gameDb.query(
        `INSERT INTO active_spells (user_id, spell_key, icon_name, heal_per_tick, mana_per_tick, duration, remaining, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.userId,
          stats.spell,
          invItem.icon_name || null,
          stats.heal_per_tick || 0,
          stats.mana_per_tick || 0,
          duration,
          duration,
          now
        ]
      );

      const spellId = insertResult.insertId;

      // Update Redis cache
      const spellObj = {
        spellId,
        spellKey: stats.spell,
        iconName: invItem.icon_name || null,
        healPerTick: stats.heal_per_tick || 0,
        manaPerTick: stats.mana_per_tick || 0,
        duration,
        remaining: duration
      };
      await addActiveSpell(user.userId, spellObj);

      // Emit to client
      socket.emit('spell:started', spellObj);
      socket.emit('inventory:refresh');

      // Log
      addPlayerLog(user.userId, `Cast ${invItem.name}`, 'success', io);

      logger.info('Spell cast', { userId: user.userId, spell: stats.spell, spellId });

      callback({
        success: true,
        spell: spellObj
      });

    } catch (error) {
      logger.error('spell:cast error', { userId: user.userId, error: error.message });
      callback({ success: false, error: 'Failed to cast spell' });
    }
  });

  // ── Get active spells ──
  socket.on('spell:active', async (data, callback) => {
    try {
      // Try Redis first
      let spells = await getActiveSpells(user.userId);
      if (spells === null) {
        // Fallback to DB
        const [rows] = await gameDb.query(
          `SELECT spell_id, spell_key, icon_name, heal_per_tick, mana_per_tick, duration, remaining
           FROM active_spells
           WHERE user_id = ? AND remaining > 0`,
          [user.userId]
        );
        spells = rows.map(r => ({
          spellId: r.spell_id,
          spellKey: r.spell_key,
          iconName: r.icon_name,
          healPerTick: r.heal_per_tick,
          manaPerTick: r.mana_per_tick,
          duration: r.duration,
          remaining: r.remaining
        }));
        await setActiveSpells(user.userId, spells);
      }

      callback({ success: true, spells });
    } catch (error) {
      logger.error('spell:active error', { userId: user.userId, error: error.message });
      callback({ success: false, error: 'Failed to get active spells' });
    }
  });
}

module.exports = { registerSpellHandlers };
