#!/usr/bin/env php
<?php
/**
 * Cron job: Regenerate health for all territories
 * Runs every minute to restore health
 */

define('DB_PATH', __DIR__ . '/../database.sqlite');

try {
    $db = new PDO('sqlite:' . DB_PATH);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Health regeneration rates per minute
    $regenRates = [
        'fort' => 500,      // Forts regenerate 500 health per minute
        'castle' => 1000,   // Castles regenerate 1000 health per minute
        'wall' => 2000      // Walls regenerate 2000 health per minute
    ];

    // Max health by type
    $maxHealth = [
        'fort' => 100000,
        'castle' => 250000,
        'wall' => 500000
    ];

    // Get all territories
    $stmt = $db->query('SELECT territory_id, type, health, contested FROM territories');
    $territories = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $updateStmt = $db->prepare('UPDATE territories SET health = ? WHERE territory_id = ?');

    $updated = 0;
    foreach ($territories as $territory) {
        // Only regenerate if not at max health and not contested
        if ($territory['contested'] == 0 && $territory['health'] < $maxHealth[$territory['type']]) {
            $newHealth = min(
                $territory['health'] + $regenRates[$territory['type']],
                $maxHealth[$territory['type']]
            );
            
            $updateStmt->execute([$newHealth, $territory['territory_id']]);
            $updated++;
        }
    }

    $timestamp = date('Y-m-d H:i:s');
    echo "[{$timestamp}] Health regeneration complete. Updated {$updated} territories.\n";

} catch (Exception $e) {
    $timestamp = date('Y-m-d H:i:s');
    echo "[{$timestamp}] Error regenerating health: " . $e->getMessage() . "\n";
    exit(1);
}
