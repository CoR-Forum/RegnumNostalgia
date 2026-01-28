<?php
/**
 * Cron handler to update server in-game time.
 * Mapping: 1 real hour == 24 in-game hours => tick_seconds = 3600 / 24 = 150
 * Designed to be safe to run repeatedly by the cron runner.
 */

define('DB_PATH', dirname(__DIR__) . '/database.sqlite');

try {
    $db = new PDO('sqlite:' . DB_PATH);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

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
