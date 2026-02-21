import type { UnixTimestamp, Realm, RealmOrNull } from './common';

// ─── Database row (as stored in MariaDB) ────────────────────────────────────

export interface PlayerRow {
  user_id: number;
  username: string;
  realm: RealmOrNull;
  x: number;
  y: number;
  health: number;
  max_health: number;
  mana: number;
  max_mana: number;
  xp: number;
  level: number;
  intelligence: number;
  dexterity: number;
  concentration: number;
  strength: number;
  constitution: number;
  last_active: UnixTimestamp;
}

// ─── Session row ────────────────────────────────────────────────────────────

export interface SessionRow {
  session_id: string;
  user_id: number;
  username: string;
  realm: RealmOrNull;
  created_at: UnixTimestamp;
  expires_at: UnixTimestamp;
  last_activity: UnixTimestamp;
  fingerprint: string | null;
}

// ─── Authenticated user attached to socket/request ──────────────────────────

export interface SocketUser {
  userId: number;
  username: string;
  realm: Realm;
  settings?: import('./settings').UserSettingsRow;
}

// ─── Online player info (sent over WebSocket) ───────────────────────────────

export interface OnlinePlayerInfo {
  userId: number;
  username: string;
  realm: Realm;
  x: number;
  y: number;
  level: number;
  health: number;
  maxHealth: number;
}

// ─── Player stats computed from equipment ───────────────────────────────────

export interface PlayerStats {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  xp: number;
  level: number;
  x: number;
  y: number;
  intelligence: number;
  dexterity: number;
  concentration: number;
  strength: number;
  constitution: number;
  /** Aggregate damage values from equipment */
  damage: DamageStats;
  /** Aggregate armor values from equipment */
  armor: ArmorStats;
  /** Walk speed modifier from active spells/equipment */
  walkSpeed: number;
  /** Whether the player is currently walking */
  isWalking: boolean;
}

export interface DamageStats {
  slashing: number;
  piercing: number;
  crushing: number;
  fire: number;
  ice: number;
  lightning: number;
}

export interface ArmorStats {
  slashing: number;
  piercing: number;
  crushing: number;
  fire: number;
  ice: number;
  lightning: number;
}

// ─── Player log entry ───────────────────────────────────────────────────────

export type LogType = 'info' | 'success' | 'error' | 'warning' | 'combat' | 'system' | 'loot';

export interface PlayerLogRow {
  log_id: number;
  user_id: number;
  message: string;
  log_type: LogType;
  created_at: UnixTimestamp;
}
