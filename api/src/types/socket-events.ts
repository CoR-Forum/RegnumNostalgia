import type { Server, Socket } from 'socket.io';
import type { SocketUser } from './player';
import type { OnlinePlayerInfo, PlayerStats } from './player';
import type { TerritoryRow, SuperbossRow, ServerTimeRow, SpawnedItemRow, WalkerPosition } from './world';
import type { InventoryWithItem, EquipmentRow } from './inventory';
import type { ActiveSpellRow, SpellCooldown } from './spells';
import type { UserSettingsRow } from './settings';

// ─── Socket.IO typed events ────────────────────────────────────────────────

/** Events emitted FROM server TO client */
export interface ServerToClientEvents {
  // Player
  'player:state': (data: PlayerStats) => void;
  'player:health': (data: { health: number; maxHealth: number; mana: number; maxMana: number }) => void;
  'player:xp': (data: { xp: number; level: number }) => void;
  'player:position': (data: { x: number; y: number }) => void;

  // Walker / movement
  'walker:step': (data: { x: number; y: number; index: number; total: number }) => void;
  'walker:finished': (data: { x: number; y: number }) => void;
  'walker:stopped': (data: { x: number; y: number; reason: string }) => void;

  // Other players
  'players:update': (players: OnlinePlayerInfo[]) => void;

  // Territories
  'territories:update': (territories: TerritoryRow[]) => void;
  'territory:captured': (data: { territoryId: number; newRealm: string; previousRealm: string | null }) => void;

  // Superbosses
  'superbosses:update': (bosses: SuperbossRow[]) => void;

  // Server time
  'time:update': (data: { hour: number; minute: number; icon: string }) => void;

  // Collectables
  'collectable:created': (data: SpawnedItemRow) => void;
  'collectable:collected': (data: { spawnId: number; collectedBy: number }) => void;
  'collectable:collect:failed': (data: { spawnId: number; reason: string }) => void;

  // Inventory
  'inventory:updated': (items: InventoryWithItem[]) => void;

  // Spells
  'spell:started': (spell: ActiveSpellRow) => void;
  'spell:update': (spells: ActiveSpellRow[]) => void;
  'spell:expired': (data: { spellKey: string }) => void;

  // Shoutbox
  'shoutbox:message': (message: ShoutboxMessage) => void;

  // Log
  'log:message': (entry: { message: string; type: string; timestamp: number }) => void;

  // Audio
  'audio:play': (data: { track: string; type?: string }) => void;
  'audio:stop': (data: { type?: string }) => void;

  // Paths/regions (editor)
  'paths:update': (data: unknown) => void;
  'regions:update': (data: unknown) => void;
}

/** Events emitted FROM client TO server */
export interface ClientToServerEvents {
  // Movement
  'position:update': (data: { x: number; y: number }) => void;
  'move:request': (data: { x: number; y: number; collectableSpawnId?: number }, callback?: SocketCallback) => void;

  // Inventory
  'inventory:get': (callback: SocketCallback<InventoryWithItem[]>) => void;
  'player:stats:get': (callback: SocketCallback<PlayerStats>) => void;
  'equipment:get': (callback: SocketCallback<Record<string, InventoryWithItem | null>>) => void;
  'item:details': (data: { itemId: number }, callback: SocketCallback) => void;
  'equipment:equip': (data: { inventoryId: number; slot: string }, callback: SocketCallback) => void;
  'equipment:unequip': (data: { slot: string }, callback: SocketCallback) => void;
  'item:use': (data: { inventoryId: number }, callback: SocketCallback) => void;

  // Spells
  'spell:cast': (data: { inventoryId: number }, callback: SocketCallback) => void;
  'spell:active': (callback: SocketCallback<ActiveSpellRow[]>) => void;

  // Quickbar
  'quickbar:load': (callback: SocketCallback) => void;
  'quickbar:set': (data: { row: number; slot: number; inventoryId: number; templateKey: string }, callback: SocketCallback) => void;
  'quickbar:clear': (data: { row: number; slot: number }, callback: SocketCallback) => void;
  'quickbar:move': (data: { fromRow: number; fromSlot: number; toRow: number; toSlot: number }, callback: SocketCallback) => void;

  // Collectables
  'spawned-items:get': (callback: SocketCallback<SpawnedItemRow[]>) => void;
  'collectable:click': (data: { spawnId: number }, callback?: SocketCallback) => void;

  // Shoutbox
  'shoutbox:get': (data: { since?: number }, callback: SocketCallback) => void;
  'shoutbox:send': (data: { message: string }, callback: SocketCallback) => void;

  // Log
  'log:get': (data: { limit?: number }, callback: SocketCallback) => void;

  // Settings
  'user:settings:update': (data: Record<string, unknown>, callback?: SocketCallback) => void;

  // Editor
  'editor:regions:get': (callback: SocketCallback) => void;
  'editor:region:save': (data: unknown, callback: SocketCallback) => void;
  'editor:region:delete': (data: { id: string }, callback: SocketCallback) => void;
  'editor:paths:get': (callback: SocketCallback) => void;
  'editor:path:save': (data: unknown, callback: SocketCallback) => void;
  'editor:path:delete': (data: { id: string }, callback: SocketCallback) => void;
  'editor:walls:get': (callback: SocketCallback) => void;
  'editor:wall:save': (data: unknown, callback: SocketCallback) => void;
  'editor:wall:delete': (data: { id: string }, callback: SocketCallback) => void;
  'editor:waters:get': (callback: SocketCallback) => void;
  'editor:water:save': (data: unknown, callback: SocketCallback) => void;
  'editor:water:delete': (data: { id: string }, callback: SocketCallback) => void;
}

/** Inter-server events (for Socket.IO adapter, not currently used) */
export interface InterServerEvents {
  ping: () => void;
}

/** Socket.data — per-connection data */
export interface SocketData {
  user: SocketUser;
}

// ─── Typed Socket.IO server and socket ──────────────────────────────────────

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// ─── Generic socket callback ────────────────────────────────────────────────

export type SocketCallback<T = unknown> = (response: SocketResponse<T>) => void;

export interface SocketResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Shoutbox message ───────────────────────────────────────────────────────

export interface ShoutboxMessage {
  entryID: number;
  username: string;
  message: string;
  time: number;
  userID: number;
}

// ─── Socket handler deps (dependency injection pattern) ─────────────────────

export interface SocketHandlerDeps {
  buildPlayerState: (userId: number) => Promise<PlayerStats>;
  addPlayerLog: (userId: number, message: string, logType: string, io: TypedServer) => Promise<void>;
  getUserSocket: (userId: number) => TypedSocket | undefined;
  userRegions: Map<number, string>;
}
