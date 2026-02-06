#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { gameDb } = require('../src/config/database');
const logger = require('../src/config/logger');

async function initDatabase() {
  try {
    logger.info('Checking database schema...');
    
    // Check if players table exists
    const [tables] = await gameDb.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = 'players'",
      [process.env.GAME_DB_NAME || 'regnum_nostalgia']
    );
    
    if (tables[0].count > 0) {
      logger.info('Database already initialized, skipping');
      return;
    }
    
    logger.info('Initializing database schema...');

    // Create sessions table
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        username VARCHAR(255) NOT NULL,
        realm VARCHAR(16) NULL,
        created_at INT NOT NULL,
        expires_at INT NOT NULL,
        last_activity INT NOT NULL,
        fingerprint VARCHAR(128) NULL,
        INDEX idx_sessions_user_id (user_id),
        INDEX idx_sessions_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // players table
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS players (
        user_id INT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        realm VARCHAR(16) NULL,
        x INT NOT NULL DEFAULT 0,
        y INT NOT NULL DEFAULT 0,
        health INT NOT NULL DEFAULT 600,
        max_health INT NOT NULL DEFAULT 600,
        mana INT NOT NULL DEFAULT 200,
        max_mana INT NOT NULL DEFAULT 200,
        xp INT NOT NULL DEFAULT 0,
        level INT NOT NULL DEFAULT 1,
        intelligence INT NOT NULL DEFAULT 20,
        dexterity INT NOT NULL DEFAULT 20,
        concentration INT NOT NULL DEFAULT 20,
        strength INT NOT NULL DEFAULT 20,
        constitution INT NOT NULL DEFAULT 20,
        last_active INT NOT NULL,
        INDEX idx_players_last_active (last_active),
        INDEX idx_players_realm (realm),
        INDEX idx_players_xp (xp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // territories
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS territories (
        territory_id INT AUTO_INCREMENT PRIMARY KEY,
        realm VARCHAR(16) NOT NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(32) NOT NULL,
        health INT NOT NULL DEFAULT 100,
        max_health INT NOT NULL DEFAULT 100,
        x INT NOT NULL,
        y INT NOT NULL,
        owner_realm VARCHAR(16) NULL,
        owner_players TEXT NULL,
        contested TINYINT(1) NOT NULL DEFAULT 0,
        contested_since INT NULL,
        icon_name VARCHAR(255) NULL,
        icon_name_contested VARCHAR(255) NULL,
        INDEX idx_territories_realm (realm),
        INDEX idx_territories_owner (owner_realm)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // superbosses
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS superbosses (
        boss_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        icon_name VARCHAR(255) NULL,
        health INT NOT NULL,
        max_health INT NOT NULL,
        x INT NOT NULL,
        y INT NOT NULL,
        last_attacked INT NULL,
        respawn_time INT NULL,
        INDEX idx_superbosses_health (health)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // territory_captures
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS territory_captures (
        capture_id INT AUTO_INCREMENT PRIMARY KEY,
        territory_id INT NOT NULL,
        previous_realm VARCHAR(16) NULL,
        new_realm VARCHAR(16) NOT NULL,
        captured_at INT NOT NULL,
        INDEX idx_territory_captures_territory_id (territory_id),
        INDEX idx_territory_captures_captured_at (captured_at),
        FOREIGN KEY (territory_id) REFERENCES territories(territory_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // items
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS items (
        item_id INT AUTO_INCREMENT PRIMARY KEY,
        template_key VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(64) NOT NULL,
        description TEXT NULL,
        stats TEXT NULL,
        rarity VARCHAR(32) DEFAULT 'common',
        stackable TINYINT(1) DEFAULT 1,
        level INT DEFAULT 1,
        equipment_slot VARCHAR(32) DEFAULT NULL,
        icon_name VARCHAR(255) DEFAULT NULL,
        weight INT NULL,
        INDEX idx_items_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // inventory
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        inventory_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        item_id INT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        acquired_at INT NOT NULL,
        INDEX idx_inventory_user_id (user_id),
        INDEX idx_inventory_item_id (item_id),
        INDEX idx_inventory_user_item (user_id, item_id),
        FOREIGN KEY (user_id) REFERENCES players(user_id),
        FOREIGN KEY (item_id) REFERENCES items(item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // equipment
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS equipment (
        equipment_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        head INT NULL,
        body INT NULL,
        hands INT NULL,
        shoulders INT NULL,
        legs INT NULL,
        weapon_right INT NULL,
        weapon_left INT NULL,
        ring_right INT NULL,
        ring_left INT NULL,
        amulet INT NULL,
        created_at INT NOT NULL,
        updated_at INT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES players(user_id),
        FOREIGN KEY (head) REFERENCES inventory(inventory_id),
        FOREIGN KEY (body) REFERENCES inventory(inventory_id),
        FOREIGN KEY (hands) REFERENCES inventory(inventory_id),
        FOREIGN KEY (shoulders) REFERENCES inventory(inventory_id),
        FOREIGN KEY (legs) REFERENCES inventory(inventory_id),
        FOREIGN KEY (weapon_right) REFERENCES inventory(inventory_id),
        FOREIGN KEY (weapon_left) REFERENCES inventory(inventory_id),
        FOREIGN KEY (ring_right) REFERENCES inventory(inventory_id),
        FOREIGN KEY (ring_left) REFERENCES inventory(inventory_id),
        FOREIGN KEY (amulet) REFERENCES inventory(inventory_id),
        INDEX idx_equipment_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // walkers
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS walkers (
        walker_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        positions LONGTEXT NOT NULL,
        current_index INT NOT NULL DEFAULT 0,
        started_at INT NOT NULL,
        updated_at INT NOT NULL,
        finished_at INT NULL DEFAULT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'new',
        collecting_x INT NULL DEFAULT NULL,
        collecting_y INT NULL DEFAULT NULL,
        collecting_spawn_id INT NULL DEFAULT NULL,
        INDEX idx_walkers_user_id (user_id),
        INDEX idx_walkers_finished_at (finished_at),
        INDEX idx_walkers_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // spawned_items
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS spawned_items (
        spawn_id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NULL,
        x INT NOT NULL,
        y INT NOT NULL,
        realm VARCHAR(16) NOT NULL,
        type VARCHAR(32) NOT NULL,
        loot_table_key VARCHAR(64) NULL,
        spawn_point_id VARCHAR(64) NULL,
        visual_icon VARCHAR(255) NOT NULL,
        spawned_at INT NOT NULL,
        collected_at INT NULL DEFAULT NULL,
        collected_by INT NULL DEFAULT NULL,
        INDEX idx_spawned_items_collected (collected_at),
        INDEX idx_spawned_items_realm (realm),
        INDEX idx_spawned_items_spawn_point (spawn_point_id),
        FOREIGN KEY (item_id) REFERENCES items(item_id),
        FOREIGN KEY (collected_by) REFERENCES players(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // server_time
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS server_time (
        id TINYINT PRIMARY KEY,
        started_at INT NOT NULL,
        last_updated INT NOT NULL,
        ingame_hour INT NOT NULL DEFAULT 0,
        ingame_minute INT NOT NULL DEFAULT 0,
        tick_seconds INT NOT NULL DEFAULT 150
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // levels
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS levels (
        level INT PRIMARY KEY,
        xp BIGINT NOT NULL,
        INDEX idx_levels_xp (xp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Seed levels from gameData/levels.json if empty
    const [levelsCount] = await gameDb.query('SELECT COUNT(*) as count FROM levels');
    if (levelsCount[0].count === 0) {
      const levelsPath = path.resolve(__dirname, '../gameData/levels.json');
      const levelsData = JSON.parse(fs.readFileSync(levelsPath, 'utf8'));
      if (Array.isArray(levelsData) && levelsData.length > 0) {
        const insertQuery = 'INSERT INTO levels (level, xp) VALUES ?';
        const values = levelsData.map(l => [l.level, l.xp]);
        await gameDb.query(insertQuery, [values]);
        logger.info(`Seeded ${values.length} levels from ${levelsPath}`);
      }
    }

    // Seed territories if empty
    const [territoryCount] = await gameDb.query('SELECT COUNT(*) as count FROM territories');
    if (territoryCount[0].count === 0) {
      const territories = [
        // realm, name, type, x, y, owner_realm, health, max_health, icon_name, icon_name_contested
        // Alsius
        ['alsius', 'Imperia Castle', 'castle', 2802, 1103, 'alsius', 250000, 250000, 'fort-alsius.png', 'fort-alsius-contested.png'],
        ['alsius', 'Fort Aggersborg', 'fort', 2729, 2415, 'alsius', 100000, 100000, 'fort-alsius.png', 'fort-alsius-contested.png'],
        ['alsius', 'Fort Trelleborg', 'fort', 1640, 2441, 'alsius', 100000, 100000, 'fort-alsius.png', 'fort-alsius-contested.png'],
        ['alsius', 'Great Wall of Alsius', 'wall', 1755, 2106, 'alsius', 500000, 500000, 'door-safe.png', 'door-vulnerable.png'],
        // Ignis
        ['ignis', 'Fort Menirah', 'fort', 3379, 1689, 'ignis', 100000, 100000, 'fort-ignis.png', 'fort-ignis-contested.png'],
        ['ignis', 'Fort Samal', 'fort', 3684, 2432, 'ignis', 100000, 100000, 'fort-ignis.png', 'fort-ignis-contested.png'],
        ['ignis', 'Shaanarid Castle', 'castle', 4608, 2974, 'ignis', 250000, 250000, 'fort-ignis.png', 'fort-ignis-contested.png'],
        ['ignis', 'Great Wall of Ignis', 'wall', 4148, 1966, 'ignis', 500000, 500000, 'door-safe.png', 'door-vulnerable.png'],
        // Syrtis
        ['syrtis', 'Fort Algaros', 'fort', 1742, 3200, 'syrtis', 100000, 100000, 'fort-syrtis.png', 'fort-syrtis-contested.png'],
        ['syrtis', 'Fort Herbred', 'fort', 2896, 3237, 'syrtis', 100000, 100000, 'fort-syrtis.png', 'fort-syrtis-contested.png'],
        ['syrtis', 'Eferias Castle', 'castle', 3757, 4717, 'syrtis', 250000, 250000, 'fort-syrtis.png', 'fort-syrtis-contested.png'],
        ['syrtis', 'Great Wall of Syrtis', 'wall', 2357, 4037, 'syrtis', 500000, 500000, 'door-safe.png', 'door-vulnerable.png'],
      ];

      for (const territory of territories) {
        await gameDb.query(
          'INSERT INTO territories (realm, name, type, x, y, owner_realm, health, max_health, icon_name, icon_name_contested) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          territory
        );
      }
      logger.info(`Seeded ${territories.length} territories`);
    }

    // Seed superbosses if empty
    const [superbossCount] = await gameDb.query('SELECT COUNT(*) as count FROM superbosses');
    if (superbossCount[0].count === 0) {
      const superbosses = [
        // name, icon_name, max_health, x, y
        ['Thorkul', 'boss-thorkul.png', 1500000, 2327, 1989],
        ['Daen Rha', 'boss-daen-rha.png', 1500000, 3907, 2654],
        ['Evendim', 'boss-evendim.png', 1500000, 3177, 3760],
        ['Alasthor', 'boss-alasthor.png', 1000000, 1504, 1097],
        ['Vesper', 'boss-vesper.png', 1000000, 2264, 5519],
        ['Tenax', 'boss-tenax.png', 1000000, 4285, 1371],
      ];

      for (const [name, iconName, maxHealth, x, y] of superbosses) {
        await gameDb.query(
          'INSERT INTO superbosses (name, icon_name, health, max_health, x, y) VALUES (?, ?, ?, ?, ?, ?)',
          [name, iconName, maxHealth, maxHealth, x, y]
        );
      }
      logger.info(`Seeded ${superbosses.length} superbosses`);
    }

    // Seed server_time if empty
    const [timeCount] = await gameDb.query('SELECT COUNT(*) as count FROM server_time');
    if (timeCount[0].count === 0) {
      const now = Math.floor(Date.now() / 1000);
      await gameDb.query(
        'INSERT INTO server_time (id, started_at, last_updated, ingame_hour, ingame_minute, tick_seconds) VALUES (1, ?, ?, 0, 0, 150)',
        [now, now]
      );
      logger.info('Initialized server_time');
    }

    // user_settings - persistent per-user preferences
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INT PRIMARY KEY,
        music_enabled TINYINT(1) NOT NULL DEFAULT 0,
        music_volume DOUBLE NOT NULL DEFAULT 0.20,
        sounds_enabled TINYINT(1) NOT NULL DEFAULT 1,
        sound_volume DOUBLE NOT NULL DEFAULT 1.0,
        capture_sounds_enabled TINYINT(1) NOT NULL DEFAULT 1,
        capture_sounds_volume DOUBLE NOT NULL DEFAULT 1.0,
        collection_sounds_enabled TINYINT(1) NOT NULL DEFAULT 1,
        collection_sounds_volume DOUBLE NOT NULL DEFAULT 1.0,
        map_version VARCHAR(8) NOT NULL DEFAULT 'v1',
        updated_at INT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES players(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // player_logs - ingame log messages for each player
    await gameDb.query(`
      CREATE TABLE IF NOT EXISTS player_logs (
        log_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        message TEXT NOT NULL,
        log_type VARCHAR(32) NOT NULL DEFAULT 'info',
        created_at INT NOT NULL,
        INDEX idx_player_logs_user_id (user_id),
        INDEX idx_player_logs_created_at (created_at),
        INDEX idx_player_logs_user_created (user_id, created_at),
        FOREIGN KEY (user_id) REFERENCES players(user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    logger.info('Database initialization completed');
  } catch (err) {
    logger.error('Database initialization failed', { error: err.message });
    throw err;
  }
}

// CLI execution
if (require.main === module) {
  initDatabase()
    .then(() => {
      gameDb.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      gameDb.end();
      process.exit(1);
    });
}

module.exports = { initDatabase };
