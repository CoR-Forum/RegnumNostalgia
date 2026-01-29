<?php
/**
 * Database initialization script
 * Run this once to create the MariaDB database and tables
 */

define('DB_HOST', getenv('GAME_DB_HOST') ?: 'db');
define('DB_PORT', getenv('GAME_DB_PORT') ?: 3306);
define('DB_NAME', getenv('GAME_DB_NAME') ?: 'regnum_nostalgia');
define('DB_USER', getenv('GAME_DB_USER') ?: 'regnum_user');
define('DB_PASS', getenv('GAME_DB_PASS') ?: 'regnum_pass');

try {
    $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $db = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);

    // Create sessions table
    $db->exec('
        CREATE TABLE IF NOT EXISTS sessions (
            session_id VARCHAR(64) PRIMARY KEY,
            user_id INT NOT NULL,
            username VARCHAR(255) NOT NULL,
            realm VARCHAR(16) NULL,
            created_at INT NOT NULL,
            expires_at INT NOT NULL,
            last_activity INT NOT NULL,
            fingerprint VARCHAR(128) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)');

    // Create players table
    $db->exec('
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
            last_active INT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    '); 
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_last_active ON players(last_active)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_realm ON players(realm)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_xp ON players(xp)');

    // Create territories table (forts and castles)
    $db->exec('
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
            icon_name_contested VARCHAR(255) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_territories_realm ON territories(realm)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_territories_owner ON territories(owner_realm)');

    // Create superbosses table
    $db->exec('
        CREATE TABLE IF NOT EXISTS superbosses (
            boss_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            icon_name VARCHAR(255) NULL,
            health INT NOT NULL,
            max_health INT NOT NULL,
            x INT NOT NULL,
            y INT NOT NULL,
            last_attacked INT NULL,
            respawn_time INT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_superbosses_health ON superbosses(health)');

    // Create territory captures table to track ownership changes
    $db->exec('
        CREATE TABLE IF NOT EXISTS territory_captures (
            capture_id INT AUTO_INCREMENT PRIMARY KEY,
            territory_id INT NOT NULL,
            previous_realm VARCHAR(16) NULL,
            new_realm VARCHAR(16) NOT NULL,
            captured_at INT NOT NULL,
            FOREIGN KEY (territory_id) REFERENCES territories(territory_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_territory_captures_territory_id ON territory_captures(territory_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_territory_captures_captured_at ON territory_captures(captured_at)');

    // Create items table (item templates) with stable template_key
    $db->exec(" 
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
            icon_name VARCHAR(255) DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)');

    // NOTE: paths are now loaded from a JSON file (not stored in DB)

    // Create inventory table (player ownership)
    $db->exec('
        CREATE TABLE IF NOT EXISTS inventory (
            inventory_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            item_id INT NOT NULL,
            quantity INT NOT NULL DEFAULT 1,
            acquired_at INT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES players(user_id),
            FOREIGN KEY (item_id) REFERENCES items(item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_inventory_item_id ON inventory(item_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_inventory_user_item ON inventory(user_id, item_id)');

    // Create equipment table (player equipment slots)
    $db->exec('
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
            FOREIGN KEY (amulet) REFERENCES inventory(inventory_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_equipment_user_id ON equipment(user_id)');

    // Create walkers table (player movement jobs)
    $db->exec(" 
        CREATE TABLE IF NOT EXISTS walkers (
            walker_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            positions LONGTEXT NOT NULL,
            current_index INT NOT NULL DEFAULT 0,
            started_at INT NOT NULL,
            updated_at INT NOT NULL,
            finished_at INT NULL DEFAULT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'new'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_walkers_user_id ON walkers(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_walkers_finished_at ON walkers(finished_at)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_walkers_status ON walkers(status)');

    // Seed territories with forts, castles, and walls

    // Create server_time table to track in-game time (1 real hour == 24 in-game hours)
    $db->exec('
        CREATE TABLE IF NOT EXISTS server_time (
            id TINYINT PRIMARY KEY,
            started_at INT NOT NULL,
            last_updated INT NOT NULL,
            ingame_hour INT NOT NULL DEFAULT 0,
            ingame_minute INT NOT NULL DEFAULT 0,
            tick_seconds INT NOT NULL DEFAULT 150
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
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
        // realm, name, type, x, y, owner_realm, health, max_health, icon_name, icon_name_contested
        // Alsius
        ['alsius', 'Imperia Castle', 'castle', 2802, 1103, 'alsius', 250000, 250000, 'fort-alsius.png', 'fort-alsius-contested.png'],
        ['alsius', 'Aggersborg Fort', 'fort', 2729, 2415, 'alsius', 100000, 100000, 'fort-alsius.png', 'fort-alsius-contested.png'],
        ['alsius', 'Trelleborg Fort', 'fort', 1640, 2441, 'alsius', 100000, 100000, 'fort-alsius.png', 'fort-alsius-contested.png'],
        ['alsius', 'Alsius Realm Wall', 'wall', 1755, 2106, 'alsius', 500000, 500000, 'door-safe.png', 'door-vulnerable.png'],
        // Ignis
        ['ignis', 'Menirah Fort', 'fort', 3379, 1689, 'ignis', 100000, 100000, 'fort-ignis.png', 'fort-ignis-contested.png'],
        ['ignis', 'Samal Fort', 'fort', 3684, 2432, 'ignis', 100000, 100000, 'fort-ignis.png', 'fort-ignis-contested.png'],
        ['ignis', 'Shaanarid Castle', 'castle', 4608, 2974, 'ignis', 250000, 250000, 'fort-ignis.png', 'fort-ignis-contested.png'],
        ['ignis', 'Ignis Realm Wall', 'wall', 4148, 1966, 'ignis', 500000, 500000, 'door-safe.png', 'door-vulnerable.png'],
        // Syrtis
        ['syrtis', 'Algaros Fort', 'fort', 1742, 3200, 'syrtis', 100000, 100000, 'fort-syrtis.png', 'fort-syrtis-contested.png'],
        ['syrtis', 'Herbret Fort', 'fort', 2896, 3237, 'syrtis', 100000, 100000, 'fort-syrtis.png', 'fort-syrtis-contested.png'],
        ['syrtis', 'Eferias Castle', 'castle', 3757, 4717, 'syrtis', 250000, 250000, 'fort-syrtis.png', 'fort-syrtis-contested.png'],
        ['syrtis', 'Syrtis Realm Wall', 'wall', 2357, 4037, 'syrtis', 500000, 500000, 'door-safe.png', 'door-vulnerable.png'],
    ];

    $stmt = $db->prepare('SELECT COUNT(*) FROM territories');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $stmt = $db->prepare('INSERT INTO territories (realm, name, type, x, y, owner_realm, health, max_health, icon_name, icon_name_contested) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($territories as $territory) {
            $stmt->execute($territory);
        }
        echo "  - Seeded " . count($territories) . " territories (forts, castles, and walls)\n";
    }

    // Seed superbosses
    // Icons live in public/assets/markers (boss-*.png)
    $superbosses = [
        ['Thorkul', 'boss-thorkul.png', 1500000, 2327, 1989],
        ['Daen Rha', 'boss-daen-rha.png', 1500000, 3907, 2654],
        ['Evendim', 'boss-evendim.png', 1500000, 3177, 3760],
        ['Alasthor', 'boss-alasthor.png', 1000000, 1504, 1097],
        ['Vesper', 'boss-vesper.png', 1000000, 2264, 5519],
        ['Tenax', 'boss-tenax.png', 1000000, 4285, 1371],
    ];

    $stmt = $db->prepare('SELECT COUNT(*) FROM superbosses');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $stmt = $db->prepare('INSERT INTO superbosses (name, icon_name, max_health, health, x, y) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($superbosses as $boss) {
            $stmt->execute([$boss[0], $boss[1], $boss[2], $boss[2], $boss[3], $boss[4]]);
        }
        echo "  - Seeded " . count($superbosses) . " superbosses\n";
    }

    // Seed items (item templates)
    // If directory api/gameData/items/ exists, load and merge all JSON files inside it.
    // Otherwise require api/gameData/items.json (single file).
    $itemsDir = __DIR__ . '/gameData/items';
    $items = [];

    if (is_dir($itemsDir)) {
        $files = glob($itemsDir . '/*.json');
        foreach ($files as $f) {
            $json = file_get_contents($f);
            $decoded = json_decode($json, true);
            if (!is_array($decoded)) {
                echo "Error: items file " . basename($f) . " contains invalid JSON or is not an array\n";
                exit(1);
            }
            foreach ($decoded as $it) {
                $stats = isset($it['stats']) ? json_encode($it['stats']) : '{}';
                if (!isset($it['template_key']) || trim((string)$it['template_key']) === '') {
                    echo "Error: missing template_key in " . basename($f) . " for item '" . ($it['name'] ?? '') . "'\n";
                    exit(1);
                }
                $template_key = $it['template_key'];
                $items[] = [
                    $template_key,
                    $it['name'] ?? '',
                    $it['type'] ?? 'misc',
                    $it['description'] ?? null,
                    $stats,
                    $it['rarity'] ?? 'common',
                    isset($it['stackable']) ? (int)$it['stackable'] : 1,
                    isset($it['level']) ? (int)$it['level'] : 1,
                    $it['equipment_slot'] ?? null,
                    $it['icon_name'] ?? null
                ];
            }
        }
    } else {
        $itemsFile = __DIR__ . '/gameData/items.json';
        if (!file_exists($itemsFile)) {
            echo "Error: required file api/gameData/items.json not found and api/gameData/items/ directory does not exist\n";
            exit(1);
        }

        $json = file_get_contents($itemsFile);
        $decoded = json_decode($json, true);
            if (!is_array($decoded)) {
                echo "Error: api/gameData/items.json contains invalid JSON or is not an array\n";
            exit(1);
        }

            foreach ($decoded as $it) {
            $stats = isset($it['stats']) ? json_encode($it['stats']) : '{}';
            if (!isset($it['template_key']) || trim((string)$it['template_key']) === '') {
                echo "Error: missing template_key in api/gameData/items.json for item '" . ($it['name'] ?? '') . "'\n";
                exit(1);
            }
            $template_key = $it['template_key'];
            $items[] = [
                $template_key,
                $it['name'] ?? '',
                $it['type'] ?? 'misc',
                $it['description'] ?? null,
                $stats,
                $it['rarity'] ?? 'common',
                isset($it['stackable']) ? (int)$it['stackable'] : 1,
                isset($it['level']) ? (int)$it['level'] : 1,
                $it['equipment_slot'] ?? null,
                $it['icon_name'] ?? null
            ];
        }
    }

    // Upsert items: insert new templates and update existing ones by template_key
    $selectStmt = $db->prepare('SELECT item_id FROM items WHERE template_key = ?');
    $insertStmt = $db->prepare('INSERT INTO items (template_key, name, type, description, stats, rarity, stackable, level, equipment_slot, icon_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $updateStmt = $db->prepare('UPDATE items SET name = ?, type = ?, description = ?, stats = ?, rarity = ?, stackable = ?, level = ?, equipment_slot = ?, icon_name = ? WHERE template_key = ?');

    $inserted = 0;
    $updated = 0;
    foreach ($items as $item) {
        // $item = [template_key, name, type, description, stats, rarity, stackable, level, equipment_slot, icon_name]
        $template_key = $item[0];
        $selectStmt->execute([$template_key]);
        $exists = $selectStmt->fetchColumn();
        if ($exists === false) {
            $insertStmt->execute($item);
            $inserted++;
        } else {
            // prepare update params: name,type,description,stats,rarity,stackable,level,equipment_slot,icon_name,template_key
            $updateParams = [
                $item[1], $item[2], $item[3], $item[4], $item[5], $item[6], $item[7], $item[8], $item[9], $template_key
            ];
            $updateStmt->execute($updateParams);
            $updated++;
        }
    }

    echo "  - Items processed: inserted={$inserted}, updated={$updated}\n";

    // Paths are provided via api/paths.json (not seeded into DB)

    // Seed starter items for existing players
    $stmt = $db->prepare('SELECT user_id FROM players WHERE user_id NOT IN (SELECT DISTINCT user_id FROM inventory)');
    $stmt->execute();
    $playersWithoutItems = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (count($playersWithoutItems) > 0) {
        // Get item IDs for starter items by template_key
        $getByKey = $db->prepare('SELECT item_id FROM items WHERE template_key = ? LIMIT 1');
        $starterKeys = [
            'health_potion' => null,
            'mana_potion' => null,
            'iron_sword' => null
        ];
        foreach (array_keys($starterKeys) as $k) {
            $getByKey->execute([$k]);
            $starterKeys[$k] = $getByKey->fetchColumn();
            if (!$starterKeys[$k]) {
                error_log("Warning: starter item with template_key={$k} not found in items table");
            }
        }

        $insertInv = $db->prepare('INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?)');
        foreach ($playersWithoutItems as $player) {
            $now = time();
            if ($starterKeys['health_potion']) {
                $insertInv->execute([$player['user_id'], $starterKeys['health_potion'], 5, $now]);
            }
            if ($starterKeys['mana_potion']) {
                $insertInv->execute([$player['user_id'], $starterKeys['mana_potion'], 3, $now]);
            }
            if ($starterKeys['iron_sword']) {
                $insertInv->execute([$player['user_id'], $starterKeys['iron_sword'], 1, $now]);
            }
        }
        echo "  - Seeded starter items for " . count($playersWithoutItems) . " existing players\n";
    }

    echo "Database initialized successfully!\n";
    echo "Database: " . DB_NAME . "@" . DB_HOST . ":" . DB_PORT . "\n";
    echo "\nTables created:\n";
    echo "  - sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity, fingerprint)\n";
    echo "  - players (user_id, username, realm, x, y, health, max_health, mana, max_mana, xp, level, intelligence, dexterity, concentration, strength, constitution, last_active)\n";
    echo "  - territories (territory_id, realm, name, type, health, x, y, owner_realm, owner_players, contested, contested_since)\n";
    echo "  - superbosses (boss_id, name, health, max_health, x, y, last_attacked, respawn_time)\n";
    echo "  - items (item_id, name, type, description, stats, rarity, stackable, equipment_slot)\n";
    echo "  - inventory (inventory_id, user_id, item_id, quantity, acquired_at)\n";
    echo "  - equipment (equipment_id, user_id, head, body, hands, shoulders, legs, weapon_right, weapon_left, ring_right, ring_left, amulet, created_at, updated_at)\n";
    echo "  - server_time (started_at, last_updated, ingame_hour, ingame_minute, tick_seconds)\n";
    echo "  - walkers (walker_id, user_id, positions, current_index, started_at, updated_at, finished_at)\n";
} catch (PDOException $e) {
    echo "Error initializing database: " . $e->getMessage() . "\n";
    exit(1);
}
