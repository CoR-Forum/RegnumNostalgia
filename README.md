# Regnum Nostalgia

A fully-featured browser-based MMORPG built on the nostalgic Old World map from Regnum Online (now Champions of Regnum). This project combines an interactive Leaflet-based map viewer with a complete RPG backend featuring authentication, character progression, combat, inventory management, and real-time multiplayer functionality.

![Regnum Map](https://github.com/CoR-Forum/RegnumMap-Nostalgia/blob/main/screenshot-1.png?raw=true)

## 🎮 Features

### Core Gameplay
- **Forum Authentication**: Login with cor-forum.de credentials
- **Three Realms**: Choose between Syrtis (Elves), Alsius (Dwarves), or Ignis (Humans) - permanent choice
- **Real-time Movement**: Click-to-move pathfinding with animated walking between waypoints
- **Live Multiplayer**: See other players in real-time with 1-second position updates
- **Character Progression**: Level 1-60 with XP-based advancement system
- **Combat System**: Engage territories and superbosses with dynamic health/mana management

### Advanced Systems
- **Inventory & Equipment**: 10 equipment slots (head, body, hands, shoulders, legs, weapons, rings, amulet)
- **Item System**: Weapons, armor, consumables with rarity tiers (common, uncommon, rare, epic, legendary)
- **Attribute System**: Intelligence, Dexterity, Concentration, Strength, Constitution
- **Territory Control**: Realm-owned forts and castles with health and vulnerability mechanics
- **World Bosses**: Superbosses with spawn timers and respawn mechanics
- **In-game Time**: Server-synchronized day/night cycle
- **Path Builder**: Create and share custom routes across the map
- **Screenshot Manager**: Upload, organize, and manage screenshots with multilingual metadata (EN/DE/ES)

### Technical Features
- **Session Management**: 24-hour sessions with auto-renewal on activity
- **Background Workers**: Automated health regeneration, time sync, walking processor, level calculation
- **SQLite Database**: Persistent storage for players, items, territories, sessions, and more
- **RESTful API**: Clean PHP backend with comprehensive endpoints
- **Responsive UI**: Draggable windows, HUD elements, and territory/boss overlays

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
CORS_ALLOWED_ORIGINS=http://localhost:8321
```

3. **Start the containers**:
```bash
docker-compose up -d
```

4. **Access the game**:
Open http://localhost:8321 in your browser

5. **Login & Play**:
   - Use your cor-forum.de credentials
   - Select your realm (this choice is permanent!)
   - Click anywhere on the map to move your character
   - See other online players as colored markers

## 📁 Project Structure

```
regnum-nostalgia/
├── api/                          # PHP backend
│   ├── index.php                 # Main API router with all endpoints
│   ├── init-db.php               # Database initialization & schema
│   ├── docker-entrypoint.sh      # Container startup script
│   ├── cron.php                  # Level calculation worker
│   ├── levels.json               # Level progression data (1-60)
│   ├── paths.json                # Predefined travel routes
│   ├── regions.json              # Map region definitions
│   └── cron/
│       ├── process-walking.php   # Walking animation worker (2s tick)
│       ├── process-server-time.php  # In-game time sync (10s tick)
│       └── regenerate-health.php    # Health regen worker (5s tick)
├── public/                       # Frontend
│   ├── index.html                # Main game client (2800+ lines)
│   ├── build-path.js             # Path builder UI logic
│   ├── regions.js                # Region overlay rendering
│   ├── screenshotManager.js      # Screenshot upload/management UI
│   └── assets/
│       ├── tiles/                # Map tiles (3x3 grid: 1-1.png ... 3-3.png)
│       ├── screenshots/          # User-uploaded screenshots
│       ├── ingame-maps/          # Mini-map assets
│       ├── icons/                # UI icons
│       ├── markers.json          # Map marker definitions
│       └── screenshots.json      # Screenshot metadata
├── nginx/
│   └── default.conf              # Nginx reverse proxy config
├── docker-compose.yml            # Container orchestration
├── README.md                     # This file
└── GAME_SETUP.md                 # Detailed setup & API documentation
```

## 🛠️ Technology Stack

- **Frontend**: HTML5, JavaScript (ES6+), Leaflet.js for mapping
- **Backend**: PHP 8.2-FPM with PDO for database access
- **Database**: SQLite with comprehensive schema
- **Web Server**: Nginx (Alpine-based)
- **Containerization**: Docker & Docker Compose
- **Map Coordinates**: 6144×6144 coordinate system with 3×3 tiled layout

## 📊 Database Schema

### Core Tables
- **players**: User stats (health, mana, XP, level, attributes, position)
- **sessions**: Active user sessions with token-based auth
- **inventory**: Player-owned items with quantities
- **equipment**: 10-slot equipment system per player
- **items**: Master item definitions with stats and rarity
- **territories**: Realm-controlled forts/castles with health
- **superbosses**: World bosses with spawn mechanics
- **walkers**: Active player movement queues
- **server_time**: Synchronized in-game clock

## 🔌 API Endpoints

All endpoints are accessible at `http://localhost:8321/api/`

### Authentication
- `POST /api/login` - Authenticate with forum credentials
- `POST /api/realm/select` - Set player's realm (one-time choice)

### Player
- `GET /api/player/position` - Get current player state (position, stats, health, mana, XP, level)
- `POST /api/player/position` - Update player position
- `GET /api/player/stats` - Get detailed character statistics
- `POST /api/player/path` - Initiate pathfinding movement

### Multiplayer
- `GET /api/players/online` - Get all active players (last 5 seconds)

### Screenshots
- `GET /api/screenshots` - List all screenshots with metadata
- `POST /api/screenshots` - Upload new screenshot with multilingual name/description
- `PUT /api/screenshots/{id}` - Update screenshot metadata
- `DELETE /api/screenshots/{id}` - Delete screenshot and file

### Inventory & Equipment
- `GET /api/inventory` - List all inventory items
- `POST /api/inventory/add` - Add item to inventory (admin/testing)
- `POST /api/equip` - Equip item from inventory
- `POST /api/unequip` - Unequip item to inventory

### World
- `GET /api/territories` - Get all territories with realm ownership
- `GET /api/superbosses` - Get all world bosses and their status
- `GET /api/server-time` - Get synchronized in-game time

See [GAME_SETUP.md](GAME_SETUP.md) for complete API documentation.

## ⚙️ Configuration

### Environment Variables
- `COR_FORUM_API_KEY`: API key for forum authentication
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins

### Spawn Points
```php
Syrtis: [237, 5397]  // Green/Elves
Alsius: [1509, 377]   // Blue/Dwarves
Ignis: [5000, 618]    // Red/Humans
```

### Background Workers
- **Health Regeneration**: Every 5 seconds
- **Server Time**: Every 10 seconds
- **Walking Processor**: Every 2 seconds (daemon mode)
- **Level Calculator**: Continuous loop with 10-second sleep

## 🎯 Gameplay Mechanics

### Leveling System
- 60 levels with exponential XP requirements
- XP gained from combat and activities
- Automated level calculation via background worker
- Level thresholds defined in `api/levels.json`

### Combat
- Damage calculation: `Strength × 0.5 + Intelligence × 0.3 + Item Bonuses`
- Armor calculation: `Constitution × 0.5 + Dexterity × 0.3 + Item Bonuses`
- Health regeneration: Automated background process
- Territories and Superbosses as combat targets

### Equipment System
10 slots: Head, Body, Hands, Shoulders, Legs, Right Weapon, Left Weapon, Right Ring, Left Ring, Amulet
- Items provide stat bonuses (damage, armor, health, mana)
- Rarity tiers affect item power
- Equipment slots reference inventory items (foreign keys)

### Movement
- Click-to-move with pathfinding
- Automated waypoint walking (2-second tick)
- Real-time position updates visible to other players
- Persistent walker queues in database

### Screenshots
- Right-click map → "Screenshots" to open manager
- Upload images with multilingual names/descriptions (EN/DE/ES)
- Stored in `public/assets/screenshots/` with metadata in `screenshots.json`
- Map markers show screenshots at their coordinates
- Edit metadata or delete screenshots through UI

## 🐛 Troubleshooting

### Database Issues
```bash
# Check database exists
docker exec -it <php-container> ls -la /var/www/api/database.sqlite

# Reinitialize database
docker exec -it <php-container> rm /var/www/api/database.sqlite
docker-compose restart php
```

### Background Workers Not Running
```bash
# Check worker logs
docker exec -it <php-container> tail -f /var/log/regenerate.log
docker exec -it <php-container> tail -f /var/log/walker.log
docker exec -it <php-container> tail -f /var/log/server-time.log
docker exec -it <php-container> tail -f /var/log/level-cron.log
```

### CORS Issues
Ensure `.env` has `CORS_ALLOWED_ORIGINS` set to your frontend URL.

### Map Tiles Not Loading
Verify tiles exist at `public/assets/tiles/1-1.png` through `3-3.png`

## 📝 Development

### Running Without Docker
1. Install PHP 8.2+ with SQLite extensions
2. Set up Nginx or Apache to serve `public/` and proxy `/api/` to PHP-FPM
3. Run background workers manually:
```bash
php api/cron/regenerate-health.php &
php api/cron/process-server-time.php &
php api/cron/process-walking.php --daemon &
php api/cron.php &
```

### Adding New Items
Edit `api/init-db.php` and add to the `$items` array, then reinitialize the database.

### Modifying Level Progression
Edit `api/levels.json` - changes take effect immediately via the level worker.

## 🤝 Contributing

Contributions welcome! This is a nostalgic passion project recreating the classic Regnum Online experience.

## 📄 License

This project is for educational and nostalgic purposes. Regnum Online/Champions of Regnum is property of NGD Studios.

## 🙏 Credits

- Original map tiles from Regnum Online (Champions of Regnum)
- Built by the cor-forum.de community
- Powered by Leaflet.js for interactive mapping

---

For detailed setup instructions and complete API reference, see [GAME_SETUP.md](GAME_SETUP.md)
