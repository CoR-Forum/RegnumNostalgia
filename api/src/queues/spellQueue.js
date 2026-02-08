const Bull = require('bull');
const { gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS } = require('../config/constants');
const logger = require('../config/logger');
const { getActiveSpells, tickActiveSpells, setActiveSpells } = require('../config/cache');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Spell Queue - Runs every 1 second
 * Processes active spells: applies heal/mana ticks, decrements remaining, expires finished spells.
 */
const spellQueue = new Bull('spell-processor', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

spellQueue.process('process-spells', async (job) => {
  try {
    // Get all active spells from DB
    const [activeSpells] = await gameDb.query(
      `SELECT spell_id, user_id, spell_key, icon_name, heal_per_tick, mana_per_tick, duration, remaining
       FROM active_spells
       WHERE remaining > 0`
    );

    if (activeSpells.length === 0) {
      return { processed: 0 };
    }

    // Group spells by user
    const byUser = {};
    for (const spell of activeSpells) {
      if (!byUser[spell.user_id]) byUser[spell.user_id] = [];
      byUser[spell.user_id].push(spell);
    }

    let processed = 0;
    const expiredSpellIds = [];

    for (const [userIdStr, spells] of Object.entries(byUser)) {
      const userId = parseInt(userIdStr, 10);
      let totalHeal = 0;
      let totalMana = 0;
      const userExpired = [];
      const userActive = [];

      for (const spell of spells) {
        totalHeal += spell.heal_per_tick || 0;
        totalMana += spell.mana_per_tick || 0;
        spell.remaining -= 1;

        if (spell.remaining <= 0) {
          expiredSpellIds.push(spell.spell_id);
          userExpired.push(spell);
        } else {
          userActive.push(spell);
        }
      }

      // Apply heal/mana to player
      if (totalHeal > 0 || totalMana > 0) {
        await gameDb.query(
          `UPDATE players
           SET health = LEAST(health + ?, max_health),
               mana = LEAST(mana + ?, max_mana)
           WHERE user_id = ?`,
          [totalHeal, totalMana, userId]
        );
      }

      // Decrement remaining on non-expired spells
      for (const spell of userActive) {
        await gameDb.query(
          'UPDATE active_spells SET remaining = ? WHERE spell_id = ?',
          [spell.remaining, spell.spell_id]
        );
      }

      // Update Redis cache for this user
      const cachedActive = userActive.map(s => ({
        spellId: s.spell_id,
        spellKey: s.spell_key,
        iconName: s.icon_name,
        healPerTick: s.heal_per_tick,
        manaPerTick: s.mana_per_tick,
        duration: s.duration,
        remaining: s.remaining
      }));
      await setActiveSpells(userId, cachedActive);

      // Emit updated health/mana + active spells to client
      if (io) {
        const [rows] = await gameDb.query(
          'SELECT health, max_health, mana, max_mana FROM players WHERE user_id = ?',
          [userId]
        );
        if (rows.length > 0) {
          const p = rows[0];
          io.emit('player:health', {
            userId,
            health: p.health,
            maxHealth: p.max_health,
            mana: p.mana,
            maxMana: p.max_mana
          });
        }

        // Emit spell update so UI can refresh timers
        io.emit('spell:update', {
          userId,
          activeSpells: cachedActive
        });

        // Notify client of expired spells
        for (const spell of userExpired) {
          io.emit('spell:expired', {
            userId,
            spellKey: spell.spell_key,
            spellId: spell.spell_id
          });
        }
      }

      processed += spells.length;
    }

    // Delete expired spells from DB
    if (expiredSpellIds.length > 0) {
      await gameDb.query(
        'DELETE FROM active_spells WHERE spell_id IN (?)',
        [expiredSpellIds]
      );
    }

    return { processed, expired: expiredSpellIds.length };

  } catch (error) {
    logger.error('Spell queue error', { error: error.message });
    throw error;
  }
});

spellQueue.on('completed', (job, result) => {
  if (result.processed > 0) {
    logger.debug('Spell processing completed', result);
  }
});

spellQueue.on('failed', (job, err) => {
  logger.error('Spell queue failed', { error: err.message });
});

async function initSpellQueue() {
  await spellQueue.add(
    'process-spells',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.SPELL
      },
      ...BULL_JOB_OPTIONS
    }
  );
  logger.info('Spell queue initialized', { interval: `${QUEUE_INTERVALS.SPELL}ms` });
}

module.exports = {
  spellQueue,
  initSpellQueue,
  setSocketIO
};
