# Regnum Nostalgia

A fully-featured browser-based MMORPG built on the nostalgic Old World map from Regnum Online (now Champions of Regnum). This project features real-time WebSocket multiplayer, interactive Leaflet-based map viewer, and a complete RPG backend with authentication, character progression, combat, inventory management, and background job processing.

![Regnum Map](https://github.com/CoR-Forum/RegnumMap-Nostalgia/blob/main/screenshot-2.png?raw=true)

## 🎮 Features

### Core Gameplay
- **Forum Authentication**: Login with cor-forum.de credentials via JWT tokens
- **Three Realms**: Choose between Syrtis (Elves), Alsius (Dwarves), or Ignis (Humans) - permanent choice
- **Real-time Movement**: Click-to-move pathfinding with animated walking between waypoints (2s updates)
- **Live Multiplayer**: See other players in real-time via WebSocket (98% reduction in HTTP requests)
- **Character Progression**: Level 1-60 with XP-based advancement system
- **Combat System**: Engage territories and superbosses with dynamic health/mana management

### Advanced Systems
- **Inventory & Equipment**: 10 equipment slots (head, body, hands, shoulders, legs, weapons, rings, amulet)
- **Item System**: Weapons, armor, consumables with rarity tiers (common, uncommon, rare, epic, legendary)
- **Attribute System**: Intelligence, Dexterity, Concentration, Strength, Constitution
- **Territory Control**: Realm-owned forts and castles with health and vulnerability mechanics
- **World Bosses**: Superbosses with spawn timers and respawn mechanics
- **In-game Time**: Server-synchronized day/night cycle (150s = 1 ingame hour)
- **Path Builder**: Create and share custom routes across the map
- **Screenshot Manager**: Upload, organize, and manage screenshots with multilingual metadata (EN/DE/ES)

### Technical Features
- **WebSocket Real-Time**: Socket.io for instant updates with auto-reconnection
- **Session Management**: JWT-based 24-hour sessions with Redis storage
- **Background Workers**: Bull queue system for health regen, time sync, walking processor, territory updates
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
JWT_SECRET=your_secure_random_string_here
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
   - Select your realm (this choice is permanent!)
   - Click anywhere on the map to move your character
   - See other online players as colored markers in real-time
   - Open browser DevTools → Console to see "WebSocket connected"

## 📁 Project Structure

```
regnum-nostalgia/
├── frontend/                         # Vite-powered frontend
│   ├── index.html                    # Main game client (entry point)
│   ├── login.html                    # Login page
│   ├── character.html                # Character creation
│   ├── settings.html                 # User settings page
│   ├── shoutbox.html                 # Chat/shoutbox page
│   ├── info-box.html                 # Info overlay
│   ├── regionEditor.html             # Map region editor
│   ├── regions.js                    # Region overlays
│   ├── screenshotManager.js          # Screenshot manager
│   ├── build-path.js                 # Path builder UI
│   ├── package.json                  # Vite dependency
│   ├── vite.config.js                # Vite dev/build config
│   └── src/
│       ├── main.js                   # ES module entry point (imports all modules)
│       ├── state.js                  # Reactive state store (subscribe, batchUpdate)
│       ├── utils.js                  # escapeHtml, formatDurationSeconds, getErrorMessage
│       ├── items.js                  # getItemName, getItemTypeLabel
│       ├── api.js                    # apiCall, emitOrApi (HTTP + WebSocket)
│       ├── server-time.js            # In-game time display & fetch
│       ├── map-state.js              # Map instance accessors (map, totalH, totalW)
│       ├── map-init.js               # Leaflet map creation & tile loading
│       ├── tooltip.js                # Item/equipment hover tooltips
│       ├── windows.js                # Draggable/closable window system, z-index stacking
│       ├── player-ui.js              # HUD buttons, stats display
│       ├── player.js                 # Player marker & state updates
│       ├── players.js                # Other players' markers
│       ├── territories.js            # Territory markers & health bars
│       ├── superbosses.js            # World boss markers & respawn
│       ├── screenshots.js            # Screenshot markers on map
│       ├── inventory.js              # Inventory display & drag-drop
│       ├── equipment.js              # Equipment slots & rendering
│       ├── walking.js                # Click-to-move & pathfinding
│       ├── context-menu.js           # Right-click map context menu
│       ├── audio.js                  # Music/SFX playback & volume
│       ├── socket-client.js          # WebSocket client & event handlers
│       ├── init.js                   # Game bootstrap, auto-login, partial loaders
│       └── styles/
│           └── main.css              # All game CSS (extracted from HTML)
├── public/                           # Static assets (served by nginx + Vite)
│   └── assets/
│       ├── tiles-v1/, tiles-v2/      # Map tile layers
│       ├── markers/                  # Map marker icons
│       ├── markers.json              # Marker definitions
│       ├── ingame-maps/              # Mini-maps
│       ├── v1/, v2/                  # UI sprites & icons
│       ├── 3d/                       # 3D models
│       ├── original-map/             # Original map tiles
│       └── *.png, *.webp, *.jpg      # Logos, backgrounds
├── api/                              # Node.js backend
│   ├── src/
│   │   ├── server.js                 # Express + Socket.io server
│   │   ├── config/
│   │   │   ├── database.js           # MariaDB + Redis + SQLite connections
│   │   │   ├── constants.js          # Game configuration & loot tables
│   │   │   └── logger.js             # Winston logger setup
│   │   ├── middleware/
│   │   │   └── auth.js               # JWT authentication
│   │   ├── routes/
│   │   │   ├── auth.js               # Login, realm selection
│   │   │   ├── settings.js           # User settings
│   │   │   └── screenshots.js        # Screenshot management
│   │   ├── sockets/
│   │   │   ├── index.js              # Socket orchestrator & shared state
│   │   │   ├── inventoryHandler.js   # Inventory, equipment, items
│   │   │   ├── movementHandler.js    # Position updates, pathfinding
│   │   │   ├── collectableHandler.js # Spawned item collection
│   │   │   ├── editorHandler.js      # Region/path/wall/water CRUD
│   │   │   ├── logHandler.js         # Player log retrieval
│   │   │   └── shoutbox.js           # Chat/shoutbox polling
│   │   ├── queues/
│   │   │   ├── walkerQueue.js        # Movement processor (1s)
│   │   │   ├── healthQueue.js        # Health/mana regen (1s)
│   │   │   ├── timeQueue.js          # Ingame time sync (10s)
│   │   │   ├── territoryQueue.js     # Territory updates (10s)
│   │   │   └── spawnQueue.js         # Collectable spawning (5s)
│   │   ├── services/
│   │   │   └── pathfinding.js        # Dijkstra pathfinding + wall detection
│   │   └── utils/
│   │       └── geometry.js           # Shared point-in-polygon, distance
│   ├── gameData/                     # JSON game data (regions, paths, items)
│   ├── scripts/                      # DB init, item import
│   ├── package.json
│   └── Dockerfile
├── nginx/
│   └── default.conf                  # Proxy: Vite + API + assets
├── docker-compose.yml                # Container orchestration (6 services)
├── Makefile                          # Dev shortcuts
└── README.md                         # This file
```

## 🏗️ Architecture

### Frontend Module System
The frontend is decomposed into 22 ES modules under `frontend/src/`, loaded through a single entry point (`main.js`). Key patterns:

- **Reactive State Store** (`state.js`): Zero-dependency pub/sub with `subscribe(keys, callback)`, `setState(key, value)`, and `batchUpdate(updates)` — UI elements auto-update when state changes
- **Lazy Imports**: Circular dependencies between `windows.js` ↔ `inventory.js`/`equipment.js` are resolved via `await import()` at call sites
- **Legacy Interop**: Non-module scripts (`build-path.js`, `regions.js`, `screenshotManager.js`) access shared state via `window.*` globals exposed from `map-state.js` and `state.js`
- **Shared Helpers**: `getErrorMessage()` in `utils.js` and `nextZIndex()` in `windows.js` eliminate duplication across modules

### Backend Architecture
- **Socket Handlers**: Decomposed into domain-specific handlers (`inventoryHandler.js`, `movementHandler.js`, `collectableHandler.js`, etc.) with shared state passed via dependency injection
- **Shared Utilities**: `utils/geometry.js` provides point-in-polygon, distance calculations used by multiple handlers
- **Queue Workers**: 5 Bull queues handle background processing (movement, health regen, time sync, territories, spawning)

## 🛠️ Technology Stack

- **Frontend**: HTML5, JavaScript (ES Modules), Leaflet.js, Socket.io Client (v4.6.1), Vite (dev server & build)
- **Backend**: Node.js 20, Express.js, Socket.io Server
- **Database**: MariaDB 11.3 for game data, SQLite for screenshot metadata
- **Cache/Pub-Sub**: Redis 7-Alpine
- **Queue System**: Bull (Redis-backed job queues)
- **Web Server**: Nginx (Alpine) with WebSocket proxy
- **Containerization**: Docker & Docker Compose
- **Map Coordinates**: 6144×6144 coordinate system with 3×3 tiled layout

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
- **server_time**: Synchronized in-game clock

### Redis Keys
- `session:{sessionToken}` - Session data cache
- `player:{userId}:state` - Real-time player state
- `bull:{queueName}:*` - Queue job data

## 🔌 API Endpoints

Base URL: `http://localhost/api/`

### Authentication
- `POST /auth/login` - Authenticate with forum credentials
  - Body: `{ username, password }`
  - Returns: `{ token, userId, username, realm, needsRealmSelection }`
- `POST /auth/realm` - Set player's realm (one-time)
  - Headers: `Authorization: Bearer <token>`
  - Body: `{ realm: 'syrtis'|'alsius'|'ignis' }`
  - Returns: `{ realm, position: { x, y } }`

### Player
- `GET /player/position` - Get current player state
  - Headers: `Authorization: Bearer <token>`
  - Returns: `{ position: { x, y }, realm, health, mana, xp, level }`
- `POST /player/position` - Manual position update
  - Headers: `Authorization: Bearer <token>`
  - Body: `{ x, y }`
- `GET /player/stats` - Detailed character statistics
- `POST /player/move` - Request pathfinding + walker creation
  - Body: `{ destinationX, destinationY }`
  - Returns: `{ walkerId, path: [[x,y], ...], estimatedSteps }`

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

### Server → Client (Listen)
- `player:state` - Initial sync on connection
- `players:online` - All active players (every 2s)
- `player:connected` - Player joined `{ userId, username, realm }`
- `player:disconnected` - Player left `{ userId }`
- `walker:step` - Movement progress `{ userId, x, y, remaining }`
- `walker:completed` - Reached destination `{ userId, x, y }`
- `move:started` - Server confirmed movement `{ path, estimatedTime }`
- `territories:list` - Initial territory data
- `territories:update` - Health changes (every 1s)
- `territories:capture` - Ownership changes (every 15s)
- `superbosses:list` - Initial superboss data
- `superbosses:health` - Health updates (every 1s)
- `time:current` - Initial ingame time
- `time:update` - Time sync (every 10s) `{ ingameHour, ingameMinute }`
- `shoutbox:message` - Real-time chat `{ username, message, timestamp }`

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
- **healthQueue**: Every 1 second - Regenerates HP/mana
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
- Damage: `Strength × 0.5 + Intelligence × 0.3 + Item Bonuses`
- Armor: `Constitution × 0.5 + Dexterity × 0.3 + Item Bonuses`
- Health regen: Automated via healthQueue (1s tick)
- Targets: Territories and Superbosses

### Equipment System
10 slots: Head, Body, Hands, Shoulders, Legs, Right Weapon, Left Weapon, Right Ring, Left Ring, Amulet
- Items provide stat bonuses (damage, armor, health, mana)
- Rarity tiers affect item power
- Equipment references inventory via foreign keys

### Movement
- Click-to-move with server-side pathfinding
- Automated waypoint walking (2s tick via walkerQueue)
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

### Queue Monitoring
**Bull Board Dashboard**
```bash
open http://localhost/admin/queues
```
View queue status:
- walkerQueue - Processing every 2s
- healthQueue - Processing every 1s
- timeQueue - Processing every 10s
- territoryQueue - Processing every 15s

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
   - `walker:step` - Position updates every 2s
   - `walker:completed` - Arrival at destination
4. Verify path polyline renders

### Scenario 2: Multi-Player Sync
1. Open game in 2 browser tabs (different accounts)
2. Move player in tab 1
3. Tab 2 should show player 1 moving in real-time (2s updates)
4. Check `players:online` event every 2s
5. Close tab 1 → tab 2 receives `player:disconnected`

### Scenario 3: Territory Updates
1. Open game
2. Watch territory health bars
3. Should regenerate every 1s (healthQueue)
4. Check `territories:update` events in console
5. Ownership changes appear every 15s (territoryQueue)

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

## 📄 License

This project is for educational and nostalgic purposes. Regnum Online/Champions of Regnum is property of NGD Studios.

## 🙏 Credits

- Original map tiles from Regnum Online (Champions of Regnum)
- Built by the cor-forum.de community
- Powered by Leaflet.js, Socket.io, Bull, and Node.js

---

**Need help?** Check the troubleshooting section or open an issue on GitHub.
