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

    echo "Database initialized successfully!\n";
    echo "Database location: " . DB_PATH . "\n";
    echo "\nTables created:\n";
    echo "  - sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity)\n";
    echo "  - players (user_id, username, realm, x, y, last_active)\n";

} catch (PDOException $e) {
    echo "Error initializing database: " . $e->getMessage() . "\n";
    exit(1);
}
