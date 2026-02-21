/**
 * Cache: Shoutbox Messages
 *
 * Redis list for recent chat messages (newest at head).
 * Includes last polled entry ID for external forum shoutbox sync.
 */
import type { ShoutboxMessage } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');
const { CACHE_KEYS } = require('./keys');

const SHOUTBOX_MAX_MESSAGES = 50;

/**
 * Get cached shoutbox messages. Returns array of message objects or null if cache miss.
 */
async function getCachedShoutboxMessages(): Promise<ShoutboxMessage[] | null> {
  try {
    const cached = await redis.lrange(CACHE_KEYS.SHOUTBOX_MESSAGES, 0, SHOUTBOX_MAX_MESSAGES - 1);
    if (cached && cached.length > 0) {
      return cached.map((m: string) => JSON.parse(m));
    }
  } catch (e: any) {
    logger.error('Redis get failed (shoutbox messages)', { error: e.message });
  }
  return null;
}

/**
 * Initialize shoutbox cache with an array of messages (oldest first / chronological order).
 * Stores in Redis list with newest at head (LPUSH) so LRANGE 0..49 returns newest first.
 * We reverse to push oldest first so newest ends up at head.
 */
async function setShoutboxMessages(messages: ShoutboxMessage[]): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.del(CACHE_KEYS.SHOUTBOX_MESSAGES);
    // Push in reverse order so newest is at index 0
    for (let i = messages.length - 1; i >= 0; i--) {
      pipeline.lpush(CACHE_KEYS.SHOUTBOX_MESSAGES, JSON.stringify(messages[i]));
    }
    pipeline.ltrim(CACHE_KEYS.SHOUTBOX_MESSAGES, 0, SHOUTBOX_MAX_MESSAGES - 1);
    await pipeline.exec();
  } catch (e: any) {
    logger.error('Redis set failed (shoutbox messages)', { error: e.message });
  }
}

/**
 * Add a new shoutbox message to the cache (pushes to head, trims to max).
 */
async function addShoutboxMessage(message: ShoutboxMessage): Promise<void> {
  try {
    await redis.lpush(CACHE_KEYS.SHOUTBOX_MESSAGES, JSON.stringify(message));
    await redis.ltrim(CACHE_KEYS.SHOUTBOX_MESSAGES, 0, SHOUTBOX_MAX_MESSAGES - 1);
  } catch (e: any) {
    logger.error('Redis push failed (shoutbox message)', { error: e.message });
  }
}

/**
 * Get the last polled shoutbox entry ID from Redis.
 */
async function getLastShoutboxId(): Promise<number> {
  try {
    const val = await redis.get(CACHE_KEYS.SHOUTBOX_LAST_ID);
    return val ? parseInt(val, 10) : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Set the last polled shoutbox entry ID in Redis.
 */
async function setLastShoutboxId(id: number): Promise<void> {
  try {
    await redis.set(CACHE_KEYS.SHOUTBOX_LAST_ID, String(id));
  } catch (e: any) {
    logger.error('Redis set failed (shoutbox last id)', { error: e.message });
  }
}

module.exports = {
  getCachedShoutboxMessages,
  setShoutboxMessages,
  addShoutboxMessage,
  getLastShoutboxId,
  setLastShoutboxId,
};
