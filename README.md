# Regnum Nostalgia

A fully-featured browser-based MMORPG built on the nostalgic Old World map from Regnum Online (now Champions of Regnum). This project features real-time WebSocket multiplayer, interactive Leaflet-based map viewer, and a complete RPG backend with authentication, character progression, combat, inventory management, and background job processing.

![Regnum Map](https://github.com/CoR-Forum/RegnumMap-Nostalgia/blob/main/screenshot-3.png?raw=true)

## 🎮 Features

### Core Gameplay
- **Forum Authentication**: Login with cor-forum.de credentials via JWT tokens
- **Three Realms**: Choose between Syrtis (Elves), Alsius (Dwarves), or Ignis (Humans) - permanent choice
- **Real-time Movement**: Click-to-move pathfinding with animated walking between waypoints (1s updates)
- **Live Multiplayer**: See other players in real-time via WebSocket (98% reduction in HTTP requests)
- **Character Progression**: Level 1-60 with XP-based advancement system
- **Territory & Boss Tracking**: Monitor realm-owned forts/castles and world bosses with live health and respawn timers (combat UI not yet available)

### Advanced Systems
- **Inventory & Equipment**: 10 equipment slots (head, body, hands, shoulders, legs, weapons, rings, amulet)
- **Item System**: Weapons, armor, consumables, mounts with rarity tiers (common, uncommon, rare, epic, legendary)
- **Spell System**: Consumable items cast as timed buffs (health/mana potions restore over time, speed potions boost walk speed, damage potions deal damage over time), with active spell UI, cast bar, stacking rules (parallel/sequential), and per-spell cooldowns
- **Mount System**: Mount items can be used from inventory or quickbar to cast a speed buff; mounts are not consumed on use and remain in the player's inventory; each mount has a specific walk speed bonus, duration, cast time, and cooldown
- **Quickbar**: 4 rows × 10 slots for quick item use; drag items from inventory to add, drag between slots to move/swap, drag outside to remove; scroll between rows with mouse wheel or arrow buttons, keyboard shortcuts (1-0); hover tooltips (toggleable in settings); persisted in database
- **Attribute System**: Intelligence, Dexterity, Concentration, Strength, Constitution (stored server-side; UI display planned)
- **Territory Control**: Realm-owned forts and castles with health and vulnerability mechanics
- **World Bosses**: Superbosses with spawn timers and respawn mechanics
- **In-game Time**: Server-synchronized day/night cycle (150s = 1 ingame hour)
- **Path Builder**: Create and share custom routes across the map
- **Screenshot Manager**: Upload, organize, and manage screenshots with multilingual metadata (EN/DE/ES)

### Technical Features
- **WebSocket Real-Time**: Socket.io for instant updates with auto-reconnection
- **Session Management**: JWT-based 24-hour sessions with Redis storage
- **Background Workers**: Bull queue system for health regen, spell processing, time sync, walking processor, territory updates, collectable spawning
- **MariaDB Database**: Persistent storage for players, items, territories, sessions
- **Redis Pub/Sub**: Real-time event broadcasting across workers
- **RESTful API**: Node.js/Express backend with comprehensive endpoints
- **Responsive UI**: Draggable windows, HUD elements, territory/boss overlays
- **Queue Monitoring**: Bull Board dashboard for job management

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- cor-forum.de account for authentication

### Installation

1. **Clone the repository**:
```bash
git clone https://github.com/yourusername/regnum-nostalgia.git
cd regnum-nostalgia
```

2. **Configure environment** (create `.env` file):
```env
COR_FORUM_API_KEY=your_api_key_here
SCREENSHOTS_API_KEY=your_screenshots_api_key_here
JWT_SECRET=your_secure_random_string_here  # REQUIRED — generate with: openssl rand -hex 32
NODE_ENV=development
REDIS_HOST=redis
GAME_DB_HOST=db
GAME_DB_PORT=3306
GAME_DB_NAME=regnum_game
GAME_DB_USER=regnum
GAME_DB_PASS=regnum123
```

3. **Start the containers**:
```bash
docker compose up -d
```

4. **Verify services**:
```bash
# Check all containers running
docker compose ps

# View API logs
docker compose logs -f api

# Check queue dashboard
open http://localhost/admin/queues
```

5. **Access the game**:
Open http://localhost/game in your browser

6. **Login & Play**:
   - Use your cor-forum.de credentials
   - Select your realm (this choice is permanent!): Syrtis (Elves), Alsius (Dwarves), or Ignis (Humans)
   - **Move**: Right-click the map → "Walk here" to pathfind to any walkable tile
   - **Chat**: Open the Shoutbox window to send and receive real-time messages
   - **Items**: Open Inventory to manage items; drag consumables or mounts to the Quickbar (keys 1–0) for quick use
   - **Spells**: Right-click a potion in your inventory or quickbar to cast it — watch the cast bar and active buff icons
   - **Mounts**: Right-click a mount item in your inventory or quickbar to ride it — the mount grants a speed buff and is not consumed
   - **World**: Territories and World Bosses show live health and ownership on the map
   - **Other players**: See all online players as colored realm markers in real-time
   - Open browser DevTools → Console to see "WebSocket connected"

## 📁 Project Structure

```
regnum-nostalgia/
├── frontend/                         # Vite-powered frontend
│   ├── index.html                    # Single-page app (login + loading + game)
│   ├── character.html                # Character stats window
│   ├── settings.html                 # User settings page
│   ├── shoutbox.html                 # Chat/shoutbox page
│   ├── info-box.html                 # Info overlay
│   ├── regionEditor.html             # Map region editor
│   ├── regions.js                    # Region overlays
│   ├── screenshotManager.js          # Screenshot manager
│   ├── build-path.js                 # Path builder UI
│   ├── package.json                  # Vite dependency
│   ├── vite.config.ts                # Vite dev/build config
│   └── src/
│       ├── login.ts                  # Login entry point (session check, auth, realm selection)
│       ├── main.ts                   # Game entry point (loaded dynamically after login)
│       ├── state.ts                  # Reactive state store (subscribe, batchUpdate)
│       ├── utils.ts                  # escapeHtml, formatDurationSeconds, getErrorMessage
│       ├── items.ts                  # getItemName, getItemTypeLabel
│       ├── api.ts                    # apiCall, emitOrApi (HTTP + WebSocket)
│       ├── server-time.ts            # In-game time display & fetch
│       ├── map-state.ts              # Map instance accessors (map, totalH, totalW, gameToLatLng, latLngToGame)
│       ├── map-init.ts               # Leaflet map creation & tile loading (v1/v1-compressed: rastercoords + L.tileLayer, v2: L.imageOverlay)
│       ├── rastercoords.ts           # leaflet-rastercoords plugin for v1 tile coordinate mapping
│       ├── tooltip.ts                # Item/equipment hover tooltips
│       ├── windows.ts                # Draggable/closable window system, z-index stacking
│       ├── player-ui.ts              # HUD buttons, stats display
│       ├── player.ts                 # Player marker & state updates
│       ├── players.ts                # Other players' markers
│       ├── territories.ts            # Territory markers & health bars
│       ├── superbosses.ts            # World boss markers & respawn
│       ├── screenshots.ts            # Screenshot markers on map
│       ├── marker-utils.ts           # Shared marker lifecycle (create/update/remove-stale)
│       ├── inventory.ts              # Inventory display & drag-drop
│       ├── equipment.ts              # Equipment slots & rendering
│       ├── walking.ts                # Click-to-move & pathfinding
│       ├── context-menu.ts           # Right-click map context menu
│       ├── audio.ts                  # Music/SFX playback & volume
│       ├── socket-client.ts          # WebSocket client & event handlers
│       ├── castbar.ts                 # Cast bar UI for spell casting
│       ├── spells.ts                  # Active spell UI & tooltip display
│       ├── quickbar.ts                # Quickbar (4×10 quick-cast slots)
│       ├── init.ts                   # Game bootstrap, HTML partial loaders
│       └── styles/
│           ├── login.css             # Login & loading screen styles
│           └── main.css              # Game UI styles
├── public/                           # Static assets (served by nginx + Vite)
│   └── assets/
│       ├── tiles-v1/                 # V1 map: proper Leaflet tiles ({z}/{x}/{y}.png) served from CDN
│       ├── tiles-v1-compressed/      # V1 compressed map: pngquant-compressed tiles (default for new players)
│       ├── tiles-v2/                 # V2 map: 3×3 image overlay grid (legacy format)
│       ├── markers/                  # Map marker icons
│       ├── markers.json              # Marker definitions
│       ├── ingame-maps/              # Mini-maps
│       ├── v1/, v2/                  # UI sprites & icons
│       ├── 3d/                       # 3D models
│       ├── original-map/             # Original map tiles
│       └── *.png, *.webp, *.jpg      # Logos, backgrounds
├── api/                              # Node.js backend (TypeScript)
│   ├── src/
│   │   ├── server.ts                 # Express + Socket.io server
│   │   ├── types/                    # TypeScript interfaces for all domain entities
│   │   │   ├── index.ts              # Barrel export
│   │   │   ├── player.ts             # PlayerRow, SocketUser, PlayerStats
│   │   │   ├── item.ts               # ItemRow, ItemStats, ItemTemplate
│   │   │   ├── inventory.ts          # InventoryRow, EquipmentRow, QuickbarRow
│   │   │   ├── world.ts              # TerritoryRow, SuperbossRow, WalkerRow
│   │   │   ├── spells.ts             # ActiveSpellRow, SpellCooldown
│   │   │   ├── settings.ts           # UserSettingsRow
│   │   │   ├── config.ts             # LootTable, QueueIntervals, etc.
│   │   │   ├── socket-events.ts      # Typed Socket.IO events
│   │   │   ├── cache.ts              # Cache key/TTL types
│   │   │   └── common.ts             # UnixTimestamp, DbBoolean, Realm
│   │   ├── config/
│   │   │   ├── database.ts           # MariaDB + Redis + SQLite connections
│   │   │   ├── cache/                # Redis caching layer (split by domain)
│   │   │   │   ├── index.ts          # Barrel re-export
│   │   │   │   ├── keys.ts           # CACHE_KEYS & TTL constants
│   │   │   │   ├── items.ts          # Item/level lookups, preloadStaticData
│   │   │   │   ├── territories.ts    # Territory & superboss cache
│   │   │   │   ├── serverTime.ts     # Server time cache
│   │   │   │   ├── players.ts        # Online tracking, last_active, GM status
│   │   │   │   ├── settings.ts       # User settings cache
│   │   │   │   ├── walkers.ts        # Walker state & walk speed
│   │   │   │   ├── shoutbox.ts       # Chat message cache
│   │   │   │   └── spells.ts         # Active spells & cooldowns
│   │   │   ├── constants.ts          # Game configuration & loot tables
│   │   │   └── logger.ts             # Winston logger setup
│   │   ├── middleware/
│   │   │   └── auth.ts               # JWT authentication
│   │   ├── routes/
│   │   │   ├── auth.ts               # Login, realm selection
│   │   │   ├── settings.ts           # User settings
│   │   │   └── screenshots.ts        # Screenshot management
│   │   ├── sockets/
│   │   │   ├── index.ts              # Socket orchestrator & shared state
│   │   │   ├── inventoryHandler.ts   # Inventory, equipment, items
│   │   │   ├── movementHandler.ts    # Position updates, pathfinding
│   │   │   ├── collectableHandler.ts # Spawned item collection
│   │   │   ├── editorHandler.ts      # Region/path/wall/water CRUD
│   │   │   ├── logHandler.ts         # Player log retrieval
│   │   │   ├── spellHandler.ts       # Spell casting & active spell queries
│   │   │   ├── quickbarHandler.ts    # Quickbar slot CRUD
│   │   │   └── shoutbox.ts           # Chat/shoutbox polling
│   │   ├── queues/
│   │   │   ├── walkerQueue.ts        # Movement processor (1s)
│   │   │   ├── healthQueue.ts        # Health/mana regen (1s)
│   │   │   ├── spellQueue.ts         # Spell tick processor (1s)
│   │   │   ├── timeQueue.ts          # Ingame time sync (10s)
│   │   │   ├── territoryQueue.ts     # Territory updates (10s)
│   │   │   └── spawnQueue.ts         # Collectable spawning (5s)
│   │   ├── services/
│   │   │   ├── pathfinding.ts        # Dijkstra pathfinding + wall detection
│   │   │   ├── settingsService.ts    # Settings upsert (shared by routes + sockets)
│   │   │   ├── lootService.ts        # Loot table resolution (weighted/multi-drop/independent)
│   │   │   ├── inventoryService.ts   # Stackable item insertion
│   │   │   └── regionTracker.ts      # Shared userRegions Map (sockets + queues)
│   │   └── utils/
│   │       ├── geometry.ts           # Shared point-in-polygon, distance
│   │       └── permissions.ts        # Shared GM/admin permission check
│   ├── gameData/                     # JSON game data (regions, paths, items)
│   ├── scripts/                      # DB init, item import
│   ├── tsconfig.json                 # TypeScript config
│   ├── package.json
│   └── Dockerfile
├── nginx/
│   └── default.conf                  # Proxy: Vite + API + assets
├── docker-compose.yml                # Container orchestration (7 services)
├── Makefile                          # Dev shortcuts
└── README.md                         # This file
```

## 🏗️ Architecture

### Frontend Module System
The frontend uses a two-phase loading architecture to keep the login lightweight:

1. **Login Phase** (`login.js`): Loaded as the sole entry point. Handles session validation, login form, and realm selection with zero game dependencies. Only imports `login.css`.
2. **Game Phase** (`main.js`): Dynamically imported by `login.js` after successful authentication. Loads all game modules, CDN scripts (Leaflet, Socket.IO), and non-module scripts. A loading screen with progress bar is shown during this phase.

The frontend is decomposed into 23 ES modules under `frontend/src/`. Key patterns:

- **Reactive State Store** (`state.js`): Zero-dependency pub/sub with `subscribe(keys, callback)`, `setState(key, value)`, and `batchUpdate(updates)` — UI elements auto-update when state changes
- **Lazy Imports**: Circular dependencies between `windows.js` ↔ `inventory.js`/`equipment.js` are resolved via `await import()` at call sites
- **Legacy Interop**: Non-module scripts (`build-path.js`, `regions.js`, `screenshotManager.js`) access shared state via `window.*` globals exposed from `map-state.js` and `state.js`
- **Shared Helpers**: `getErrorMessage()` in `utils.js` and `nextZIndex()` in `windows.js` eliminate duplication across modules

### Backend Architecture
- **Socket Handlers**: Decomposed into domain-specific handlers (`inventoryHandler.js`, `movementHandler.js`, `collectableHandler.js`, etc.) with shared state passed via dependency injection
- **Shared Utilities**: `utils/geometry.js` provides point-in-polygon, distance calculations used by multiple handlers
- **Queue Workers**: 6 Bull queues handle background processing (movement, health regen, spell processing, time sync, territories, spawning)

## 🛠️ Technology Stack

- **Frontend**: HTML5, JavaScript (ES Modules), Leaflet.js, Socket.io Client (v4.6.1), Vite (dev server & build)
- **Backend**: Node.js 20, Express.js, Socket.io Server
- **Database**: MariaDB 11.3 for game data, SQLite for screenshot metadata
- **Cache/Pub-Sub**: Redis 7-Alpine (application-level caching + Bull queue backend)
- **Queue System**: Bull (Redis-backed job queues)
- **Web Server**: Nginx (Alpine) with WebSocket proxy
- **Containerization**: Docker & Docker Compose
- **Map Coordinates**: 6144×6144 coordinate system
- **Map Tiles**: V1 / V1-compressed use leaflet-rastercoords + `L.tileLayer` (gdal2tiles-leaflet, zoom 0-5), V2 uses 9 `L.imageOverlay` images; players can switch between all three in Settings (default: v1-compressed)
- **Coordinate Helpers**: `gameToLatLng(x, y)` / `latLngToGame(latLng)` in map-state.js abstract over v1 (rastercoords) and v2 (legacy) coordinate systems

## 📊 Database Schema

### Core Tables (MariaDB)
- **players**: User stats (health, mana, XP, level, attributes, position, realm)
- **sessions**: Active JWT sessions with expiry
- **inventory**: Player-owned items with quantities
- **equipment**: 10-slot equipment system per player
- **items**: Master item definitions with stats and rarity
- **territories**: Realm-controlled forts/castles with health
- **territory_captures**: Historical ownership changes
- **superbosses**: World bosses with spawn mechanics
- **walkers**: Active player movement queues with paths
- **active_spells**: Currently active spell buffs on players (spell_key, icon_name, heal/mana/damage per tick, walk_speed, stack_mode, duration, remaining, started_at)
- **server_time**: Synchronized in-game clock

### Redis Keys

#### Application Cache (managed by `api/src/config/cache.js`)
- `cache:item:tmpl:{templateKey}` - Item data by template key (permanent, preloaded at startup)
- `cache:item:id:{itemId}` - Item data by ID (permanent, preloaded at startup)
- `cache:levels` - Hash of level → XP thresholds (permanent, preloaded at startup)
- `cache:territories` - All territories JSON (TTL: 30s, invalidated on capture/health change)
- `cache:superbosses` - All superbosses JSON (TTL: 10s, invalidated on health change)
- `cache:server_time` - In-game time JSON (TTL: 15s, write-through on each tick)
- `cache:settings:{userId}` - User settings JSON (TTL: 300s, invalidated on save)
- `cache:gm:{userId}` - GM status boolean (TTL: 600s)
- `cache:online_players` - Sorted set of online player data (scored by timestamp)
- `cache:player:{userId}` - Player position/realm JSON (TTL: 10s)
- `cache:last_active` - Sorted set of userId → timestamp, batch-flushed to DB every 5s
- `cache:shoutbox:messages` - List of recent shoutbox messages (chronological order, oldest at head, max 50)
- `cache:shoutbox:last_id` - Last polled shoutbox entry ID (persists across restarts)
- `cache:walkers:active` - Hash of walkerId → walker state JSON (active walkers)
- `cache:walkers:user:{userId}` - Current active walkerId for a user
- `cache:walk_speed:{userId}` - Cached total walk_speed from equipped items and active spell buffs (TTL: 60s)
- `cache:spells:active:{userId}` - Active spells JSON array for a user (TTL: 300s, updated on cast/tick/expire)
- `cache:spell_cooldowns:{userId}` - Hash of spellKey → cooldown data (TTL: auto, cleaned on read)

#### Queue System
- `bull:{queueName}:*` - Queue job data (walker-processor, health-regeneration, spell-processor, server-time, territory-sync, spawn-queue)

### Redis Caching Strategy

The API uses Redis as a comprehensive caching layer (see `api/src/config/cache.js`) to minimize database queries:

| Category | Strategy | TTL | Invalidation |
|---|---|---|---|
| **Items & Levels** | Preloaded at startup | Permanent | Server restart |
| **Territories** | Lazy-load + TTL | 30s | On capture or health change |
| **Superbosses** | Lazy-load + TTL | 10s | On health change |
| **Server Time** | Write-through | 15s | Updated every 10s by timeQueue |
| **User Settings** | Lazy-load + TTL | 300s | On settings save |
| **GM Status** | Lazy-load + TTL | 600s | Natural expiry |
| **Online Players** | Sorted set | N/A | Cleaned every 10s (stale > 30s removed) |
| **Player Positions** | Updated on move | 10s | On each movement step |
| **Last Active** | Buffered in sorted set | N/A | Batch-flushed to DB every 5s |
| **Shoutbox Messages** | Redis list (chronological, oldest at head) | N/A | New messages RPUSH'd on send/poll, trimmed to 50 |
| **Shoutbox Last ID** | Persisted in Redis | Permanent | Updated on each poll/send |
| **Active Walkers** | Redis hash (walker state per tick) | N/A | Added on create, removed on complete/interrupt |
| **Walk Speed** | Lazy-load + TTL | 60s | Invalidated on equip/unequip and spell expiry |
| **Active Spells** | Updated on cast/tick | 300s | Updated every spell tick, cleared on expire |
| **Spell Cooldowns** | Set on cast | Auto (per spell) | Expires after cooldown duration |

## 🔌 API Endpoints

Base URL: `http://localhost/api/`

### Authentication
- `POST /login` - Authenticate with forum credentials
  - Body: `username, password` (form-urlencoded)
  - Returns: `{ sessionToken, userId, username, realm, needsRealmSelection }`
- `GET /login/validate` - Validate existing session token
  - Headers: `X-Session-Token: <jwt>`
  - Returns: `{ userId, username, realm }`
- `POST /realm/select` - Set player's realm (one-time)
  - Headers: `X-Session-Token: <jwt>`
  - Body: `realm` (form-urlencoded, one of `syrtis`, `alsius`, `ignis`)
  - Returns: `{ success, sessionToken, realm, spawnX, spawnY }`

### Player (via WebSocket)
- `player:stats:get` - Get current player state (position, health, mana, xp, level, etc.)

### Multiplayer
- `GET /players/online` - All active players (last 5s)
  - Returns: `{ players: [{ userId, username, realm, x, y }] }`

### Inventory & Equipment
- `GET /inventory` - List all inventory items
- `POST /inventory/add` - Add item (admin/testing)
- `POST /inventory/equip` - Equip item from inventory
- `POST /inventory/unequip` - Unequip to inventory

### World
- `GET /world/territories` - All territories with ownership
- `GET /world/superbosses` - All world bosses and status
- `GET /world/time` - Current ingame time

### Screenshots
- `GET /screenshots` - List all with metadata
- `POST /screenshots` - Upload with multilingual data
- `PUT /screenshots/:id` - Update metadata
- `DELETE /screenshots/:id` - Delete screenshot

### System
- `GET /health` - Server health check
  - Returns: `{ status, timestamp, uptime, memory, connections }`

## 🌐 WebSocket Events

Connected via Socket.io to `ws://localhost/socket.io/`

### Client → Server (Emit)
- `position:update` - Manual position change `{ x, y }`
- `move:request` - Initiate pathfinding `{ destinationX, destinationY }`
- `shoutbox:send` - Post chat message `{ message }` (supports GM commands: `/item <template_key> <user_id|username> [qty]`, `/itemrem`)
- `spell:cast` - Cast a consumable spell or mount from inventory `{ inventoryId }` (mounts are not consumed)
- `spell:active` - Request all active spells for current user

### Server → Client (Listen)
- `player:state` - Initial sync on connection
- `players:online` - All active players (every 1s)
- `player:connected` - Player joined `{ userId, username, realm }`
- `player:disconnected` - Player left `{ userId }`
- `walker:step` - Movement progress `{ userId, x, y, remaining }`
- `walker:completed` - Reached destination `{ userId, x, y }`
- `move:started` - Server confirmed movement `{ path, estimatedTime }`
- `territories:list` - Initial territory data
- `territories:update` - Health changes (every 1s)
- `territories:capture` - Ownership changes (every 10s)
- `superbosses:list` - Initial superboss data
- `superbosses:health` - Health updates (every 1s)
- `time:current` - Initial ingame time
- `time:update` - Time sync (every 10s) `{ ingameHour, ingameMinute }`
- `shoutbox:message` - Real-time chat `{ username, message, timestamp }`
- `spell:started` - Spell cast notification with spell details
- `spell:update` - Active spells array update (every tick)
- `spell:expired` - Spell expired notification

### Connection Management
- Auto-reconnection with exponential backoff (1s → 5s)
- JWT authentication in handshake: `auth: { token }`
- Page reload after 5 failed reconnection attempts

## ⚙️ Configuration

### Environment Variables
```env
# Authentication
COR_FORUM_API_KEY=<forum-api-key>
JWT_SECRET=<random-secure-string>

# Database
GAME_DB_HOST=db
GAME_DB_PORT=3306
GAME_DB_NAME=regnum_game
GAME_DB_USER=regnum
GAME_DB_PASS=regnum123

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Server
NODE_ENV=production|development
PORT=3000
```

### Spawn Points
```javascript
Syrtis: [237, 5397]   // Green/Elves
Alsius: [1509, 377]   // Blue/Dwarves
Ignis: [5000, 618]    // Red/Humans
```

### Background Workers
- **walkerQueue**: Every 1 second - Advances players along paths
- **healthQueue**: Every 1 second - Regenerates 1% of max HP per tick, fixed mana regen
- **spellQueue**: Every 1 second - Processes active spell ticks (heal/mana/damage per tick, walk speed buffs)
- **timeQueue**: Every 10 seconds - Updates ingame time (150s = 1 hour)
- **territoryQueue**: Every 10 seconds - Fetches territory ownership from external API
- **spawnQueue**: Every 5 seconds - Checks and respawns collectable items

## 🎯 Gameplay Mechanics

### Leveling System
- 60 levels with exponential XP requirements
- XP gained from combat and activities
- Level thresholds defined in `api/gameData/levels.json`
- Automated calculation via background process

### Combat
> **Not yet available to players.** The backend tracks health, damage formulas, and territory/boss state, but there is no UI to initiate attacks. This section describes the planned system.

- Damage: `Strength × 0.5 + Intelligence × 0.3 + Item Bonuses`
- Armor: `Constitution × 0.5 + Dexterity × 0.3 + Item Bonuses`
- Health regen: 1% of max health per second via healthQueue (1s tick)
- Targets: Territories and Superbosses

### Equipment System
10 slots: Head, Body, Hands, Shoulders, Legs, Right Weapon, Left Weapon, Right Ring, Left Ring, Amulet
- Items provide stat bonuses (damage, armor, health, mana)
- Rarity tiers affect item power
- Equipment references inventory via foreign keys

### Movement
- Click-to-move with server-side pathfinding
- Automated waypoint walking (1s tick via walkerQueue)
- Real-time position broadcast via WebSocket
- Path visualization with polylines on map

### Screenshots
- Right-click map → "Screenshots" to open manager
- Upload images with multilingual names/descriptions (EN/DE/ES)
- Stored in `public/assets/screenshots/` with metadata in `screenshots.json`
- Map markers show screenshots at coordinates

## 🧪 Testing & Monitoring

### Quick WebSocket Test
```bash
# Start backend
docker compose up -d

# Open game
open http://localhost/game

# Check browser console
# Should see: "WebSocket connected"
```

### Monitor WebSocket Traffic
**Chrome DevTools**
- Network tab → WS filter
- Click `socket.io` connection
- Messages tab shows real-time events

**Enable Debug Logging**
```javascript
// In browser console
localStorage.debug = '*'
location.reload()

// Check connection
window.getSocket().connected  // Should be true

// Manually emit
window.getSocket().emit('test:event', { data: 'hello' })
```

### Redis Monitoring
**RedisInsight Dashboard**
```bash
open http://localhost:8323
```
On first launch, add a connection with host `redis`, port `6379`. Browse all cache keys (`cache:*`), queue keys (`bull:*`), and monitor commands in real-time.

### Queue Monitoring
**Bull Board Dashboard**
```bash
open http://localhost/admin/queues
```
View queue status:
- walkerQueue - Processing every 1s
- healthQueue - Processing every 1s
- spellQueue - Processing every 1s
- timeQueue - Processing every 10s
- territoryQueue - Processing every 10s
- spawnQueue - Processing every 5s

**Check Jobs**
- Active: Currently processing
- Waiting: Queued for processing
- Completed: Successfully finished
- Failed: Errors (should be 0)

### Health Check
```bash
curl http://localhost/api/health | jq
```
Returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "memory": { "heapUsed": 50, "heapTotal": 100 },
  "connections": { "players": 5 }
}
```

### Performance Metrics

**Before WebSocket (HTTP Polling)**
- Players: 20 req/min (3s interval)
- Territories: 12 req/min (5s)
- Superbosses: 12 req/min (5s)
- Shoutbox: 12 req/min (5s)
- **Total: ~56 requests/min per player**

**After WebSocket**
- 1 persistent connection
- Events only on data changes
- **98% reduction in HTTP requests**
- **95% reduction in server load**
- **90% reduction in latency** (<100ms vs 3-5s)

## 🐛 Troubleshooting

### WebSocket Connection Failed
```bash
# Check nginx WebSocket proxy
docker compose exec web cat /etc/nginx/conf.d/default.conf | grep -A 10 "socket.io"

# Verify API listening
docker compose exec api netstat -tln | grep 3000

# Check logs
docker compose logs -f api | grep -i socket
```

### Events Not Received
```bash
# Check queue workers
docker compose logs api | grep "Queue.*started"

# Test Redis
docker compose exec redis redis-cli ping
# Should return: PONG

# Check database connection
docker compose exec db mariadb -uregnum -pregnum123 -e "USE regnum_game; SHOW TABLES;"
```

### Database Issues
```bash
# Reinitialize (clean start)
docker compose down -v
docker compose up -d

# Check tables
docker compose exec db mariadb -uregnum -pregnum123 -e "USE regnum_game; SHOW TABLES;"
```

### High CPU/Memory
```bash
# Monitor resources
docker stats

# Check queue jobs
open http://localhost/admin/queues

# Look for:
# - Failed jobs (should be 0)
# - Waiting jobs (should be < 100)
# - Active jobs (processing)

# Check for stuck jobs
docker compose exec redis redis-cli
> KEYS bull:*:active
> KEYS bull:*:failed
```

### Reconnection Issues
- Check browser console for reconnection attempts
- After 5 failures, page auto-reloads
- Verify JWT token not expired (24h sessions)
- Clear localStorage if corrupted: `localStorage.clear()`

## 📝 Development

### Running Without Docker
```bash
# Install dependencies
cd api
npm install

# Set environment variables
export GAME_DB_HOST=localhost
export REDIS_HOST=localhost
export JWT_SECRET=your_secret

# Start server
npm run dev  # Development with nodemon
npm start    # Production
```

### Frontend Development
The frontend uses Vite as a dev server with hot module replacement (HMR). In Docker, the `frontend` service runs Vite automatically.

```bash
# View frontend (Vite) logs
make frontend-logs

# Build frontend for production
make build-frontend
```

To run Vite locally (outside Docker):
```bash
cd frontend
npm install
npm run dev   # Starts Vite dev server on port 5173
npm run build # Production build to frontend/dist/
```

### Adding New Items
Edit item JSON files in `api/gameData/items/` and restart the API:
```bash
docker compose restart api
```

### Modifying Level Progression
Edit `api/gameData/levels.json` - changes take effect on restart.

### Creating New Queue Workers
1. Create file in `api/src/queues/`
2. Define job processor function
3. Register in `api/src/queues/index.js`
4. Restart API container

## 🔄 Test Scenarios

### Scenario 1: Player Movement
1. Open game in browser
2. Right-click map → "Walk Here"
3. Watch for events:
   - `move:started` - Server confirms path
   - `walker:step` - Position updates every 1s
   - `walker:completed` - Arrival at destination
4. Verify path polyline renders

### Scenario 2: Multi-Player Sync
1. Open game in 2 browser tabs (different accounts)
2. Move player in tab 1
3. Tab 2 should show player 1 moving in real-time (1s updates)
4. Check `players:online` event every 1s
5. Close tab 1 → tab 2 receives `player:disconnected`

### Scenario 3: Territory Updates
1. Open game
2. Watch territory health bars
3. Should regenerate every 1s (healthQueue)
4. Check `territories:update` events in console
5. Ownership changes appear every 10s (territoryQueue)

### Scenario 4: Real-Time Chat
1. Open shoutbox
2. Send message
3. Should appear instantly (no 5s delay)
4. Check `shoutbox:message` event
5. Other players see message immediately

### Scenario 5: Reconnection
1. Login and move around
2. Disconnect network (turn off WiFi)
3. Console shows reconnection attempts
4. Reconnect network within 5 attempts
5. WebSocket reconnects, game state restored

## 🤝 Contributing

Contributions welcome! This is a nostalgic passion project recreating the classic Regnum Online experience with modern real-time technology.

### Development Workflow
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

### Dependency Management

This project uses [Dependabot](https://docs.github.com/en/code-security/dependabot) to automatically keep dependencies up-to-date and secure.

**Configuration**: `.github/dependabot.yml`
- **Schedule**: Daily checks at 03:00 UTC
- **Frontend**: Monitors `/frontend/package.json` (Vite and related npm packages)
- **Backend API**: Monitors `/api/package.json` (Node.js/Express and related npm packages)
- **Pull Requests**: Automatically creates PRs for outdated dependencies with appropriate labels
- **Security**: Prioritizes security updates for vulnerable dependencies

## 📄 License

This project is for educational and nostalgic purposes. Regnum Online/Champions of Regnum is property of NGD Studios.

## 🙏 Credits

- Original map tiles from Regnum Online (Champions of Regnum)
- Built by the cor-forum.de community
- Powered by Leaflet.js, Socket.io, Bull, and Node.js

---

**Need help?** Check the troubleshooting section or open an issue on GitHub.
