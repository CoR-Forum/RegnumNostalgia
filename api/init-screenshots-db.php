<?php
/**
 * Initialize Screenshots Database
 * Creates a separate SQLite database for screenshot management
 */

define('SCREENSHOTS_DB_PATH', __DIR__ . '/screenshots.sqlite');

function initScreenshotsDatabase() {
    $db = new PDO('sqlite:' . SCREENSHOTS_DB_PATH);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Create screenshots table
    $db->exec("
        CREATE TABLE IF NOT EXISTS screenshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL UNIQUE,
            name_en TEXT,
            name_de TEXT,
            name_es TEXT,
            description_en TEXT,
            description_de TEXT,
            description_es TEXT,
            location TEXT,
            visible_characters TEXT,
            x INTEGER NOT NULL DEFAULT 0,
            y INTEGER NOT NULL DEFAULT 0,
            uploaded_by TEXT NOT NULL,
            uploaded_at INTEGER NOT NULL,
            updated_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
    ");
    
    // Create indexes for efficient querying
    $db->exec("CREATE INDEX IF NOT EXISTS idx_coordinates ON screenshots(x, y)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_location ON screenshots(location)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_filename ON screenshots(filename)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_uploaded_by ON screenshots(uploaded_by)");
    
    echo "Screenshots database initialized successfully!\n";
    echo "Database location: " . SCREENSHOTS_DB_PATH . "\n";
    
    return $db;
}

// Run if called directly
if (php_sapi_name() === 'cli' && basename(__FILE__) === basename($_SERVER['PHP_SELF'])) {
    initScreenshotsDatabase();
}
