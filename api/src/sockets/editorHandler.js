const fs = require('fs').promises;
const path = require('path');
const logger = require('../config/logger');
const { forumDb } = require('../config/database');
const { getCachedGMStatus } = require('../config/cache');

async function isGM(userId) {
  try {
    return await getCachedGMStatus(forumDb, userId);
  } catch (error) {
    logger.error('Failed to check GM status', { error: error.message, userId });
    return false;
  }
}

const DATA_FILES = {
  regions: path.join(__dirname, '../../gameData/regions.json'),
  paths: path.join(__dirname, '../../gameData/paths.json'),
  walls: path.join(__dirname, '../../gameData/walls.json'),
  water: path.join(__dirname, '../../gameData/water.json')
};

async function readJsonFile(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Default configuration for each entity type.
 * `defaults` are applied to new items if keys are missing.
 * `requiredFields` are validated on save.
 */
const ENTITY_CONFIG = {
  regions: {
    requiredFields: ['id', 'name'],
    defaults: {},
    plural: 'regions',
    singular: 'region'
  },
  paths: {
    requiredFields: ['id', 'name'],
    defaults: { positions: [], loop: false },
    plural: 'paths',
    singular: 'path'
  },
  walls: {
    requiredFields: ['id', 'name'],
    defaults: { positions: [] },
    plural: 'walls',
    singular: 'wall'
  },
  water: {
    requiredFields: ['id', 'name'],
    defaults: { positions: [], opacity: 0.4, color: '#3b82f6' },
    plural: 'water',
    singular: 'water'
  }
};

/**
 * Register all editor (region/path/wall/water) CRUD socket handlers.
 * Uses a factory approach to eliminate boilerplate duplication.
 * @param {object} socket  - The connected socket instance
 * @param {object} user    - Authenticated user { userId, username, realm }
 * @param {object} io      - Socket.io server instance
 */
function registerEditorHandlers(socket, user, io) {

  for (const [entityType, config] of Object.entries(ENTITY_CONFIG)) {
    const filePath = DATA_FILES[entityType];
    const { requiredFields, defaults, plural, singular } = config;

    // GET all
    socket.on(`editor:${plural}:get`, async (callback) => {
      try {
        const data = await readJsonFile(filePath);
        callback({ success: true, data });
      } catch (error) {
        logger.error(`Failed to get ${plural}`, { error: error.message, userId: user.userId });
        callback({ success: false, error: `Failed to load ${plural}` });
      }
    });

    // SAVE (create or update)
    socket.on(`editor:${singular}:save`, async (data, callback) => {
      if (!(await isGM(user.userId))) {
        logger.warn(`Unauthorized editor save attempt`, { userId: user.userId, entityType });
        return callback({ success: false, error: 'Permission denied: GM access required' });
      }
      try {
        const items = await readJsonFile(filePath);
        const { item, isNew } = data;

        // Validate required fields
        for (const field of requiredFields) {
          if (!item[field]) {
            return callback({ success: false, error: `${singular.charAt(0).toUpperCase() + singular.slice(1)} must have ${requiredFields.join(' and ')}` });
          }
        }

        // Apply defaults for new items
        if (isNew) {
          for (const [key, value] of Object.entries(defaults)) {
            if (typeof item[key] === 'undefined') {
              item[key] = value;
            }
          }
        }

        if (isNew) {
          if (items.find(i => i.id === item.id)) {
            return callback({ success: false, error: `${singular.charAt(0).toUpperCase() + singular.slice(1)} with this id already exists` });
          }
          items.push(item);
        } else {
          const index = items.findIndex(i => i.id === item.id);
          if (index === -1) {
            return callback({ success: false, error: `${singular.charAt(0).toUpperCase() + singular.slice(1)} not found` });
          }
          items[index] = item;
        }

        await writeJsonFile(filePath, items);
        logger.info(`${singular.charAt(0).toUpperCase() + singular.slice(1)} saved`, { id: item.id, userId: user.userId });

        io.emit(`editor:${plural}:updated`);
        callback({ success: true, data: item });
      } catch (error) {
        logger.error(`Failed to save ${singular}`, { error: error.message, userId: user.userId });
        callback({ success: false, error: `Failed to save ${singular}` });
      }
    });

    // DELETE
    socket.on(`editor:${singular}:delete`, async (data, callback) => {
      if (!(await isGM(user.userId))) {
        logger.warn(`Unauthorized editor delete attempt`, { userId: user.userId, entityType });
        return callback({ success: false, error: 'Permission denied: GM access required' });
      }
      try {
        const items = await readJsonFile(filePath);
        const { id } = data;

        const index = items.findIndex(i => i.id === id);
        if (index === -1) {
          return callback({ success: false, error: `${singular.charAt(0).toUpperCase() + singular.slice(1)} not found` });
        }

        items.splice(index, 1);
        await writeJsonFile(filePath, items);
        logger.info(`${singular.charAt(0).toUpperCase() + singular.slice(1)} deleted`, { id, userId: user.userId });

        io.emit(`editor:${plural}:updated`);
        callback({ success: true });
      } catch (error) {
        logger.error(`Failed to delete ${singular}`, { error: error.message, userId: user.userId });
        callback({ success: false, error: `Failed to delete ${singular}` });
      }
    });
  }
}

module.exports = { registerEditorHandlers };
