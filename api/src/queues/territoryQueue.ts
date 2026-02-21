const Bull = require('bull');
const axios = require('axios');
const { gameDb } = require('../config/database');
const { QUEUE_INTERVALS, BULL_JOB_OPTIONS, WARSTATUS_API_URL } = require('../config/constants');
const logger = require('../config/logger');
const { invalidateTerritories } = require('../config/cache');

let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

/**
 * Territory Queue - Fetches territory ownership from external API every 15 seconds
 */
const territoryQueue = new Bull('territory-sync', {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: BULL_JOB_OPTIONS
});

territoryQueue.process('sync-territories', async (job) => {
  try {
    // Fetch warstatus from external API
    const response = await axios.get(WARSTATUS_API_URL, {
      timeout: 5000
    });

    if (!response.data || !response.data.forts) {
      logger.warn('Invalid warstatus response');
      return { updated: 0 };
    }

    const forts = response.data.forts;
    let updatedCount = 0;
    const captures = [];

    for (const fort of forts) {
      const fortName = fort.name;
      
      // Extract territory_id from name (e.g., "Imperia Castle (1)" -> 1)
      const match = fortName.match(/\((\d+)\)$/);
      if (!match) {
        logger.warn('Could not extract territory_id from fort name', { name: fortName });
        continue;
      }
      
      const territoryId = parseInt(match[1]);
      // Normalize and validate owner value from external API
      const rawOwner = typeof fort.owner === 'string' ? fort.owner : null;
      const normalizedOwner = rawOwner ? rawOwner.toLowerCase().trim() : null;
      const VALID_REALMS = new Set(['alsius', 'syrtis', 'ignis']);
      const newOwner = VALID_REALMS.has(normalizedOwner) ? normalizedOwner : null;

      // Get current territory from database
      const [rows] = await gameDb.query(
        'SELECT territory_id, owner_realm, name FROM territories WHERE territory_id = ?',
        [territoryId]
      );

      if (rows.length === 0) {
        logger.warn('Territory not found in database', { name: fortName });
        continue;
      }

      const territory = rows[0];
      const previousOwner = territory.owner_realm;

      // Check if ownership changed
      if (previousOwner !== newOwner) {
        // Update territory ownership
        await gameDb.query(
          'UPDATE territories SET owner_realm = ? WHERE territory_id = ?',
          [newOwner, territory.territory_id]
        );

        // If new owner is a known realm, update icon names to match the realm
        if (newOwner) {
          const iconName = `fort-${newOwner}.png`;
          const iconNameContested = `fort-${newOwner}-contested.png`;
          await gameDb.query(
            'UPDATE territories SET icon_name = ?, icon_name_contested = ? WHERE territory_id = ?',
            [iconName, iconNameContested, territory.territory_id]
          );
        }

        // Record capture event
        const capturedAt = Math.floor(Date.now() / 1000);
        await gameDb.query(
          `INSERT INTO territory_captures (territory_id, previous_realm, new_realm, captured_at)
           VALUES (?, ?, ?, ?)`,
          [territory.territory_id, previousOwner, newOwner, capturedAt]
        );

        captures.push({
          territoryId: territory.territory_id,
          name: territory.name,
          previousOwner,
          newOwner,
          capturedAt
        });

        updatedCount++;
        
        logger.info('Territory captured', {
          territory: fortName,
          from: previousOwner || 'neutral',
          to: newOwner || 'neutral'
        });
      }
    }

    // Invalidate Redis territory cache when changes detected
    if (updatedCount > 0) {
      await invalidateTerritories();
    }

    // Emit territory capture events
    if (io && captures.length > 0) {
      io.emit('territories:capture', { captures });

      // Emit capture sound only to users who have sounds enabled and capture sounds enabled
      try {
        const sockets = io.sockets && io.sockets.sockets ? Array.from(io.sockets.sockets.values()) : [];
        for (const s of sockets) {
          try {
            const user = s && s.user ? s.user : null;
            const settings = user && user.settings ? user.settings : null;
            if (!settings) continue;
            // sfx should respect global sounds flag and capture specific flag
            if (settings.soundsEnabled && settings.captureSoundsEnabled) {
              const vol = typeof settings.captureSoundsVolume === 'number' ? settings.captureSoundsVolume : (typeof settings.soundVolume === 'number' ? settings.soundVolume : parseFloat(settings.soundVolume) || 1.0);
              s.emit('audio:play', {
                type: 'sfx',
                file: '53134-fort_captured.ogg',
                volume: vol,
                global: false,
                captures
              });
            }
          } catch (e) {
            // ignore per-socket errors
          }
        }
      } catch (e) {
        logger.error('Failed to emit audio event for territory captures', { error: e && e.message ? e.message : String(e) });
      }

      // Also emit full territory list update
      const [allTerritories] = await gameDb.query(
        `SELECT territory_id, realm, name, type, health, max_health, x, y,
                owner_realm, owner_players, contested, contested_since,
                icon_name, icon_name_contested
         FROM territories
         ORDER BY territory_id`
      );
      
      const territoriesPayload = allTerritories.map(t => ({
        territoryId: t.territory_id,
        realm: t.realm,
        name: t.name,
        type: t.type,
        health: t.health,
        maxHealth: t.max_health,
        x: t.x,
        y: t.y,
        ownerRealm: t.owner_realm,
        ownerPlayers: t.owner_players,
        contested: !!t.contested,
        contestedSince: t.contested_since,
        iconName: t.icon_name,
        iconNameContested: t.icon_name_contested
      }));
      
      io.emit('territories:update', { territories: territoriesPayload });
    }

    return { updated: updatedCount, captures: captures.length };

  } catch (error) {
    logger.error('Territory queue error', { error: error.message });
    
    // Don't throw error - we don't want the queue to stop on temporary network issues
    return { error: error.message, updated: 0 };
  }
});

territoryQueue.on('completed', (job, result) => {
  if (result.updated > 0) {
    logger.info('Territory sync completed', result);
  }
});

territoryQueue.on('failed', (job, err) => {
  logger.error('Territory queue failed', { error: err.message });
});

async function initTerritoryQueue() {
  await territoryQueue.add(
    'sync-territories',
    {},
    {
      repeat: {
        every: QUEUE_INTERVALS.TERRITORY
      },
      ...BULL_JOB_OPTIONS
    }
  );
  logger.info('Territory queue initialized', { interval: `${QUEUE_INTERVALS.TERRITORY}ms` });
}

module.exports = {
  territoryQueue,
  initTerritoryQueue,
  setSocketIO
};
