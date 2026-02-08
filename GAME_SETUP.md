# Regnum Online Map Game - Setup Guide

## What's Been Implemented

A simple multiplayer browser-based map game built on top of the Regnum Online Old World map viewer:

### Features
- **Forum Authentication**: Players log in with their cor-forum.de accounts
- **Realm Selection**: Choose between Syrtis, Alsius, or Ignis (permanent choice)
- **Real-time Player Movement**: Click anywhere on the map to move your character
- **Live Player Tracking**: See other online players moving in real-time (1-second updates)
- **Session Management**: 24-hour sessions that auto-renew on activity
- **Spawn Points**: Realm-specific starting positions:
  - Syrtis: 237, 5397
  - Alsius: 1509, 377
  - Ignis: 5000, 618

### Technical Stack
- **Frontend**: HTML5, JavaScript, Leaflet.js, Socket.io Client
- **Backend**: Node.js 20, Express.js, Socket.io Server
- **Database**: MariaDB (game data) + SQLite (screenshots metadata)
- **Cache/Queue**: Redis 7, Bull job queues
- **Infrastructure**: Docker (Nginx, Node.js API, MariaDB, Redis, phpMyAdmin)
- **Map**: 6144x6144 coordinate system with tiled layout

## How to Start

1. **Start the containers**:
```bash
docker-compose up -d
```

2. **Access the game**:
Open http://localhost:8321 in your browser

3. **Login**:
   - Use your cor-forum.de credentials
   - If you don't have an account, you'll need to register at https://cor-forum.de first

4. **Select Your Realm**:
   - Choose Syrtis (green/elves), Alsius (blue/dwarves), or Ignis (red/humans)
   - **Warning**: This choice is permanent!

5. **Play**:
   - Click anywhere on the map to move your character
   - Your position updates automatically
   - See other online players as colored markers
   - Click on player markers to see their name and realm

## API Endpoints

All endpoints are accessible at `http://localhost:8321/api/`

### POST /api/login
Authenticate with forum credentials
- **Body**: `username`, `password`
- **Response**: `{sessionToken, userId, username, realm, needsRealmSelection}`

### POST /api/realm/select
Set player's realm (once per account)
- **Headers**: `X-Session-Token`
- **Body**: `realm` (syrtis|alsius|ignis)
- **Response**: `{realm, position: {x, y}}`

### GET /api/player/position
Get current player position
- **Headers**: `X-Session-Token`
- **Response**: `{position: {x, y}, realm}`

### POST /api/player/position
Update player position
- **Headers**: `X-Session-Token`
- **Body**: `x`, `y` (0-6144)
- **Response**: `{position: {x, y}}`

### GET /api/players/online
Get all active players (last 5 seconds)
- **Headers**: `X-Session-Token`
- **Response**: `{players: [{userId, username, realm, x, y, lastActive}]}`

## Database Schema

### sessions table
- `session_id` (TEXT, PRIMARY KEY)
- `user_id` (INTEGER)
- `username` (TEXT)
- `realm` (TEXT, nullable until selected)
- `created_at` (INTEGER, Unix timestamp)
- `expires_at` (INTEGER, Unix timestamp)
- `last_activity` (INTEGER, Unix timestamp)

### players table
- `user_id` (INTEGER, PRIMARY KEY)
- `username` (TEXT)
- `realm` (TEXT, locked after first selection)
- `x` (INTEGER, 0-6144)
- `y` (INTEGER, 0-6144)
- `last_active` (INTEGER, Unix timestamp)

## Troubleshooting

### Container logs
```bash
docker-compose logs -f
```

### Check API errors
```bash
docker-compose logs api
```

### Check Nginx errors
```bash
docker-compose logs web
```

### Reinitialize database
```bash
docker-compose down
docker-compose down -v
docker-compose up -d
docker-compose up -d
```

### Test API directly
```bash
# Login
curl -X POST http://localhost:8321/api/login \
  -d "username=testuser&password=testpass"

# Get online players (replace SESSION_TOKEN)
curl http://localhost:8321/api/players/online \
  -H "X-Session-Token: YOUR_SESSION_TOKEN_HERE"
```

## Future Enhancements

Possible additions to make the game more interesting:
- Territory control system
- Resource gathering
- Player-to-player messaging
- Combat system
- Level/experience system
- Quests and objectives
- Guild/clan functionality
- Fort capture mechanics
- Player inventory
- Trading system

## Files Structure

```
/api
  ├── src/
  │   ├── server.js             # Express + Socket.io server
  │   ├── config/               # Database, constants, logger
  │   ├── middleware/            # JWT authentication
  │   ├── routes/                # REST API routes
  │   ├── sockets/               # WebSocket event handlers
  │   ├── queues/                # Bull background workers
  │   ├── services/              # Pathfinding, utilities
  │   └── utils/                 # Shared utilities (geometry)
  ├── scripts/                   # DB init, item import
  ├── gameData/                  # JSON game data files
  ├── package.json
  └── Dockerfile

/public
  ├── index.html           # Game client (HTML + CSS + JavaScript)
  ├── regions.js            # Region display & walk permissions
  ├── build-path.js         # Path builder / region editor
  ├── screenshotManager.js  # Screenshot management
  └── assets/               # Map tiles, icons, markers

/nginx
  └── default.conf         # Nginx configuration (API proxy + WebSocket)

docker-compose.yml         # Container orchestration
```

## Notes

- Sessions expire after 24 hours of inactivity
- Players are considered "online" if active within last 5 seconds
- Coordinate system: (0,0) is bottom-left, (6144,6144) is top-right
- Position updates occur every 1 second
- Realm choice cannot be changed once selected
- Forum API requires valid cor-forum.de account
