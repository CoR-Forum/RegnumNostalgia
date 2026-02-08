const Bull = require('bull');
const { gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS, REGEN_RATES } = require('../config/constants');
const logger = require('../config/logger');
const { invalidateTerritories, invalidateSuperbosses } = require('../config/cache');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Health Regeneration Queue - Runs every 1 second
 * Regenerates health/mana for players, territories, and superbosses
 */
const healthQueue = new Bull('health-regeneration', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

healthQueue.process('regenerate-health', async (job) => {
  try {
    // Get players who need health/mana regeneration BEFORE updating
    const [playersNeedingRegen] = await gameDb.query(
      `SELECT user_id, health, max_health, mana, max_mana
       FROM players
       WHERE last_active > UNIX_TIMESTAMP() - 30
       AND (health < max_health OR mana < max_mana)`
    );

    if (playersNeedingRegen.length === 0) {
      return { playersRegenerated: 0, territoriesRegenerated: 0 };
    }

    // Regenerate player health and mana (only for players who need it)
    await gameDb.query(
      `UPDATE players 
       SET health = LEAST(health + ?, max_health),
           mana = LEAST(mana + ?, max_mana)
       WHERE health < max_health OR mana < max_mana`,
      [REGEN_RATES.PLAYER_HEALTH, REGEN_RATES.PLAYER_MANA]
    );

    // Get updated values for players who were regenerated
    if (io && playersNeedingRegen.length > 0) {
      const userIds = playersNeedingRegen.map(p => p.user_id);
      const [updatedPlayers] = await gameDb.query(
        `SELECT user_id, health, max_health, mana, max_mana
         FROM players
         WHERE user_id IN (?)`,
        [userIds]
      );

      updatedPlayers.forEach(player => {
        io.emit('player:health', {
          userId: player.user_id,
          health: player.health,
          maxHealth: player.max_health,
          mana: player.mana,
          maxMana: player.max_mana
        });
      });
    }

    // Regenerate territory health based on type
    const [territories] = await gameDb.query(
      `SELECT territory_id, name, type, health, max_health, contested
       FROM territories
       WHERE health < max_health`
    );

    for (const territory of territories) {
      let regenAmount = REGEN_RATES.FORT_HEALTH; // default for forts
      
      if (territory.type === 'castle') {
        regenAmount = REGEN_RATES.CASTLE_HEALTH;
      } else if (territory.type === 'wall') {
        regenAmount = REGEN_RATES.WALL_HEALTH;
      }

      const newHealth = Math.min(territory.health + regenAmount, territory.max_health);
      await gameDb.query(
        'UPDATE territories SET health = ? WHERE territory_id = ?',
        [newHealth, territory.territory_id]
      );

      // Update contested status
      if (newHealth >= territory.max_health && territory.contested) {
        // Territory fully healed, no longer contested
        await gameDb.query(
          'UPDATE territories SET contested = 0, contested_since = NULL WHERE territory_id = ?',
          [territory.territory_id]
        );

        // Invalidate Redis territory cache
        await invalidateTerritories();

        if (io) {
          // Include icon fields so clients can switch icons when contested state changes
          const [iconRows] = await gameDb.query(
            'SELECT icon_name, icon_name_contested FROM territories WHERE territory_id = ?',
            [territory.territory_id]
          );
          const icons = (iconRows && iconRows[0]) ? iconRows[0] : { icon_name: null, icon_name_contested: null };

          io.emit('territories:update', {
            territoryId: territory.territory_id,
            name: territory.name,
            contested: false,
            health: newHealth,
            maxHealth: territory.max_health,
            iconName: icons.icon_name,
            iconNameContested: icons.icon_name_contested
          });
        }
      } else if (newHealth < territory.max_health && !territory.contested) {
        // Territory damaged, mark as contested
        await gameDb.query(
          'UPDATE territories SET contested = 1, contested_since = NOW() WHERE territory_id = ?',
          [territory.territory_id]
        );

        // Invalidate Redis territory cache
        await invalidateTerritories();

        if (io) {
          // Include icon fields so clients can switch icons when contested state changes
          const [iconRows] = await gameDb.query(
            'SELECT icon_name, icon_name_contested FROM territories WHERE territory_id = ?',
            [territory.territory_id]
          );
          const icons = (iconRows && iconRows[0]) ? iconRows[0] : { icon_name: null, icon_name_contested: null };

          io.emit('territories:update', {
            territoryId: territory.territory_id,
            name: territory.name,
            contested: true,
            health: newHealth,
            maxHealth: territory.max_health,
            iconName: icons.icon_name,
            iconNameContested: icons.icon_name_contested
          });
        }
      }
    }

    // Regenerate superboss health (only emit if any actually changed)
    const [bossesNeedingRegen] = await gameDb.query(
      `SELECT boss_id FROM superbosses WHERE health < max_health`
    );

    if (bossesNeedingRegen.length > 0) {
      await gameDb.query(
        `UPDATE superbosses 
         SET health = LEAST(health + ?, max_health)
         WHERE health < max_health`,
        [REGEN_RATES.SUPERBOSS_HEALTH]
      );

      // Emit superboss health updates
      const [superbossRows] = await gameDb.query(
        'SELECT boss_id, name, health, max_health FROM superbosses WHERE boss_id IN (?)',
        [bossesNeedingRegen.map(b => b.boss_id)]
      );

      if (io && superbossRows.length > 0) {
        const superbosses = superbossRows.map(b => ({
          bossId: b.boss_id,
          name: b.name,
          health: b.health,
          maxHealth: b.max_health
        }));
        io.emit('superbosses:health', { superbosses });
      }

      // Invalidate Redis superboss cache
      await invalidateSuperbosses();
    }

    return { 
      territoriesRegenerated: territories.length,
      playersRegenerated: playersNeedingRegen.length,
      superbossesRegenerated: bossesNeedingRegen.length
    };

  } catch (error) {
    logger.error('Health queue error', { error: error.message });
    throw error;
  }
});

healthQueue.on('completed', (job, result) => {
  if (result.territoriesRegenerated > 0) {
    logger.debug('Health regeneration completed', result);
  }
});

healthQueue.on('failed', (job, err) => {
  logger.error('Health queue failed', { error: err.message });
});

async function initHealthQueue() {
  await healthQueue.add(
    'regenerate-health',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.HEALTH
      },
      ...BULL_JOB_OPTIONS
    }
  );
  logger.info('Health queue initialized', { interval: `${QUEUE_INTERVALS.HEALTH}ms` });
}

module.exports = {
  healthQueue,
  initHealthQueue,
  setSocketIO
};
