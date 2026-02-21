import type { UnixTimestamp, Realm, RealmOrNull } from './common';

// ─── Territory row (as stored in MariaDB) ───────────────────────────────────

export interface TerritoryRow {
  territory_id: number;
  realm: Realm;
  name: string;
  type: TerritoryType;
  health: number;
  max_health: number;
  x: number;
  y: number;
  owner_realm: RealmOrNull;
  owner_players: string | null;
  contested: 0 | 1;
  contested_since: UnixTimestamp | null;
  icon_name: string | null;
  icon_name_contested: string | null;
}

export type TerritoryType = 'castle' | 'fort' | 'wall';

// ─── Territory capture log ──────────────────────────────────────────────────

export interface TerritoryCaptureRow {
  capture_id: number;
  territory_id: number;
  previous_realm: RealmOrNull;
  new_realm: Realm;
  captured_at: UnixTimestamp;
}

// ─── Superboss ──────────────────────────────────────────────────────────────

export interface SuperbossRow {
  boss_id: number;
  name: string;
  icon_name: string | null;
  health: number;
  max_health: number;
  x: number;
  y: number;
  last_attacked: UnixTimestamp | null;
  respawn_time: UnixTimestamp | null;
}

// ─── Spawned item (collectables on the map) ─────────────────────────────────

export interface SpawnedItemRow {
  spawn_id: number;
  item_id: number | null;
  x: number;
  y: number;
  realm: Realm | 'neutral';
  type: string;
  loot_table_key: string | null;
  spawn_point_id: string | null;
  visual_icon: string;
  spawned_at: UnixTimestamp;
  collected_at: UnixTimestamp | null;
  collected_by: number | null;
}

// ─── Server time ────────────────────────────────────────────────────────────

export interface ServerTimeRow {
  id: number;
  started_at: UnixTimestamp;
  last_updated: UnixTimestamp;
  ingame_hour: number;
  ingame_minute: number;
  tick_seconds: number;
}

// ─── Walker (movement path state) ───────────────────────────────────────────

export interface WalkerRow {
  walker_id: number;
  user_id: number;
  /** JSON-serialized array of {x, y} positions */
  positions: string;
  current_index: number;
  started_at: UnixTimestamp;
  updated_at: UnixTimestamp;
  finished_at: UnixTimestamp | null;
  status: WalkerStatus;
  collecting_x: number | null;
  collecting_y: number | null;
  collecting_spawn_id: number | null;
}

export type WalkerStatus = 'new' | 'walking' | 'collecting' | 'finished';

/** Parsed walker position */
export interface WalkerPosition {
  x: number;
  y: number;
}

// ─── Walker cache entry (stored in Redis hash) ─────────────────────────────
// Uses snake_case keys because data is serialized from DB-shaped objects

export interface WalkerCacheEntry {
  walker_id: number;
  user_id: number;
  positions: string | WalkerPosition[];
  current_index: number;
  status: WalkerStatus;
  collecting_x: number | null;
  collecting_y: number | null;
  collecting_spawn_id: number | null;
  started_at?: UnixTimestamp;
}

// ─── Region (from gameData/regions.json) ────────────────────────────────────

export interface GameRegion {
  id: string;
  name: string;
  realm: Realm | 'neutral';
  type: string;
  points: [number, number][];
}

// ─── Path node (from gameData/paths.json) ───────────────────────────────────

export interface PathNode {
  id: string;
  x: number;
  y: number;
  connections: string[];
}

// ─── Wall segment (from gameData/walls.json) ────────────────────────────────

export interface WallSegment {
  id: string;
  points: [number, number][];
}
