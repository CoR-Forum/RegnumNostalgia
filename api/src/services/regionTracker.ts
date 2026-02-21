/**
 * Region Tracker
 *
 * Shared Map tracking the last-known region ID for each connected user.
 * Used by both socket handlers (on movement events) and the walker queue
 * (on tick-based movement) to detect region transitions and trigger
 * region-specific logic (e.g., audio changes, territory permissions).
 *
 * Consolidates the previously duplicated Maps from sockets/index.ts
 * and queues/walkerQueue.ts into a single source of truth.
 */

/** Map<userId, regionId | null> */
const userRegions: Map<number, string | null> = new Map();

module.exports = { userRegions };
