#!/usr/bin/env php
<?php
/**
 * Background job: Regenerate health for all territories
 * Runs every 5 seconds to restore health
 */

define('DB_PATH', __DIR__ . '/../database.sqlite');

try {
    $db = new PDO('sqlite:' . DB_PATH);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // --- NEW: mark/unmark contested state based on current health ---
    $now = time();

    // Mark as contested if health dropped below max and wasn't already contested
    $markStmt = $db->prepare('UPDATE territories SET contested = 1, contested_since = ? WHERE health < max_health AND contested = 0');
    $markStmt->execute([$now]);
    $markedCount = $markStmt->rowCount();

    // Clear contested flag when territory is fully healed
    $clearStmt = $db->prepare('UPDATE territories SET contested = 0, contested_since = NULL WHERE health >= max_health AND contested = 1');
    $clearStmt->execute();
    $clearedCount = $clearStmt->rowCount();

    if ($markedCount || $clearedCount) {
        $ts = date('Y-m-d H:i:s', $now);
        echo "[{$ts}] Contested state updated. Marked: {$markedCount}, Cleared: {$clearedCount}\n";
    }
    // --- end new logic ---

    // Health regeneration rates per 5 seconds (adjusted from per-minute rates)
    $regenRates = [
        'fort' => 42,       // Forts regenerate ~500 health per minute (42 per 5s)
        'castle' => 83,     // Castles regenerate ~1000 health per minute (83 per 5s)
        'wall' => 167       // Walls regenerate ~2000 health per minute (167 per 5s)
    ];

    // Get all territories
    $stmt = $db->query('SELECT territory_id, type, health, max_health, contested FROM territories');
    $territories = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $updateStmt = $db->prepare('UPDATE territories SET health = ? WHERE territory_id = ?');

    $updated = 0;
    foreach ($territories as $territory) {
        // Only regenerate if not at max health and not contested
        if ($territory['contested'] == 0 && $territory['health'] < $territory['max_health']) {
            $newHealth = min(
                $territory['health'] + $regenRates[$territory['type']],
                $territory['max_health']
            );
            
            $updateStmt->execute([$newHealth, $territory['territory_id']]);
            $updated++;
        }
    }

    $timestamp = date('Y-m-d H:i:s');
    echo "[{$timestamp}] Health regeneration complete. Updated {$updated} territories.\n";

    // Regenerate player health
    $stmt = $db->query('SELECT user_id, health, max_health FROM players WHERE health > 0 AND health < max_health');
    $players = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $updateStmt = $db->prepare('UPDATE players SET health = ? WHERE user_id = ?');
    $playersUpdated = 0;

    foreach ($players as $player) {
        $newHealth = min($player['health'] + 8, $player['max_health']); // Players regen ~100 HP/min (8 per 5s)
        $updateStmt->execute([$newHealth, $player['user_id']]);
        $playersUpdated++;
    }

    if ($playersUpdated > 0) {
        echo "[{$timestamp}] Player health regeneration complete. Updated {$playersUpdated} players.\n";
    }

    // Regenerate player mana
    $stmt = $db->query('SELECT user_id, mana, max_mana FROM players WHERE mana > 0 AND mana < max_mana');
    $players = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $updateStmt = $db->prepare('UPDATE players SET mana = ? WHERE user_id = ?');
    $manaUpdated = 0;

    foreach ($players as $player) {
        $newMana = min($player['mana'] + 4, $player['max_mana']); // Players regen ~50 mana/min (4 per 5s)
        $updateStmt->execute([$newMana, $player['user_id']]);
        $manaUpdated++;
    }

    if ($manaUpdated > 0) {
        echo "[{$timestamp}] Player mana regeneration complete. Updated {$manaUpdated} players.\n";
    }

    // Regenerate superboss health
    $stmt = $db->query('SELECT boss_id, health, max_health FROM superbosses WHERE health > 0 AND health < max_health');
    $bosses = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $updateStmt = $db->prepare('UPDATE superbosses SET health = ? WHERE boss_id = ?');
    $bossesUpdated = 0;

    foreach ($bosses as $boss) {
        $newHealth = min($boss['health'] + 417, $boss['max_health']); // Superbosses regen ~5000 HP/min (417 per 5s)
        $updateStmt->execute([$newHealth, $boss['boss_id']]);
        $bossesUpdated++;
    }

    if ($bossesUpdated > 0) {
        echo "[{$timestamp}] Superboss health regeneration complete. Updated {$bossesUpdated} bosses.\n";
    }

} catch (Exception $e) {
    $timestamp = date('Y-m-d H:i:s');
    echo "[{$timestamp}] Error regenerating health: " . $e->getMessage() . "\n";
    exit(1);
}
