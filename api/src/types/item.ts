// ─── Item stats parsed from the JSON `stats` column ─────────────────────────

export interface ItemStats {
  /** Equipment: damage values */
  damage_slashing?: number;
  damage_piercing?: number;
  damage_crushing?: number;
  damage_fire?: number;
  damage_ice?: number;
  damage_lightning?: number;

  /** Equipment: armor values */
  armor_slashing?: number;
  armor_piercing?: number;
  armor_crushing?: number;
  armor_fire?: number;
  armor_ice?: number;
  armor_lightning?: number;

  /** Equipment: attribute bonuses */
  intelligence?: number;
  dexterity?: number;
  concentration?: number;
  strength?: number;
  constitution?: number;

  /** Equipment: hit/evasion/block */
  hit?: number;
  evasion?: number;
  block?: number;

  /** Equipment: movement speed modifier (percentage, e.g. 15 = +15%) */
  walk_speed?: number;

  /** Consumable: health/mana restoration */
  heal?: number;
  mana_restore?: number;

  /** Spell: per-tick effects */
  heal_per_tick?: number;
  mana_per_tick?: number;
  damage_per_tick?: number;

  /** Spell: duration in seconds */
  duration?: number;
  /** Spell: cast time in seconds */
  cast_time?: number;
  /** Spell: cooldown in seconds */
  cooldown?: number;
  /** Spell: stacking rules */
  max_spell_stack?: number;
  spell_stack_mode?: 'parallel' | 'sequential';

  /** Lucky box / consumable: loot table reference */
  loot_table?: string;

  /** General: level requirement */
  level_requirement?: number;

  /** Catch-all for any additional stats */
  [key: string]: number | string | undefined;
}

// ─── Item row (as stored in MariaDB) ────────────────────────────────────────

export interface ItemRow {
  item_id: number;
  template_key: string;
  name: string;
  type: ItemType;
  description: string | null;
  /** JSON string — call JSON.parse() to get ItemStats */
  stats: string | null;
  rarity: ItemRarity;
  stackable: 0 | 1;
  level: number;
  equipment_slot: EquipmentSlotName | null;
  icon_name: string | null;
  weight: number | null;
}

/** Item with parsed stats (post-JSON.parse) */
export interface Item extends Omit<ItemRow, 'stats'> {
  stats: ItemStats | null;
}

// ─── Item template (from gameData JSON files) ───────────────────────────────

export interface ItemTemplate {
  template_key: string;
  name: string;
  type: ItemType;
  description: string;
  stats: ItemStats;
  rarity: ItemRarity;
  stackable: 0 | 1;
  level: number;
  equipment_slot: EquipmentSlotName | null;
  icon_name: string;
}

// ─── Enums / unions ─────────────────────────────────────────────────────────

export type ItemType =
  | 'weapon'
  | 'armor'
  | 'consumable'
  | 'spell'
  | 'currency'
  | 'misc'
  | 'premium'
  | 'magic_gem'
  | string;

export type ItemRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'unique'
  | string;

export type EquipmentSlotName =
  | 'head'
  | 'body'
  | 'hands'
  | 'shoulders'
  | 'legs'
  | 'weapon_right'
  | 'weapon_left'
  | 'ring_right'
  | 'ring_left'
  | 'amulet';
