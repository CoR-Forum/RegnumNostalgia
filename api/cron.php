<?php
// cron.php: continuously calculate player levels from xp and write to DB
// Run this as a long-running process (supervisor/systemd) or via cron wrapper.

define('DB_HOST', getenv('GAME_DB_HOST') ?: 'db');
define('DB_PORT', getenv('GAME_DB_PORT') ?: 3306);
define('DB_NAME', getenv('GAME_DB_NAME') ?: 'regnum_nostalgia');
define('DB_USER', getenv('GAME_DB_USER') ?: 'regnum_user');
define('DB_PASS', getenv('GAME_DB_PASS') ?: 'regnum_pass');
define('LEVELS_PATH', __DIR__ . '/levels.json');

function loadLevels() {
    static $levels = null;
    if ($levels === null) {
        if (!is_readable(LEVELS_PATH)) return [[ 'level' => 1, 'xp' => 0 ]];
        $data = json_decode(file_get_contents(LEVELS_PATH), true);
        if (!is_array($data) || count($data) === 0) return [[ 'level' => 1, 'xp' => 0 ]];
        usort($data, function($a,$b){ return ($a['xp'] ?? 0) <=> ($b['xp'] ?? 0); });
        $levels = $data;
    }
    return $levels;
}

function xpToLevelValue($xp, $levels) {
    $xp = (int)$xp;
    $lvl = 1;
    foreach ($levels as $l) {
        $threshold = isset($l['xp']) ? (int)$l['xp'] : 0;
        $levelNum = isset($l['level']) ? (int)$l['level'] : $lvl;
        if ($xp >= $threshold) {
            $lvl = $levelNum;
        } else {
            break;
        }
    }
    return $lvl;
}

try {
    $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $db = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "Failed to open DB: " . $e->getMessage() . "\n");
    exit(1);
}

$levels = loadLevels();
if (!$levels) $levels = [[ 'level' => 1, 'xp' => 0 ]];

// Prepared statements
$sel = $db->prepare('SELECT user_id, xp, level FROM players');
$upd = $db->prepare('UPDATE players SET level = ? WHERE user_id = ?');

fwrite(STDOUT, "Level cron started: updating player levels every 10s\n");

while (true) {
    try {
        $sel->execute();
        $rows = $sel->fetchAll(PDO::FETCH_ASSOC);
        if ($rows) {
            $db->beginTransaction();
            foreach ($rows as $r) {
                $uid = $r['user_id'];
                $xp = isset($r['xp']) ? (int)$r['xp'] : 0;
                $current = isset($r['level']) ? (int)$r['level'] : 1;
                $computed = xpToLevelValue($xp, $levels);
                if ($computed !== $current) {
                    $upd->execute([$computed, $uid]);
                }
            }
            $db->commit();
        }
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        fwrite(STDERR, "Level cron error: " . $e->getMessage() . "\n");
    }

    // reload levels file in case it changed
    $levels = loadLevels();

    // Sleep 10 seconds before next run
    sleep(5);
}
