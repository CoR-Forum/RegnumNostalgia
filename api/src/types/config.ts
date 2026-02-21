import type { UnixTimestamp, Realm } from './common';

// ─── Loot table types ───────────────────────────────────────────────────────

export type LootMode = 'weighted' | 'multi-drop' | 'independent';

export interface LootPoolEntry {
  item: string;
  weight: number;
  quantity: [number, number];
}

export interface LootTable {
  mode: LootMode;
  /** Number of rolls (only for 'multi-drop' mode) */
  rolls?: number;
  /** Alias for rolls (only for 'multi-drop' mode) */
  drops?: number;
  pool: LootPoolEntry[];
}

/** Return type of resolveLootTable() */
export interface LootReward {
  itemId: number;
  templateKey: string;
  quantity: number;
}

// ─── Spawn point configuration ──────────────────────────────────────────────

export interface FixedSpawnPoint {
  id: string;
  x: number;
  y: number;
  realm: Realm | 'neutral';
  visual: string;
  type: string;
  lootTable: string;
  respawnTime: number;
  respawnMode: 'fixed' | 'pool';
}

export interface RegionSpawnRule {
  regions: string[];
  maxSpawns: number;
  respawnTime: number;
  realm: Realm | 'neutral';
  visual: string;
  type: string;
  lootTable: string;
  respawnMode: 'fixed' | 'pool';
}

// ─── Collectable config ─────────────────────────────────────────────────────

export interface CollectableConfig {
  PICKUP_RADIUS: number;
  RESPAWN_TIME: number;
}

// ─── Queue intervals ────────────────────────────────────────────────────────

export interface QueueIntervals {
  WALKER: number;
  HEALTH: number;
  SPELL: number;
  TIME: number;
  TERRITORY: number;
  SPAWN: number;
}

// ─── Regen rates ────────────────────────────────────────────────────────────

export interface RegenRates {
  PLAYER_HEALTH: number;
  PLAYER_MANA: number;
  FORT_HEALTH: number;
  CASTLE_HEALTH: number;
  WALL_HEALTH: number;
  SUPERBOSS_HEALTH: number;
}

// ─── Starter item ───────────────────────────────────────────────────────────

export interface StarterItem {
  template_key: string;
  quantity: number;
}

// ─── Spawn coords per realm ─────────────────────────────────────────────────

export interface SpawnCoords {
  x: number;
  y: number;
}

// ─── Bull job options ───────────────────────────────────────────────────────

export interface BullJobOptions {
  removeOnComplete: number;
  removeOnFail: number;
  attempts: number;
  backoff: {
    type: string;
    delay: number;
  };
}
