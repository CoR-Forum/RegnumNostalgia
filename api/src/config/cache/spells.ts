/**
 * Cache: Active Spells & Spell Cooldowns
 *
 * Per-user active spell tracking and cooldown management in Redis.
 */
import type { ActiveSpellRow, SpellCooldown } from '../../types';

const { redis } = require('../database');
const logger = require('../logger');

const SPELL_KEY_PREFIX = 'cache:spells:active:';
const SPELL_COOLDOWNS_PREFIX = 'cache:spell_cooldowns:'; // + userId → hash of spellKey → JSON

// ── Active Spells ──

/**
 * Get all active spells for a user from Redis.
 * Returns an array of spell objects or null if not cached.
 */
async function getActiveSpells(userId: number): Promise<ActiveSpellRow[] | null> {
  try {
    const raw = await redis.get(`${SPELL_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    logger.error('getActiveSpells error', { userId, error: (e as any).message });
    return null;
  }
}

/**
 * Set the full active spells array for a user.
 */
async function setActiveSpells(userId: number, spells: ActiveSpellRow[]): Promise<void> {
  try {
    if (!spells || spells.length === 0) {
      await redis.del(`${SPELL_KEY_PREFIX}${userId}`);
    } else {
      await redis.set(`${SPELL_KEY_PREFIX}${userId}`, JSON.stringify(spells), 'EX', 300);
    }
  } catch (e) {
    logger.error('setActiveSpells error', { userId, error: (e as any).message });
  }
}

/**
 * Add a spell to a user's active spells.
 */
async function addActiveSpell(userId: number, spell: ActiveSpellRow): Promise<void> {
  try {
    const current = (await getActiveSpells(userId)) || [];
    current.push(spell);
    await setActiveSpells(userId, current);
  } catch (e) {
    logger.error('addActiveSpell error', { userId, error: (e as any).message });
  }
}

/**
 * Remove a spell by spellId from a user's active spells.
 */
async function removeActiveSpell(userId: number, spellId: number): Promise<void> {
  try {
    const current = (await getActiveSpells(userId)) || [];
    const filtered = current.filter(s => s.spell_id !== spellId);
    await setActiveSpells(userId, filtered);
  } catch (e: any) {
    logger.error('removeActiveSpell error', { userId, error: e.message });
  }
}

/**
 * Decrement remaining on all spells for a user, returning { expired, active } arrays.
 */
async function tickActiveSpells(userId: number): Promise<{ expired: ActiveSpellRow[]; active: ActiveSpellRow[] }> {
  try {
    const current = (await getActiveSpells(userId)) || [];
    if (current.length === 0) return { expired: [], active: [] };
    const expired = [];
    const active = [];
    for (const spell of current) {
      spell.remaining = (spell.remaining || 0) - 1;
      if (spell.remaining <= 0) {
        expired.push(spell);
      } else {
        active.push(spell);
      }
    }
    await setActiveSpells(userId, active);
    return { expired, active };
  } catch (e) {
    logger.error('tickActiveSpells error', { userId, error: (e as any).message });
    return { expired: [], active: [] };
  }
}

// ── Spell Cooldowns ──

/**
 * Set a cooldown for a spell. Uses a Redis hash per user.
 * @param {number} userId
 * @param {string} spellKey
 * @param {number} cooldownSeconds - total cooldown in seconds
 * @param {string|null} iconName - icon to display during cooldown
 */
async function setSpellCooldown(userId: number, spellKey: string, cooldownSeconds: number, iconName: string | null): Promise<void> {
  if (!cooldownSeconds || cooldownSeconds <= 0) return;
  try {
    const key = SPELL_COOLDOWNS_PREFIX + userId;
    const expiresAt = Math.floor(Date.now() / 1000) + cooldownSeconds;
    await redis.hset(key, spellKey, JSON.stringify({ expiresAt, total: cooldownSeconds, iconName: iconName || null }));
    // Ensure the hash expires eventually (max cooldown + buffer)
    const currentTtl = await redis.ttl(key);
    if (currentTtl < cooldownSeconds + 60) {
      await redis.expire(key, cooldownSeconds + 60);
    }
  } catch (e) {
    logger.error('setSpellCooldown error', { userId, spellKey, error: (e as any).message });
  }
}

/**
 * Get remaining cooldown for a specific spell. Returns { spellKey, remaining, total, iconName } or null.
 */
async function getSpellCooldown(userId: number, spellKey: string): Promise<SpellCooldown | null> {
  try {
    const key = SPELL_COOLDOWNS_PREFIX + userId;
    const raw = await redis.hget(key, spellKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    const remaining = data.expiresAt - now;
    if (remaining <= 0) {
      await redis.hdel(key, spellKey);
      return null;
    }
    return { spellKey, remaining, total: data.total, iconName: data.iconName };
  } catch (e) {
    logger.error('getSpellCooldown error', { userId, spellKey, error: (e as any).message });
    return null;
  }
}

/**
 * Get all active cooldowns for a user. Cleans up expired entries.
 * Returns array of { spellKey, remaining, total, iconName }.
 */
async function getAllSpellCooldowns(userId: number): Promise<SpellCooldown[]> {
  try {
    const key = SPELL_COOLDOWNS_PREFIX + userId;
    const all = await redis.hgetall(key);
    if (!all || Object.keys(all).length === 0) return [];
    const now = Math.floor(Date.now() / 1000);
    const result = [];
    const expiredKeys = [];
    for (const [spellKey, raw] of Object.entries(all)) {
      const data = JSON.parse(raw as string);
      const remaining = data.expiresAt - now;
      if (remaining <= 0) {
        expiredKeys.push(spellKey);
      } else {
        result.push({ spellKey, remaining, total: data.total, iconName: data.iconName });
      }
    }
    if (expiredKeys.length > 0) {
      await redis.hdel(key, ...expiredKeys);
    }
    return result;
  } catch (e) {
    logger.error('getAllSpellCooldowns error', { userId, error: (e as any).message });
    return [];
  }
}

module.exports = {
  getActiveSpells,
  setActiveSpells,
  addActiveSpell,
  removeActiveSpell,
  tickActiveSpells,
  setSpellCooldown,
  getSpellCooldown,
  getAllSpellCooldowns,
};
