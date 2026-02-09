# Regnum Nostalgia - Node.js/Express/Socket.io Backend

Node.js implementation of the Regnum Nostalgia MMORPG backend, replacing PHP polling with WebSockets for real-time gameplay.

## Architecture

- **Express.js** - REST API for stateful operations
- **Socket.io** - Real-time bidirectional communication
- **Bull** - Redis-backed job queue for background workers
- **MariaDB** - Game state and player data
- **Redis** - Queue management and session storage
- **Winston** - Structured logging

## Features

### REST API Endpoints (25+)
- Authentication (`/login`, `/realm/select`)
- Player management (`/player/position`, `/players/online`)
- Inventory & Equipment (`/inventory`, `/equipment/equip`)
- Game data (`/territories`, `/superbosses`, `/items`, `/paths`, `/regions`)
- Social (`/shoutbox`)
- Screenshots (`/screenshots`)
- Server-side pathfinding (`/player/move`)

### WebSocket Events

**Server → Client:**
- `players:online` - Online players list (every 1s)
- `walker:step` - Walker position updates
- `territories:update` - Territory health/ownership changes
- `superbosses:health` - Boss health updates
- `shoutbox:message` - New chat messages
- `spell:started` - Spell cast notification with spell details
- `spell:update` - Active spells array update (every tick)
- `spell:expired` - Spell expired notification
- `time:update` - Server time updates
- `player:connected` / `player:disconnected` - Player status

**Client → Server:**
- `position:update` - Manual position update
- `move:request` - Initiate pathfinding
- `shoutbox:send` - Send chat message (supports GM commands)
- `spell:cast` - Cast a consumable spell from inventory
- `spell:active` - Get all active spells for current user

### GM Commands (Shoutbox)

GM/Admin users can execute commands in the shoutbox:

- `/item <template_key> <user_id|username> [quantity]` - Give an item to a user
  - Alias: `/itemadd`
  - Example: `/item gold_coin 123 1000` - Gives 1000 gold coins to user ID 123
  - Example: `/item iron_sword PlayerName` - Gives 1 iron sword to PlayerName
  - Accepts either user ID (number) or username (string)
  - Default quantity is 1 if not specified
  - Stackable items are added to existing stacks
  - Requires GM permissions (groupID 32 in forum database)
  
- `/itemrem <template_key> <user_id|username> [quantity]` - Remove an item from a user
  - Alias: `/itemremove`
  - Example: `/itemrem gold_coin 123 500` - Removes 500 gold coins from user ID 123
  - Example: `/itemrem iron_sword PlayerName 2` - Removes 2 iron swords from PlayerName
  - Accepts either user ID (number) or username (string)
  - Default quantity is 1 if not specified
  - For stackable items, reduces or removes the stack
  - For non-stackable items, removes individual entries
  - Requires GM permissions (groupID 32 in forum database)

### Background Workers (Bull Queues)

1. **Walker Queue** (1s interval) - Advances player movement along calculated paths
2. **Health Queue** (1s interval) - Regenerates health (1% of max HP) and mana for players, territories, superbosses
3. **Spell Queue** (1s interval) - Processes active spell ticks (applies heal/mana/damage per tick, invalidates walk speed cache on spell expiry, expires finished spells)
4. **Time Queue** (10s interval) - Updates ingame time (24h cycle per real hour)
5. **Territory Queue** (10s interval) - Syncs ownership from external API
6. **Spawn Queue** (5s interval) - Checks and respawns collectable items

## Project Structure

```
api-node/
├── src/
│   ├── config/          # Database, logger, constants
│   ├── middleware/      # JWT authentication
│   ├── routes/          # Express route handlers
│   ├── services/        # Dijkstra pathfinding
│   ├── queues/          # Bull queue workers
│   ├── sockets/         # Socket.io event handlers
│   │   ├── index.js     # Socket orchestrator & shared state
│   │   ├── shoutbox.js  # Chat/shoutbox handlers
│   │   ├── inventoryHandler.js  # Inventory, equipment, items
│   │   ├── movementHandler.js   # Position updates, pathfinding
│   │   ├── collectableHandler.js # Spawned item collection
│   │   ├── editorHandler.js     # Region/path/wall/water CRUD
│   │   ├── logHandler.js        # Player log retrieval
│   │   └── spellHandler.js      # Spell casting & active spell queries
│   └── server.js        # Main application entry
├── gameData/            # Paths and regions JSON
├── logs/                # Winston log files
├── package.json
└── Dockerfile
```

## Setup

### 1. Install Dependencies

```bash
cd api-node
npm install
```

### 2. Copy Game Data

```bash
# Copy gameData from PHP API
cp -r ../api/gameData ./gameData
```

### 3. Environment Variables

Create `.env` in project root:

```env
# Game Database
GAME_DB_HOST=db
GAME_DB_PORT=3306
GAME_DB_NAME=regnum_nostalgia
GAME_DB_USER=regnum_user
GAME_DB_PASS=regnum_pass

# Forum Database (external)
COR_FORUM_DB_HOST=localhost
COR_FORUM_DB_PORT=3306
COR_FORUM_DB_NAME=corforum_database
COR_FORUM_DB_USER=corforum_user
COR_FORUM_DB_PASS=corforum_password

# External APIs
COR_FORUM_API_KEY=your-api-key-here
SCREENSHOTS_API_KEY=your-api-key-here

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# JWT
JWT_SECRET=change-this-in-production

# Server
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# CORS (comma-separated origins)
CORS_ALLOWED_ORIGINS=http://localhost:8321,http://localhost:3000
```

### 4. Run with Docker Compose

```bash
# Use new Node.js configuration
docker compose up -d

# View logs
docker compose logs -f api

# Rebuild after code changes
docker compose up -d --build api
```

### 5. Development Mode

```bash
# Install nodemon for auto-reload
npm install --save-dev nodemon

# Run in development
npm run dev
```

## Monitoring

### Health Check
```bash
curl http://localhost:8321/api/health
```

### Bull Board (Queue Dashboard)
Open in browser: http://localhost:8321/admin/queues

View queue statistics, failed jobs, and job details.

### Logs
```bash
# Application logs
tail -f api-node/logs/combined.log

# Error logs only
tail -f api-node/logs/error.log

# Docker logs
docker compose logs -f api
```

## Key Differences from PHP Implementation

| Feature | PHP (Old) | Node.js (New) |
|---------|-----------|---------------|
| Real-time updates | HTTP polling (every 2-5s) | WebSocket push events |
| Background jobs | Shell scripts in infinite loops | Bull queues with Redis |
| Session management | Database + fingerprinting | JWT tokens |
| Concurrency | PHP-FPM workers | Node.js event loop |
| Scaling | Vertical only | Horizontal with Redis pub/sub |
| Monitoring | None | Bull Board dashboard |
| Logging | PHP error log | Winston structured logs |

## Performance Improvements

- **Eliminated polling overhead**: 4 concurrent polling loops per client → 1 WebSocket connection
- **Reduced server load**: ~800-1500 req/s for 100 users → ~0 HTTP requests after initial connection
- **Lower latency**: Instant event propagation vs 2-5s polling delay
- **Better resource usage**: Event-driven architecture vs blocking PHP workers

## Migration Path

1. **Run in parallel**: Deploy Node.js backend on different port, test thoroughly
2. **Update frontend**: Switch Socket.io client, fall back to REST for critical operations
3. **Monitor**: Compare performance metrics, error rates
4. **Cutover**: Update nginx to proxy to Node.js, decommission PHP service
5. **Cleanup**: Remove old PHP code after stable period

## Troubleshooting

### Redis connection errors
```bash
# Check Redis is running
docker compose ps redis

# Test Redis connection
docker compose exec redis redis-cli ping
```

### Database connection errors
```bash
# Check MariaDB is running
docker compose ps db

# Test connection
docker compose exec db mariadb -u regnum_user -p regnum_nostalgia
```

### WebSocket not connecting
- Check nginx proxy configuration includes `Upgrade` headers
- Verify CORS_ALLOWED_ORIGINS includes client origin
- Check browser console for Socket.io connection errors

### Queue jobs not processing
- Check Bull Board at `/admin/queues`
- Verify Redis is healthy
- Look for errors in logs: `docker compose logs api | grep -i error`

## Development

### Adding new API endpoint
1. Create route file in `src/routes/`
2. Import and mount in `src/server.js`
3. Add authentication middleware if needed

### Adding new WebSocket event
1. Add handler in `src/sockets/index.js` (or create a new module like `shoutbox.js` for feature-specific events)
2. For modular handlers, create a separate file and export initialization function
3. Import and call the initialization function in `src/sockets/index.js`
4. Emit from queue workers or routes as needed

### Adding new background job
1. Create queue file in `src/queues/`
2. Add to `src/queues/index.js`
3. Register in Bull Board in `src/server.js`

## License

Same as main project
