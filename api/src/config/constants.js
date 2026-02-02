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
    { template_key: 'health_potion', quantity: 3 }
  ],
  
  // Online Status
  ONLINE_THRESHOLD_SECONDS: 5,
  
  // Queue Intervals (milliseconds)
  QUEUE_INTERVALS: {
    WALKER: 2000,     // 2 seconds
    HEALTH: 1000,     // 1 second
    TIME: 10000,      // 10 seconds
    TERRITORY: 15000  // 15 seconds
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
  }
};
