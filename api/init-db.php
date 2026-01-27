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
            last_activity INTEGER NOT NULL
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
            last_active INTEGER NOT NULL
        )
    ');

    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_last_active ON players(last_active)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_players_realm ON players(realm)');

    // Create territories table (forts and castles)
    $db->exec('
        CREATE TABLE IF NOT EXISTS territories (
            territory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            realm TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            health INTEGER NOT NULL DEFAULT 100,
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

    // Seed territories with forts, castles, and walls
    $territories = [
        // Syrtis
        ['syrtis', 'Algaros Fort', 'fort', 1742, 3200, 'syrtis', 100000],
        ['syrtis', 'Herbret Fort', 'fort', 2896, 3237, 'syrtis', 100000],
        ['syrtis', 'Eferias Castle', 'castle', 3757, 4717, 'syrtis', 250000],
        ['syrtis', 'Syrtis Realm Wall', 'wall', 2357, 4037, 'syrtis', 500000],
        // Ignis
        ['ignis', 'Menirah Fort', 'fort', 3379, 1689, 'ignis', 100000],
        ['ignis', 'Samal Fort', 'fort', 3684, 2432, 'ignis', 100000],
        ['ignis', 'Shaanarid Castle', 'castle', 4608, 2974, 'ignis', 250000],
        ['ignis', 'Ignis Realm Wall', 'wall', 4148, 1966, 'ignis', 500000],
        // Alsius
        ['alsius', 'Trelleborg Fort', 'fort', 1640, 2441, 'alsius', 100000],
        ['alsius', 'Aggersborg Fort', 'fort', 2729, 2415, 'alsius', 100000],
        ['alsius', 'Imperia Castle', 'castle', 2802, 1103, 'alsius', 250000],
        ['alsius', 'Alsius Realm Wall', 'wall', 1755, 2106, 'alsius', 500000],
    ];

    $stmt = $db->prepare('SELECT COUNT(*) FROM territories');
    $stmt->execute();
    $count = $stmt->fetchColumn();

    if ($count == 0) {
        $stmt = $db->prepare('INSERT INTO territories (realm, name, type, x, y, owner_realm, health) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach ($territories as $territory) {
            $stmt->execute($territory);
        }
        echo "  - Seeded " . count($territories) . " territories (forts, castles, and walls)\n";
    }

    echo "Database initialized successfully!\n";
    echo "Database location: " . DB_PATH . "\n";
    echo "\nTables created:\n";
    echo "  - sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity)\n";
    echo "  - players (user_id, username, realm, x, y, last_active)\n";
    echo "  - territories (territory_id, realm, name, type, health, x, y, owner_realm, owner_players, contested, contested_since)\n";
} catch (PDOException $e) {
    echo "Error initializing database: " . $e->getMessage() . "\n";
    exit(1);
}
