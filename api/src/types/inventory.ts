import type { UnixTimestamp } from './common';
import type { EquipmentSlotName } from './item';

// ─── Inventory row (as stored in MariaDB) ───────────────────────────────────

export interface InventoryRow {
  inventory_id: number;
  user_id: number;
  item_id: number;
  quantity: number;
  acquired_at: UnixTimestamp;
}

/** Inventory entry with joined item data (common query result) */
export interface InventoryWithItem extends InventoryRow {
  template_key: string;
  name: string;
  type: string;
  description: string | null;
  stats: string | null;
  rarity: string;
  stackable: 0 | 1;
  level: number;
  equipment_slot: EquipmentSlotName | null;
  icon_name: string | null;
  weight: number | null;
}

// ─── Equipment row (as stored in MariaDB) ───────────────────────────────────

export interface EquipmentRow {
  equipment_id: number;
  user_id: number;
  head: number | null;
  body: number | null;
  hands: number | null;
  shoulders: number | null;
  legs: number | null;
  weapon_right: number | null;
  weapon_left: number | null;
  ring_right: number | null;
  ring_left: number | null;
  amulet: number | null;
  created_at: UnixTimestamp;
  updated_at: UnixTimestamp;
}

// ─── Slot mapping helpers ───────────────────────────────────────────────────

/** Maps camelCase API slot names to snake_case DB column names */
export const SLOT_TO_DB: Record<string, EquipmentSlotName> = {
  head: 'head',
  body: 'body',
  hands: 'hands',
  shoulders: 'shoulders',
  legs: 'legs',
  weaponRight: 'weapon_right',
  weaponLeft: 'weapon_left',
  ringRight: 'ring_right',
  ringLeft: 'ring_left',
  amulet: 'amulet',
};

/** Maps snake_case DB column names to camelCase API slot names */
export const DB_TO_SLOT: Record<EquipmentSlotName, string> = {
  head: 'head',
  body: 'body',
  hands: 'hands',
  shoulders: 'shoulders',
  legs: 'legs',
  weapon_right: 'weaponRight',
  weapon_left: 'weaponLeft',
  ring_right: 'ringRight',
  ring_left: 'ringLeft',
  amulet: 'amulet',
};

// ─── Quickbar ───────────────────────────────────────────────────────────────

export interface QuickbarRow {
  id: number;
  user_id: number;
  row_index: number;
  slot_index: number;
  item_id: number;
  template_key: string;
}
