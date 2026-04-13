import type { UnixTimestamp, DbBoolean } from './common';

// ─── User settings row (as stored in MariaDB) ──────────────────────────────

export interface UserSettingsRow {
  user_id: number;
  music_enabled: DbBoolean;
  music_volume: number;
  sounds_enabled: DbBoolean;
  sound_volume: number;
  capture_sounds_enabled: DbBoolean;
  capture_sounds_volume: number;
  collection_sounds_enabled: DbBoolean;
  collection_sounds_volume: number;
  map_version: string;
  quickbar_tooltips_enabled: DbBoolean;
  show_territory_names: DbBoolean;
  show_player_names: DbBoolean;
  show_superboss_names: DbBoolean;
  show_collectable_labels: DbBoolean;
  updated_at: UnixTimestamp;
}

// ─── Settings payload from client (camelCase) ───────────────────────────────

export interface UserSettingsPayload {
  musicEnabled?: boolean;
  musicVolume?: number;
  soundsEnabled?: boolean;
  soundVolume?: number;
  captureSoundsEnabled?: boolean;
  captureSoundsVolume?: number;
  collectionSoundsEnabled?: boolean;
  collectionSoundsVolume?: number;
  mapVersion?: string;
  quickbarTooltipsEnabled?: boolean;
  showTerritoryNames?: boolean;
  showPlayerNames?: boolean;
  showSuperbossNames?: boolean;
  showCollectableLabels?: boolean;
}
