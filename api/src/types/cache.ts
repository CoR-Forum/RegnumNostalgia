// ─── Redis cache key prefixes and TTL values ───────────────────────────────

export interface CacheKeyMap {
  // Static (permanent cache)
  ITEM_BY_TEMPLATE: string;
  ITEM_BY_ID: string;
  LEVEL_XP: string;

  // Semi-static (invalidate on change)
  TERRITORIES: string;
  SUPERBOSSES: string;
  SERVER_TIME: string;

  // Per-user
  USER_SETTINGS: string;
  USER_GM: string;
  USER_EQUIPMENT_IDS: string;
  USER_EQUIPMENT_STATS: string;

  // Online tracking
  ONLINE_PLAYERS: string;
  PLAYER_INFO: string;

  // last_active buffering
  LAST_ACTIVE: string;

  // Shoutbox
  SHOUTBOX_MESSAGES: string;
  SHOUTBOX_LAST_ID: string;

  // Walker
  ACTIVE_WALKERS: string;
  USER_WALKER: string;
  WALK_SPEED: string;
}

export interface CacheTTLMap {
  USER_SETTINGS: number;
  USER_GM: number;
  USER_EQUIPMENT: number;
  TERRITORIES: number;
  SUPERBOSSES: number;
  SERVER_TIME: number;
  PLAYER_INFO: number;
}
