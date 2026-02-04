module.exports = {
  // External API URLs
  FORUM_API_URL: 'https://cor-forum.de/api.php',
  FORUM_API_KEY: process.env.COR_FORUM_API_KEY || '',
  
  SCREENSHOTS_API_URL: 'https://cor-forum.de/regnum/RegnumNostalgia/screenshots_api.php',
  SCREENSHOTS_API_KEY: process.env.SCREENSHOTS_API_KEY || '',
  
  WARSTATUS_API_URL: 'https://cort.thebus.top/api/var/warstatus.json',
  
  // Session/JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  JWT_EXPIRES_IN: '24h',
  SESSION_DURATION: 86400, // 24 hours in seconds
  
  // Game Configuration
  SPAWN_COORDS: {
    syrtis: { x: 237, y: 5397 },
    alsius: { x: 1509, y: 377 },
    ignis: { x: 5000, y: 618 }
  },
  
  COORDINATE_BOUNDS: {
    min: 0,
    max: 6144
  },
  
  // Starter Items (granted on realm selection)
  STARTER_ITEMS: [
    { template_key: 'gold_coin', quantity: 5000 },
    { template_key: 'health_potion', quantity: 3 },
    { template_key: 'iron_swordddd', quantity: 2 },
    { template_key: 'wooden_shield', quantity: 1 },
    { template_key: 'iron_helmet', quantity: 1 },
    { template_key: 'leather_pauldrons', quantity: 1 },
    { template_key: 'silver_amulet', quantity: 1 }
  ],
  
  // Online Status
  ONLINE_THRESHOLD_SECONDS: 5,
  
  // Queue Intervals (milliseconds)
  QUEUE_INTERVALS: {
    WALKER: 500,     // 2 seconds
    HEALTH: 1000,     // 1 second
    TIME: 10000,      // 10 seconds
    TERRITORY: 15000,  // 15 seconds
    SPAWN: 5000       // 5 seconds
  },
  
  // Health Regeneration Rates
  REGEN_RATES: {
    PLAYER_HEALTH: 8,
    PLAYER_MANA: 4,
    FORT_HEALTH: 42,
    CASTLE_HEALTH: 100,
    WALL_HEALTH: 167,
    SUPERBOSS_HEALTH: 417
  },
  
  // Server Time Configuration
  SERVER_TIME_TICK_SECONDS: 150, // 1 real hour = 24 ingame hours
  
  // Bull Queue Configuration
  BULL_JOB_OPTIONS: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  },

  // Collectable Items Configuration
  COLLECTABLE_CONFIG: {
    PICKUP_RADIUS: 10, // pixels - distance tolerance for collection
    RESPAWN_TIME: 5, // seconds - 5 minutes default respawn
  },

  // Collectable Visual Icons
  COLLECTABLE_VISUALS: {
    ROCK: 'collectable-rock.png',
    GOLD_PILE: 'collectable-gold.png',
    CHEST: 'collectable-chest.png',
    HERB: 'collectable-herb.png',
    ORE: 'collectable-ore.png'
  },

  // Loot Tables
  // Modes: 'weighted' (pick one item), 'multi-drop' (pick N times), 'independent' (each item rolls separately)
  LOOT_TABLES: {
    rock: {
      mode: 'weighted',
      pool: [
        { item: 'gold_coin', weight: 7, quantity: [1, 20] },
        { item: 'magnanite', weight: 2, quantity: [1, 5] }
      ]
    },
    gold_pile: {
      mode: 'independent',
      pool: [
        { item: 'gold_coin', weight: 10, quantity: [5, 15] }
      ]
    }
  },

  // Fixed Spawn Points
  // respawnMode: 'fixed' (always same item) or 'pool' (random from item pool)
  FIXED_SPAWN_POINTS: [

    {
      id: 'neutral-rock-1',
      x: 3000,
      y: 3000,
      realm: 'neutral',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnTime: 600,
      respawnMode: 'fixed'
    }
  ],

  // Region-Based Spawns
  REGION_SPAWN_RULES: [
    {
      regions: ['syrtis-inner-1', 'syrtis-inner-2'],
      maxSpawns: 5,
      respawnTime: 180,
      realm: 'syrtis',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    },
    {
      regions: ['alsius-inner-1'],
      maxSpawns: 3,
      respawnTime: 180,
      realm: 'alsius',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    },
    {
      regions: ['ignis-inner-1'],
      maxSpawns: 3,
      respawnTime: 180,
      realm: 'ignis',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    }
  ]
};
