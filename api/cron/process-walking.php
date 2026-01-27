<?php
// CLI worker to advance active walkers by one step per tick.
// Usage:
//   php process-walking.php            # run a single tick
//   php process-walking.php --daemon   # run continuously, sleeping 2s between ticks

declare(ticks=1);

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This script is intended to be run from CLI only.\n");
    exit(1);
}

$daemon = in_array('--daemon', $argv, true);

// Config
define('DB_PATH', __DIR__ . '/../database.sqlite');
$tickSeconds = 2;

function getDB() {
    static $db = null;
    if ($db === null) {
        $db = new PDO('sqlite:' . DB_PATH);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }
    return $db;
}

function processOnce() {
    $db = getDB();
    $now = time();

    // Fetch active walkers
    $stmt = $db->prepare('SELECT walker_id, user_id, positions, current_index FROM walkers');
    $stmt->execute();
    $walkers = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($walkers)) {
        echo "No active walkers.\n";
        return;
    }

    $updatePlayerStmt = $db->prepare('UPDATE players SET x = ?, y = ?, last_active = ? WHERE user_id = ?');
    $updateWalkerStmt = $db->prepare('UPDATE walkers SET current_index = ?, updated_at = ? WHERE walker_id = ?');
    $deleteWalkerStmt = $db->prepare('DELETE FROM walkers WHERE walker_id = ?');

    foreach ($walkers as $w) {
        $walkerId = $w['walker_id'];
        $userId = $w['user_id'];
        $positions = json_decode($w['positions'], true);
        $current = (int)$w['current_index'];

        if (!is_array($positions) || count($positions) === 0) {
            // nothing to do, remove
            $deleteWalkerStmt->execute([$walkerId]);
            echo "Walker {$walkerId} had no positions — removed.\n";
            continue;
        }

        $nextIndex = $current + 1;
        if ($nextIndex >= count($positions)) {
            // finish: move player to final position and remove walker
            $final = $positions[count($positions)-1];
            $x = (int)$final[0]; $y = (int)$final[1];
            $db->beginTransaction();
            try {
                $updatePlayerStmt->execute([$x, $y, $now, $userId]);
                $deleteWalkerStmt->execute([$walkerId]);
                $db->commit();
                echo "Walker {$walkerId} completed for user {$userId}.\n";
            } catch (Exception $e) {
                $db->rollBack();
                fwrite(STDERR, "Failed to finalize walker {$walkerId}: " . $e->getMessage() . "\n");
            }
            continue;
        }

        $pos = $positions[$nextIndex];
        $x = (int)$pos[0]; $y = (int)$pos[1];

        $db->beginTransaction();
        try {
            $updatePlayerStmt->execute([$x, $y, $now, $userId]);
            $updateWalkerStmt->execute([$nextIndex, $now, $walkerId]);
            $db->commit();
            echo "Walker {$walkerId} advanced to index {$nextIndex} for user {$userId} ({$x},{$y}).\n";
        } catch (Exception $e) {
            $db->rollBack();
            fwrite(STDERR, "Failed to advance walker {$walkerId}: " . $e->getMessage() . "\n");
        }
    }
}

// Main loop
do {
    processOnce();
    if ($daemon) {
        sleep($tickSeconds);
    }
} while ($daemon);

exit(0);
