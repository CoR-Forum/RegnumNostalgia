- Database Migrations are never needed as I wipe the database on each run. Please do not add migration files or alter the database schema in any way. If you need to change the database schema, just update the init-db script (`api/scripts/init-db.ts`) and make sure to include any new columns in the relevant queries.

- It is super important that we always keep the README.md with all relevant information up to date. If you make any changes to the project, please make sure to update or extend the README.md file accordingly. This includes any changes to the setup instructions, API endpoints, or any other relevant information that users need to know.

- This project runs entirely in Docker. There is NO npm/node installed on the host macOS. All npm commands must be run inside Docker containers (e.g., `docker compose run --rm api npm install <pkg>` or via the Makefile).

---

## Architecture Overview

This is a real-time browser MMORPG built on a **dual-protocol** architecture:

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | TypeScript (ES Modules), Leaflet.js, Socket.IO Client | Bundled by Vite |
| **Backend** | TypeScript (CommonJS via tsx), Express.js, Socket.IO Server | Node 20 Alpine |
| **Database** | MariaDB 11.3 (game data), SQLite (screenshots) | mysql2/promise |
| **Cache/PubSub** | Redis 7 (ioredis) | Sorted sets, hashes, lists |
| **Job Queues** | Bull (Redis-backed) | 6 queues for background processing |
| **Reverse Proxy** | Nginx | Routes API, WebSocket, static assets, CDN proxy |
| **Containers** | Docker Compose (7 services) | `make dev` to start everything |

### Request Flow
1. **REST API** (`/api/`) — Authentication, screenshots, settings
2. **Socket.IO** (`/socket.io/`) — All real-time gameplay: movement, inventory, spells, chat, collectables
3. **Bull Queues** — Background ticking: walker movement (1s), health regen (1s), spell processing (1s), server time (10s), territory sync (10s), item spawning (5s)

---

## File Structure & Roles

### Backend (`api/src/`)

```
src/
├── server.ts              # Express + Socket.IO bootstrap, routes, Bull Board, startup/shutdown
├── types/                 # TypeScript interfaces for ALL domain entities
│   ├── index.ts           # Barrel export — import from './types'
│   ├── common.ts          # UnixTimestamp, DbBoolean, Realm, DbRow<T>
│   ├── player.ts          # PlayerRow, SocketUser, OnlinePlayerInfo, PlayerStats, DamageStats, ArmorStats
│   ├── item.ts            # ItemRow, Item, ItemTemplate, ItemStats, EquipmentSlotName, ItemType, ItemRarity
│   ├── inventory.ts       # InventoryRow, InventoryWithItem, EquipmentRow, QuickbarRow, SLOT_TO_DB, DB_TO_SLOT
│   ├── world.ts           # TerritoryRow, SuperbossRow, SpawnedItemRow, WalkerRow, WalkerCacheEntry, GameRegion, PathNode
│   ├── spells.ts          # ActiveSpellRow, SpellCooldown, SpellCastPayload
│   ├── settings.ts        # UserSettingsRow, UserSettingsPayload
│   ├── config.ts          # LootTable, LootPoolEntry, FixedSpawnPoint, RegionSpawnRule, QueueIntervals, etc.
│   ├── socket-events.ts   # ServerToClientEvents, ClientToServerEvents, TypedServer, TypedSocket, SocketHandlerDeps
│   └── cache.ts           # CacheKeyMap, CacheTTLMap
├── config/
│   ├── cache/             # Redis caching layer (split by domain)
│   │   ├── index.ts       # Barrel re-export — all consumers import from 'config/cache'
│   │   ├── keys.ts        # CACHE_KEYS and TTL constants
│   │   ├── items.ts       # Item/level lookups, preloadStaticData
│   │   ├── territories.ts # Territory & superboss cache
│   │   ├── serverTime.ts  # Server time cache
│   │   ├── players.ts     # Online tracking, last_active buffering, GM status
│   │   ├── settings.ts    # User settings cache
│   │   ├── walkers.ts     # Walker state & walk speed
│   │   ├── shoutbox.ts    # Chat message cache
│   │   └── spells.ts      # Active spells & spell cooldowns
│   ├── constants.ts       # All game constants, loot tables, spawn configs, queue intervals
│   ├── database.ts        # MariaDB pool (gameDb), Redis client, SQLite (screenshotsDb)
│   └── logger.ts          # Winston logger (file + console transports)
├── middleware/
│   └── auth.ts            # JWT validation for Express (authenticateJWT) and Socket.IO (authenticateSocket)
├── routes/
│   ├── auth.ts            # POST /login, POST /select (realm), GET /validate
│   ├── screenshots.ts     # CRUD for screenshots (SQLite + external PHP API)
│   └── settings.ts        # GET/POST user settings
├── services/
│   ├── pathfinding.ts     # Dijkstra pathfinding, wall detection, walker creation
│   ├── settingsService.ts # Settings upsert + camelCase↔snake_case parsing
│   ├── lootService.ts     # resolveLootTable() — loot roll logic (weighted/multi-drop/independent)
│   ├── inventoryService.ts # addToInventory() — stackable item insertion
│   └── regionTracker.ts   # Shared userRegions Map (userId → regionId) used by sockets + queues
├── sockets/
│   ├── index.ts           # Socket orchestrator: buildPlayerState(), connection handling, deps injection
│   ├── inventoryHandler.ts # inventory:get, equipment:equip/unequip, item:use (lucky boxes)
│   ├── shoutbox.ts        # Chat system + GM commands (/item, /itemrem)
│   ├── movementHandler.ts # position:update, move:request
│   ├── collectableHandler.ts # spawned-items:get, collectable:click
│   ├── editorHandler.ts   # Region/path/wall/water JSON editor (GM only)
│   ├── logHandler.ts      # Player log retrieval
│   ├── spellHandler.ts    # spell:cast, spell:active
│   └── quickbarHandler.ts # Quickbar CRUD (4 rows × 10 slots)
├── queues/
│   ├── index.ts           # Queue initialization + cleanup orchestrator
│   ├── walkerQueue.ts     # Movement tick processor (imports from lootService + inventoryService)
│   ├── healthQueue.ts     # Player/territory/superboss health regeneration
│   ├── spellQueue.ts      # Spell tick processing (heal/mana/damage per tick)
│   ├── territoryQueue.ts  # External warstatus API sync + capture detection
│   ├── timeQueue.ts       # In-game clock (150 real seconds = 1 game hour)
│   └── spawnQueue.ts      # Collectable item spawning (fixed + region-based)
└── utils/
    ├── geometry.ts        # pointInPolygon, distance, getRandomPointInPolygon, minDistanceToEdge
    └── permissions.ts     # isGM() — checks forum admin group
```

### Frontend (`frontend/src/`)

```
src/
├── login.ts          # Entry point (loaded by index.html). Auth flow, dynamic game loading
├── main.ts           # Game entry point (loaded dynamically). Side-effect imports all modules
├── state.ts          # Reactive pub/sub state store (subscribe, setState, batchUpdate, gameState)
├── init.ts           # Game bootstrap: HTML partials, map init, WebSocket init
├── socket-client.ts  # Central WebSocket hub: all server event handlers
├── api.ts            # HTTP helper (apiCall) + WebSocket-first helper (emitOrApi)
├── map-init.ts       # Leaflet map setup (v1 tiles, v2 overlays, WASD pan)
├── map-state.ts      # Coordinate conversion layer (gameToLatLng, latLngToGame)
├── rastercoords.ts   # Leaflet plugin for image-to-map coordinates
├── player.ts         # Local player state sync + marker creation
├── player-ui.ts      # HUD: health bar, stats, coordinates, reactive subscriptions
├── players.ts        # Other players: markers with realm-colored dots
├── walking.ts        # Click-to-move, region permission checks
├── context-menu.ts   # Right-click map menu
├── inventory.ts      # Inventory panel: drag, tooltip, right-click actions
├── equipment.ts      # Equipment panel: 10 slots, drag-to-equip
├── items.ts          # Item name/label utilities
├── tooltip.ts        # Item tooltip with lazy server detail fetching
├── quickbar.ts       # 4×10 quickbar: keyboard shortcuts, drag from inventory
├── spells.ts         # Active spell buffs UI + cooldown tracking
├── castbar.ts        # Spell casting progress bar
├── audio.ts          # Music/SFX playback, AudioManager on window
├── server-time.ts    # Day/night cycle UI
├── territories.ts    # Territory markers on map
├── superbosses.ts    # Superboss markers on map
├── screenshots.ts    # Screenshot markers on map
├── marker-utils.ts   # Generic marker lifecycle (updateMarkerCollection)
├── windows.ts        # Draggable window manager with localStorage persistence
└── utils.ts          # escapeHtml, formatDurationSeconds, getErrorMessage
```

---

## Coding Conventions

### Naming
- **Database columns**: `snake_case` (e.g., `user_id`, `max_health`, `template_key`)
- **TypeScript variables/functions**: `camelCase` (e.g., `userId`, `maxHealth`, `templateKey`)
- **Type/Interface names**: `PascalCase` with `Row` suffix for DB types (e.g., `PlayerRow`, `ItemRow`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `CACHE_KEYS`, `QUEUE_INTERVALS`)
- **Files**: `camelCase` in backend (e.g., `walkerQueue.ts`), `kebab-case` in frontend (e.g., `socket-client.ts`)
- **Socket events**: `noun:verb` pattern (e.g., `inventory:get`, `spell:cast`, `equipment:equip`)
- **Cache keys**: prefixed with `rn:` and colon-separated (e.g., `rn:items`, `rn:walker:{userId}`)

### Item Stats
The `items.stats` column stores a JSON string. Always call `JSON.parse(row.stats)` and type the result as `ItemStats` (from `types/item.ts`). Key stats properties:
- **Equipment**: `damage_slashing`, `armor_fire`, `walk_speed`, `hit`, `evasion`, `block`, `intelligence`, etc.
- **Spells**: `heal_per_tick`, `mana_per_tick`, `damage_per_tick`, `duration`, `cast_time`, `cooldown`, `max_spell_stack`, `spell_stack_mode`
- **Consumables**: `heal`, `mana_restore`, `loot_table`

### Dependency Injection Patterns
- **Socket handlers** receive a `deps: SocketHandlerDeps` object containing `buildPlayerState`, `addPlayerLog`, `getUserSocket`, `userRegions`
- **Queue modules** use `setSocketIO(io)` to receive the Socket.IO server instance
- **Cache functions** accept `gameDb` as a parameter (not imported) for DB fallback queries

### Database Queries
- All queries use `mysql2/promise` parameterized queries: `gameDb.query('SELECT ... WHERE id = ?', [id])`
- SQLite (screenshots only) uses callback-style API
- No ORM — raw SQL throughout. When adding a column, update both:
  1. `api/scripts/init-db.ts` (CREATE TABLE)
  2. All queries that SELECT/INSERT/UPDATE the affected table

### How To: Add a New Socket Event
1. Define the event in `types/socket-events.ts` (both `ServerToClientEvents` and `ClientToServerEvents`)
2. Add the handler in the appropriate `sockets/*Handler.ts` file
3. Register the handler in `sockets/index.ts` if it's a new handler file
4. Add client-side handling in `frontend/src/socket-client.ts`

### How To: Add a New Item Type
1. Create a JSON file in `api/gameData/items/` following existing format
2. Add the template_key entries — they get imported via `scripts/import-items.ts`
3. If it has special stats, ensure `ItemStats` in `types/item.ts` covers the properties
4. If consumable with `loot_table`, add the loot table in `config/constants.ts`

### How To: Add a New Queue
1. Create `api/src/queues/myQueue.ts` following `healthQueue.ts` as a template
2. Export `{ myQueue, initMyQueue, setSocketIO }`
3. Register in `api/src/queues/index.ts` (add to `initializeQueues` and `closeQueues`)
4. Add the queue interval in `config/constants.ts` → `QUEUE_INTERVALS`
5. Add the Bull adapter in `server.ts` for the admin dashboard