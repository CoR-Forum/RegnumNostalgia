module.exports = {
  // External API URLs
  FORUM_API_URL: 'https://cor-forum.de/api.php',
  FORUM_API_KEY: process.env.COR_FORUM_API_KEY || '',
  
  SCREENSHOTS_API_URL: 'https://cor-forum.de/regnum/RegnumNostalgia/screenshots_api.php',
  SCREENSHOTS_API_KEY: process.env.SCREENSHOTS_API_KEY || '',
  
  WARSTATUS_API_URL: 'https://cort.thebus.top/api/var/warstatus.json',
  
  // Session/JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET environment variable is required'); })(),
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
    { template_key: 'gold_coin', quantity: 1000 },
    { template_key: 'health_potion', quantity: 100 },
    { template_key: 'mana_potion', quantity: 100 },
    { template_key: 'gm_walk_speed_potion_15', quantity: 100 },
    { template_key: 'gm_damage_potion_5', quantity: 100 },
    { template_key: 'gm_ring', quantity: 2 },
    { template_key: 'gm_amulet', quantity: 1 },
    { template_key: 'gm_sword', quantity: 2 },
    { template_key: 'gm_crown', quantity: 1 },
    { template_key: 'gm_shield', quantity: 1 },
    { template_key: 'gm_pauldrons', quantity: 1 },
    { template_key: 'gm_chestplate', quantity: 1 },
    { template_key: 'gm_leggings', quantity: 1 },
    { template_key: 'gm_gloves', quantity: 1 },
    { template_key: 'great_magic_gem_lucky_box', quantity: 100 },
    { template_key: 'vesper_amulet', quantity: 1 },
    { template_key: 'tenax_amulet', quantity: 1 },
    { template_key: 'alasthor_amulet', quantity: 1 },
  ],
  
  // Online Status
  ONLINE_THRESHOLD_SECONDS: 10, // Consider players online if active within the last 10 seconds
  
  // Queue Intervals (milliseconds)
  QUEUE_INTERVALS: {
    WALKER: 1000,     // 1 second — movement tick
    HEALTH: 1000,     // 1 second — health/mana regen tick
    SPELL: 1000,      // 1 second — spell tick (buff/debuff processing)
    TIME: 10000,      // 10 seconds — in-game clock sync
    TERRITORY: 10000, // 10 seconds — territory status check
    SPAWN: 5000       // 5 seconds — collectable spawn check
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
    removeOnComplete: 1000,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  },

  // Collectable Items Configuration
  COLLECTABLE_CONFIG: {
    PICKUP_RADIUS: 10, // pixels — distance tolerance for collection
    RESPAWN_TIME: 5,    // seconds — default respawn time
  },

  // Collectable Visual Icons
  COLLECTABLE_VISUALS: {
    ROCK: 'collectable-rock.png',
    GOLD_PILE: 'collectable-gold.png',
    CHEST: 'collectable-chest.png',
    HERB: 'collectable-herb.png',
    ORE: 'collectable-ore.png'
  },

  // Collectable Visual Names (for tooltips)
  COLLECTABLE_VISUAL_NAMES: {
    'collectable-rock.png': 'Rock',
    'collectable-gold.png': 'Gold Pile',
    'collectable-chest.png': 'Treasure Chest',
    'collectable-herb.png': 'Herb',
    'collectable-ore.png': 'Ore Vein'
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
    treasure_chest: {
      mode: 'multi-drop',
      rolls: 3,
      pool: [
        { item: 'gold_coin', weight: 5, quantity: [10, 50] },
        { item: 'health_potion', weight: 3, quantity: [1, 5] },
        { item: 'mana_potion', weight: 2, quantity: [1, 5] }
      ]
    },
    gold_pile: {
      mode: 'independent',
      pool: [
        { item: 'gold_coin', weight: 10, quantity: [5, 15] }
      ]
    },
    minor_gem_lucky_box: {
      mode: 'weighted',
      pool: [
        { item: 'minor_achroite', weight: 1, quantity: [1, 1] },
        { item: 'minor_jade', weight: 1, quantity: [1, 1] },
        { item: 'minor_jasper', weight: 1, quantity: [1, 1] },
        { item: 'minor_aragonite', weight: 1, quantity: [1, 1] },
        { item: 'minor_cyanite', weight: 1, quantity: [1, 1] },
        { item: 'minor_azurite', weight: 1, quantity: [1, 1] },
        { item: 'minor_aventurine', weight: 1, quantity: [1, 1] },
        { item: 'minor_aquamarine', weight: 1, quantity: [1, 1] },
        { item: 'minor_ruby', weight: 1, quantity: [1, 1] },
        { item: 'minor_nephrite', weight: 1, quantity: [1, 1] }
      ]
    },
    major_gem_lucky_box: {
      mode: 'weighted',
      pool: [
        { item: 'major_achroite', weight: 1, quantity: [1, 1] },
        { item: 'major_jade', weight: 1, quantity: [1, 1] },
        { item: 'major_jasper', weight: 1, quantity: [1, 1] },
        { item: 'major_aragonite', weight: 1, quantity: [1, 1] },
        { item: 'major_cyanite', weight: 1, quantity: [1, 1] },
        { item: 'major_azurite', weight: 1, quantity: [1, 1] },
        { item: 'major_aventurine', weight: 1, quantity: [1, 1] },
        { item: 'major_aquamarine', weight: 1, quantity: [1, 1] },
        { item: 'major_ruby', weight: 1, quantity: [1, 1] },
        { item: 'major_nephrite', weight: 1, quantity: [1, 1] }
      ]
    },
    great_gem_lucky_box: {
      mode: 'weighted',
      pool: [
        { item: 'great_achroite', weight: 1, quantity: [1, 1] },
        { item: 'great_jade', weight: 1, quantity: [1, 1] },
        { item: 'great_jasper', weight: 1, quantity: [1, 1] },
        { item: 'great_aragonite', weight: 1, quantity: [1, 1] },
        { item: 'great_cyanite', weight: 1, quantity: [1, 1] },
        { item: 'great_azurite', weight: 1, quantity: [1, 1] },
        { item: 'great_aventurine', weight: 1, quantity: [1, 1] },
        { item: 'great_aquamarine', weight: 1, quantity: [1, 1] },
        { item: 'great_ruby', weight: 1, quantity: [1, 1] },
        { item: 'great_nephrite', weight: 1, quantity: [1, 1] }
      ]
    }
  },

  // Fixed Spawn Points
  // respawnMode: 'fixed' (always same item) or 'pool' (random from item pool)
  FIXED_SPAWN_POINTS: [

    {
      id: 'neutral-rock-1',
      x: 2933,
      y: 3071,
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
      maxSpawns: 2,
      respawnTime: 180,
      realm: 'syrtis',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    },
    {
      regions: ['alsius-inner-1'],
      maxSpawns: 2,
      respawnTime: 180,
      realm: 'alsius',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    },
    {
      regions: ['ignis-inner-1'],
      maxSpawns: 2,
      respawnTime: 180,
      realm: 'ignis',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    },
    {
      regions: ['syrtis-warzone-1', 'ignis-warzone-1', 'alsius-warzone-1'],
      maxSpawns: 3,
      respawnTime: 180,
      realm: 'neutral',
      visual: 'collectable-rock.png',
      type: 'loot-container',
      lootTable: 'rock',
      respawnMode: 'pool'
    },
  ]
};
