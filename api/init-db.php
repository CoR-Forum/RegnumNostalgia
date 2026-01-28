<?php
/**
 * Database initialization script
 * Run this once to create the SQLite database and tables
 */

define('DB_PATH', __DIR__ . '/database.sqlite');

try {
    $db = new PDO('sqlite:' . DB_PATH);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Create sessions table
    $db->exec('
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            realm TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            last_activity INTEGER NOT NULL,
            fingerprint TEXT
        )
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)');

    // Create players table
    $db->exec('
        CREATE TABLE IF NOT EXISTS players (
            user_id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            realm TEXT,
            x INTEGER NOT NULL DEFAULT 0,
            y INTEGER NOT NULL DEFAULT 0,
            health INTEGER NOT NULL DEFAULT 600,
            max_health INTEGER NOT NULL DEFAULT 600,
            mana INTEGER NOT NULL DEFAULT 200,
            max_mana INTEGER NOT NULL DEFAULT 200,
            xp INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 1,
            intelligence INTEGER NOT NULL DEFAULT 20,
            dexterity INTEGER NOT NULL DEFAULT 20,
            concentration INTEGER NOT NULL DEFAULT 20,
            strength INTEGER NOT NULL DEFAULT 20,
            constitution INTEGER NOT NULL DEFAULT 20,
            last_active INTEGER NOT NULL
        )
    '); 
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_last_active ON players(last_active)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_realm ON players(realm)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_xp ON players(xp)');

    // Create territories table (forts and castles)
    $db->exec('
        CREATE TABLE IF NOT EXISTS territories (
            territory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            realm TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            health INTEGER NOT NULL DEFAULT 100,
            max_health INTEGER NOT NULL DEFAULT 100,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            owner_realm TEXT,
            owner_players TEXT,
            contested INTEGER NOT NULL DEFAULT 0,
            contested_since INTEGER
        )
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_territories_realm ON territories(realm)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_territories_owner ON territories(owner_realm)');

    // Create superbosses table
    $db->exec('
        CREATE TABLE IF NOT EXISTS superbosses (
            boss_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            health INTEGER NOT NULL,
            max_health INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            last_attacked INTEGER,
            respawn_time INTEGER
        )
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_superbosses_health ON superbosses(health)');

    // Create items table (item templates)
    $db->exec("
        CREATE TABLE IF NOT EXISTS items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL,
            description TEXT,
            stats TEXT,
            rarity TEXT DEFAULT 'common',
            stackable INTEGER DEFAULT 1,
            level INTEGER DEFAULT 1,
            equipment_slot TEXT DEFAULT NULL
        )
    ");

    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)');

    // NOTE: paths are now loaded from a JSON file (not stored in DB)

    // Create inventory table (player ownership)
    $db->exec('
        CREATE TABLE IF NOT EXISTS inventory (
            inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            acquired_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES players(user_id),
            FOREIGN KEY (item_id) REFERENCES items(item_id)
        )
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_inventory_item_id ON inventory(item_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_inventory_user_item ON inventory(user_id, item_id)');

    // Create equipment table (player equipment slots)
    $db->exec('
        CREATE TABLE IF NOT EXISTS equipment (
            equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            head INTEGER,
            body INTEGER,
            hands INTEGER,
            shoulders INTEGER,
            legs INTEGER,
            weapon_right INTEGER,
            weapon_left INTEGER,
            ring_right INTEGER,
            ring_left INTEGER,
            amulet INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
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
            FOREIGN KEY (amulet) REFERENCES inventory(inventory_id)
        )
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_equipment_user_id ON equipment(user_id)');

    // Create walkers table (player movement jobs)
    $db->exec('
        CREATE TABLE IF NOT EXISTS walkers (
            walker_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            positions TEXT NOT NULL,
            current_index INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    ');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_walkers_user_id ON walkers(user_id)');

    // Seed territories with forts, castles, and walls

    // Create server_time table to track in-game time (1 real hour == 24 in-game hours)
    $db->exec('
        CREATE TABLE IF NOT EXISTS server_time (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            started_at INTEGER NOT NULL,
            last_updated INTEGER NOT NULL,
            ingame_hour INTEGER NOT NULL DEFAULT 0,
            ingame_minute INTEGER NOT NULL DEFAULT 0,
            tick_seconds INTEGER NOT NULL DEFAULT 150
        )
    ');

    $stmt = $db->prepare('SELECT COUNT(*) FROM server_time');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $now = time();
        $stmt = $db->prepare('INSERT INTO server_time (id, started_at, last_updated, ingame_hour, ingame_minute, tick_seconds) VALUES (1, ?, ?, 0, 0, 150)');
        $stmt->execute([$now, $now]);
        echo "  - Initialized server_time (1 real hour = 24 in-game hours)\n";
    }
    $territories = [
        // Syrtis
        ['syrtis', 'Algaros Fort', 'fort', 1742, 3200, 'syrtis', 100000, 100000],
        ['syrtis', 'Herbret Fort', 'fort', 2896, 3237, 'syrtis', 100000, 100000],
        ['syrtis', 'Eferias Castle', 'castle', 3757, 4717, 'syrtis', 250000, 250000],
        ['syrtis', 'Syrtis Realm Wall', 'wall', 2357, 4037, 'syrtis', 500000, 500000],
        // Ignis
        ['ignis', 'Menirah Fort', 'fort', 3379, 1689, 'ignis', 100000, 100000],
        ['ignis', 'Samal Fort', 'fort', 3684, 2432, 'ignis', 100000, 100000],
        ['ignis', 'Shaanarid Castle', 'castle', 4608, 2974, 'ignis', 250000, 250000],
        ['ignis', 'Ignis Realm Wall', 'wall', 4148, 1966, 'ignis', 500000, 500000],
        // Alsius
        ['alsius', 'Trelleborg Fort', 'fort', 1640, 2441, 'alsius', 100000, 100000],
        ['alsius', 'Aggersborg Fort', 'fort', 2729, 2415, 'alsius', 100000, 100000],
        ['alsius', 'Imperia Castle', 'castle', 2802, 1103, 'alsius', 250000, 250000],
        ['alsius', 'Alsius Realm Wall', 'wall', 1755, 2106, 'alsius', 500000, 500000],
    ];

    $stmt = $db->prepare('SELECT COUNT(*) FROM territories');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $stmt = $db->prepare('INSERT INTO territories (realm, name, type, x, y, owner_realm, health, max_health) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($territories as $territory) {
            $stmt->execute($territory);
        }
        echo "  - Seeded " . count($territories) . " territories (forts, castles, and walls)\n";
    }

    // Seed superbosses
    $superbosses = [
        ['Thorkul', 1500000, 2327, 1989],
        ['Daen Rha', 1500000, 3907, 2654],
        ['Evendim', 1500000, 3177, 3760],
        ['Alasthor', 1000000, 1504, 1097],
        ['Vesper', 1000000, 2264, 5519],
        ['Tenax', 1000000, 4285, 1371],
    ];

    $stmt = $db->prepare('SELECT COUNT(*) FROM superbosses');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $stmt = $db->prepare('INSERT INTO superbosses (name, max_health, health, x, y) VALUES (?, ?, ?, ?, ?)');
        foreach ($superbosses as $boss) {
            $stmt->execute([$boss[0], $boss[1], $boss[1], $boss[2], $boss[3]]);
        }
        echo "  - Seeded " . count($superbosses) . " superbosses\n";
    }

    // Seed items (item templates)
    $items = [
        // Consumables & currency
        ['Health Potion', 'consumable', 'Restores 100 health', '{"heal": 100}', 'common', 1, 1, NULL],
        ['Mana Potion', 'consumable', 'Restores 50 mana', '{"mana": 50}', 'common', 1, 1, NULL],
        ['Health Elixir', 'consumable', 'Fully restores health', '{"heal": 9999}', 'rare', 1, 5, NULL],
        ['Teleport Scroll', 'consumable', 'Teleports to spawn point', '{}', 'uncommon', 1, 1, NULL],
        ['Gold Coin', 'currency', 'A shiny gold coin', '{"value": 1}', 'common', 1, 0, NULL],

        // Weapons (right hand)
        ['Iron Sword', 'weapon', 'A basic iron sword', '{"damage": 15, "speed": 1.2}', 'common', 0, 1, 'weapon_right'],
        ['Steel Sword', 'weapon', 'A sturdy steel sword', '{"damage": 25, "speed": 1.3}', 'uncommon', 0, 3, 'weapon_right'],
        ['Magic Staff', 'weapon', 'A staff imbued with magic', '{"damage": 20, "mana_boost": 30}', 'rare', 0, 5, 'weapon_right'],
        ['Battle Axe', 'weapon', 'A heavy two-handed axe', '{"damage": 35, "speed": 0.9}', 'rare', 0, 6, 'weapon_right'],
        ['Dagger', 'weapon', 'A small quick blade', '{"damage": 8, "speed": 1.8}', 'common', 0, 1, 'weapon_right'],

        // Off-hand (left hand) - shields / secondary weapons
        ['Wooden Shield', 'armor', 'A simple wooden shield', '{"defense": 10}', 'common', 0, 1, 'weapon_left'],
        ['Tower Shield', 'armor', 'Large shield offering excellent protection', '{"defense": 22}', 'uncommon', 0, 4, 'weapon_left'],

        // Head
        ['Leather Cap', 'armor', 'A light leather cap', '{"defense": 5}', 'common', 0, 1, 'head'],
        ['Iron Helmet', 'armor', 'A sturdy iron helmet', '{"defense": 12}', 'uncommon', 0, 3, 'head'],

        // Body
        ['Leather Tunic', 'armor', 'Light leather armor for torso', '{"defense": 8}', 'common', 0, 1, 'body'],
        ['Iron Armor', 'armor', 'Basic iron chest armor', '{"defense": 20, "health": 50}', 'common', 0, 4, 'body'],
        ['Plate Armor', 'armor', 'Heavy plate armor', '{"defense": 40, "health": 150}', 'epic', 0, 8, 'body'],

        // Hands
        ['Leather Gloves', 'armor', 'Simple leather gloves', '{"defense": 3}', 'common', 0, 1, 'hands'],
        ['Iron Gauntlets', 'armor', 'Sturdy iron gauntlets', '{"defense": 8}', 'uncommon', 0, 3, 'hands'],

        // Shoulders
        ['Leather Pauldrons', 'armor', 'Small shoulder guards', '{"defense": 4}', 'common', 0, 1, 'shoulders'],
        ['Steel Pauldrons', 'armor', 'Reinforced shoulder armor', '{"defense": 10}', 'rare', 0, 4, 'shoulders'],

        // Legs
        ['Leather Leggings', 'armor', 'Light leg protection', '{"defense": 6}', 'common', 0, 1, 'legs'],
        ['Iron Leggings', 'armor', 'Reinforced leg armor', '{"defense": 14}', 'uncommon', 0, 3, 'legs'],

        // Rings (right/left)
        ['Silver Ring', 'misc', 'A simple silver ring', '{"defense": 1}', 'common', 0, 1, 'ring_right'],
        ['Gold Ring', 'misc', 'A ring of fine gold', '{"defense": 2}', 'uncommon', 0, 2, 'ring_left'],

        // Amulets
        ['Silver Amulet', 'misc', 'A charm worn around the neck', '{"mana_boost": 5}', 'common', 0, 1, 'amulet'],
        ['Amulet of Strength', 'misc', 'Increases strength significantly', '{"damage": 10, "strength": 5}', 'rare', 0, 6, 'amulet'],
    ];

    $stmt = $db->prepare('SELECT COUNT(*) FROM items');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $stmt = $db->prepare('INSERT INTO items (name, type, description, stats, rarity, stackable, level, equipment_slot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($items as $item) {
            $stmt->execute($item);
        }
        echo "  - Seeded " . count($items) . " item templates\n";
    }

    // Paths are provided via api/paths.json (not seeded into DB)

    // Seed starter items for existing players
    $stmt = $db->prepare('SELECT user_id FROM players WHERE user_id NOT IN (SELECT DISTINCT user_id FROM inventory)');
    $stmt->execute();
    $playersWithoutItems = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (count($playersWithoutItems) > 0) {
        // Get item IDs for starter items
        $stmt = $db->prepare('SELECT item_id FROM items WHERE name = ?');
        $stmt->execute(['Health Potion']);
        $healthPotionId = $stmt->fetchColumn();
        $stmt->execute(['Mana Potion']);
        $manaPotionId = $stmt->fetchColumn();
        $stmt->execute(['Iron Sword']);
        $ironSwordId = $stmt->fetchColumn();
        
        $stmt = $db->prepare('INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?)');
        foreach ($playersWithoutItems as $player) {
            $now = time();
            // Give starter items
            $stmt->execute([$player['user_id'], $healthPotionId, 5, $now]);
            $stmt->execute([$player['user_id'], $manaPotionId, 3, $now]);
            $stmt->execute([$player['user_id'], $ironSwordId, 1, $now]);
        }
        echo "  - Seeded starter items for " . count($playersWithoutItems) . " existing players\n";
    }

    echo "Database initialized successfully!\n";
    echo "Database location: " . DB_PATH . "\n";
    echo "\nTables created:\n";
    echo "  - sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity, fingerprint)\n";
    echo "  - players (user_id, username, realm, x, y, health, max_health, mana, max_mana, xp, level, intelligence, dexterity, concentration, strength, constitution, last_active)\n";
    echo "  - territories (territory_id, realm, name, type, health, x, y, owner_realm, owner_players, contested, contested_since)\n";
    echo "  - superbosses (boss_id, name, health, max_health, x, y, last_attacked, respawn_time)\n";
    echo "  - items (item_id, name, type, description, stats, rarity, stackable, equipment_slot)\n";
    echo "  - inventory (inventory_id, user_id, item_id, quantity, acquired_at)\n";
    echo "  - equipment (equipment_id, user_id, head, body, hands, shoulders, legs, weapon_right, weapon_left, ring_right, ring_left, amulet, created_at, updated_at)\n";
    echo "  - server_time (started_at, last_updated, ingame_hour, ingame_minute, tick_seconds)\n";
} catch (PDOException $e) {
    echo "Error initializing database: " . $e->getMessage() . "\n";
    exit(1);
}
