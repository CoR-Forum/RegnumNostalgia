const { forumDb } = require('../config/database');
const { getCachedGMStatus } = require('../config/cache');
const logger = require('../config/logger');

/**
 * Check if a user has GM/Admin permissions.
 * Uses Redis-cached forum group membership, falling back to forumDb.
 * @param {number} userId - The user ID to check
 * @returns {Promise<boolean>} - True if user is GM/Admin
 */
async function isGM(userId) {
  try {
    return await getCachedGMStatus(forumDb, userId);
  } catch (error) {
    logger.error('Failed to check GM status', { error: error.message, userId });
    return false;
  }
}

module.exports = { isGM };
