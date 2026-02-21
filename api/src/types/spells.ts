import type { UnixTimestamp } from './common';

// ─── Active spell row (as stored in MariaDB) ───────────────────────────────

export interface ActiveSpellRow {
  spell_id: number;
  user_id: number;
  spell_key: string;
  icon_name: string | null;
  heal_per_tick: number;
  mana_per_tick: number;
  damage_per_tick: number;
  walk_speed: number;
  stack_mode: SpellStackMode;
  duration: number;
  remaining: number;
  started_at: UnixTimestamp;
}

export type SpellStackMode = 'parallel' | 'sequential';

// ─── Spell cooldown (stored in Redis) ───────────────────────────────────────

export interface SpellCooldown {
  spellKey: string;
  remaining: number;
  total: number;
  iconName: string | null;
}

// ─── Spell cast request (from client) ───────────────────────────────────────

export interface SpellCastPayload {
  inventoryId: number;
  spellKey?: string;
}
