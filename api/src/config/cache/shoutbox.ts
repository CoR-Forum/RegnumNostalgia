/**
 * Cache: Shoutbox Messages
 *
 * Redis list for recent chat messages in chronological order
 * (oldest at head / index 0, newest at tail).
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
 * Stores in Redis list with oldest at head (index 0), newest at tail.
 * LRANGE 0..49 returns oldest-to-newest (chronological).
 */
async function setShoutboxMessages(messages: ShoutboxMessage[]): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.del(CACHE_KEYS.SHOUTBOX_MESSAGES);
    // RPUSH in chronological order: oldest at index 0, newest at tail
    for (const msg of messages) {
      pipeline.rpush(CACHE_KEYS.SHOUTBOX_MESSAGES, JSON.stringify(msg));
    }
    pipeline.ltrim(CACHE_KEYS.SHOUTBOX_MESSAGES, -SHOUTBOX_MAX_MESSAGES, -1);
    await pipeline.exec();
  } catch (e: any) {
    logger.error('Redis set failed (shoutbox messages)', { error: e.message });
  }
}

/**
 * Add a new shoutbox message to the cache (pushes to tail, trims oldest from head).
 */
async function addShoutboxMessage(message: ShoutboxMessage): Promise<void> {
  try {
    await redis.rpush(CACHE_KEYS.SHOUTBOX_MESSAGES, JSON.stringify(message));
    await redis.ltrim(CACHE_KEYS.SHOUTBOX_MESSAGES, -SHOUTBOX_MAX_MESSAGES, -1);
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
 * Uses a Lua script so the value only ever moves forward — safe to call
 * concurrently from multiple socket handlers without risking a rollback.
 */
const SET_IF_GREATER_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if tonumber(ARGV[1]) > cur then
  redis.call('SET', KEYS[1], ARGV[1])
  return 1
end
return 0
`;

async function setLastShoutboxId(id: number): Promise<void> {
  try {
    await redis.eval(SET_IF_GREATER_SCRIPT, 1, CACHE_KEYS.SHOUTBOX_LAST_ID, String(id));
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
