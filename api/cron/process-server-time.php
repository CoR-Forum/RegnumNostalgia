<?php
/**
 * Cron handler to update server in-game time.
 * Mapping: 1 real hour == 24 in-game hours => tick_seconds = 3600 / 24 = 150
 * Designed to be safe to run repeatedly by the cron runner.
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

    // Ensure row exists
    $stmt = $db->prepare('SELECT id, started_at, last_updated, ingame_hour, ingame_minute, tick_seconds FROM server_time WHERE id = 1');
    $stmt->execute();
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    $now = time();

    if (!$row) {
        // Initialize if missing
        $stmt = $db->prepare('INSERT INTO server_time (id, started_at, last_updated, ingame_hour, ingame_minute, tick_seconds) VALUES (1, ?, ?, 0, 0, 150)');
        $stmt->execute([$now, $now]);
        echo "server_time initialized\n";
        exit(0);
    }

    $startedAt = (int)$row['started_at'];
    $tickSeconds = (int)$row['tick_seconds'];
    if ($tickSeconds <= 0) {
        $tickSeconds = 150; // fallback
    }

    $elapsed = $now - $startedAt;
    if ($elapsed < 0) $elapsed = 0;

    // Each tickSeconds represents one in-game hour. Calculate current in-game hour and minute.
    $ingameHoursPassed = floor($elapsed / $tickSeconds);
    $ingameHour = (int)($ingameHoursPassed % 24);

    $withinTick = $elapsed % $tickSeconds;
    $fraction = $withinTick / $tickSeconds;
    $ingameMinute = (int)floor($fraction * 60);

    // Only update DB when values change to minimize writes
    if ($ingameHour !== (int)$row['ingame_hour'] || $ingameMinute !== (int)$row['ingame_minute'] || $now - (int)$row['last_updated'] > 300) {
        $update = $db->prepare('UPDATE server_time SET ingame_hour = ?, ingame_minute = ?, last_updated = ? WHERE id = 1');
        $update->execute([$ingameHour, $ingameMinute, $now]);
        echo "Updated server_time to hour={$ingameHour} minute={$ingameMinute}\n";
    } else {
        echo "No change to server_time (hour={$ingameHour} minute={$ingameMinute})\n";
    }

} catch (PDOException $e) {
    echo "Error updating server_time: " . $e->getMessage() . "\n";
    exit(1);
}
