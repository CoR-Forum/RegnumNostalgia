const { gameDb } = require('../config/database');
const logger = require('../config/logger');

/**
 * Register player log socket handlers.
 * @param {object} socket  - The connected socket instance
 * @param {object} user    - Authenticated user { userId, username, realm }
 */
function registerLogHandlers(socket, user) {

  /**
   * Handle log get messages
   */
  socket.on('log:get', async (data, callback) => {
    try {
      const [logs] = await gameDb.query(
        `SELECT log_id, user_id, message, log_type, created_at
         FROM player_logs
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [user.userId]
      );

      const chronological = logs.reverse();

      const logEntries = chronological.map(l => ({
        logId: l.log_id,
        userId: l.user_id,
        message: l.message,
        logType: l.log_type,
        createdAt: l.created_at
      }));

      // Also include recent territory capture events
      let mergedLogs = logEntries;
      try {
        const [captures] = await gameDb.query(
          `SELECT tc.capture_id, tc.territory_id, tc.previous_realm, tc.new_realm, tc.captured_at, t.name as territory_name
           FROM territory_captures tc
           LEFT JOIN territories t ON tc.territory_id = t.territory_id
           ORDER BY tc.captured_at DESC
           LIMIT 50`
        );

        const capturesChron = captures.reverse();

        const captureEntries = capturesChron.map(c => ({
          logId: null,
          userId: null,
          message: `${c.territory_name || 'Territory'} captured by ${c.new_realm}${c.previous_realm ? ' from ' + c.previous_realm : ''}`,
          logType: 'capture',
          createdAt: c.captured_at
        }));

        mergedLogs = logEntries.concat(captureEntries).sort((a, b) => a.createdAt - b.createdAt);
      } catch (e) {
        logger.error('Failed to fetch territory captures for logs', { error: e && e.message ? e.message : String(e), userId: user.userId });
      }

      if (callback) {
        callback({ success: true, logs: mergedLogs });
      }

      logger.info('Player logs retrieved', { 
        userId: user.userId,
        logCount: logs.length,
        captureCount: mergedLogs.length - logEntries.length
      });

    } catch (error) {
      logger.error('Failed to get player logs', { 
        error: error.message, 
        userId: user.userId 
      });
      if (callback) callback({ success: false, error: 'Failed to load logs' });
    }
  });
}

module.exports = { registerLogHandlers };
