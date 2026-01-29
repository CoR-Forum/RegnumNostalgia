#!/usr/bin/env php
<?php
// Update territories from external warstatus JSON
date_default_timezone_set('UTC');

$apiUrl = 'https://cort.thebus.top/api/var/warstatus.json';
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

    // Fetch JSON via cURL
    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    $resp = curl_exec($ch);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno || $http_code !== 200 || !$resp) {
        fwrite(STDERR, "Failed fetching warstatus: http={$http_code} curl_err={$err}\n");
        exit(1);
    }

    $data = json_decode($resp, true);
    if (!is_array($data) || !isset($data['forts'])) {
        fwrite(STDERR, "Invalid warstatus response\n");
        exit(1);
    }

    $selectStmt = $db->prepare('SELECT owner_realm FROM territories WHERE territory_id = ?');
    $updateStmt = $db->prepare('UPDATE territories SET owner_realm = ? WHERE territory_id = ?');
    $insertCapture = $db->prepare('INSERT INTO territory_captures (territory_id, previous_realm, new_realm, captured_at) VALUES (?, ?, ?, ?)');

    // Use a transaction so captures and territory updates stay consistent
    $db->beginTransaction();

    $updated = 0;
    foreach ($data['forts'] as $fort) {
        if (!isset($fort['name']) || !isset($fort['owner'])) {
            continue;
        }
        $name = $fort['name'];
        $owner = trim($fort['owner']);

        // Extract territory_id from the name's trailing parentheses e.g. "Imperia Castle (1)"
        // Prefer a trailing numeric parenthesis, otherwise pick the last numeric parenthesis found.
        $tid = null;
        if (preg_match('/\((\d+)\)\s*$/', $name, $m)) {
            $tid = (int)$m[1];
        } else {
            if (preg_match_all('/\((\d+)\)/', $name, $matches)) {
                $last = end($matches[1]);
                $tid = (int)$last;
            }
        }

        if (!$tid) {
            continue;
        }

        // API owner should be written into the `realm` column (lowercased)
        $realm = strtolower($owner);

        // Ignore empty owners
        if ($realm === '') {
            continue;
        }

        // Fetch previous realm for this territory
        $selectStmt->execute([$tid]);
        $prev = $selectStmt->fetchColumn();
        $prevRealm = ($prev === false || $prev === '') ? null : strtolower($prev);

        // If owner changed, record capture event
        if ($prevRealm !== null && $prevRealm !== $realm) {
            $insertCapture->execute([$tid, $prevRealm, $realm, time()]);
        }

        $updateStmt->execute([$realm, $tid]);
        $updated += $updateStmt->rowCount();
    }

    // Ensure territories.realm matches the most recent capture (if any)
    $syncSql = "UPDATE territories SET owner_realm = (
        SELECT LOWER(new_realm) FROM territory_captures
        WHERE territory_captures.territory_id = territories.territory_id
        ORDER BY captured_at DESC, capture_id DESC LIMIT 1
    ) WHERE EXISTS (SELECT 1 FROM territory_captures WHERE territory_captures.territory_id = territories.territory_id)";
    $synced = $db->exec($syncSql);
    if ($synced !== false) {
        $updated += $synced;
    }

    $db->commit();

    fwrite(STDOUT, "Updated territories: {$updated}\n");

} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, "DB error: " . $e->getMessage() . "\n");
    exit(1);
} catch (Exception $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    fwrite(STDERR, "Error: " . $e->getMessage() . "\n");
    exit(1);
}
