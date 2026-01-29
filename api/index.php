<?php
header('Content-Type: application/json');
// CORS: use a whitelist from environment variable `CORS_ALLOWED_ORIGINS` (comma-separated).
// If not set, fall back to wildcard for development convenience.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = array_filter(array_map('trim', explode(',', getenv('CORS_ALLOWED_ORIGINS') ?: '')));
if (!empty($allowedOrigins)) {
    if ($origin && in_array($origin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
    }
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Session-Token, X-API-KEY');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Constants
define('DB_HOST', getenv('GAME_DB_HOST') ?: 'db');
define('DB_PORT', getenv('GAME_DB_PORT') ?: 3306);
define('DB_NAME', getenv('GAME_DB_NAME') ?: 'regnum_nostalgia');
define('DB_USER', getenv('GAME_DB_USER') ?: 'regnum_user');
define('DB_PASS', getenv('GAME_DB_PASS') ?: 'regnum_pass');
define('FORUM_API_URL', 'https://cor-forum.de/api.php');
define('FORUM_API_KEY', getenv('COR_FORUM_API_KEY') ?: '');
define('SESSION_DURATION', 86400); // 24 hours

// Screenshots API
define('SCREENSHOTS_API_URL', 'https://cor-forum.de/regnum/RegnumNostalgia/screenshots_api.php');
define('SCREENSHOTS_API_KEY', getenv('SCREENSHOTS_API_KEY') ?: '');

// Forum MySQL connection (used for shoutbox read/write)
define('FORUM_DB_HOST', getenv('COR_FORUM_DB_HOST') ?: 'localhost');
define('FORUM_DB_PORT', getenv('COR_FORUM_DB_PORT') ?: 3306);
define('FORUM_DB_NAME', getenv('COR_FORUM_DB_NAME') ?: 'corforum_database');
define('FORUM_DB_USER', getenv('COR_FORUM_DB_USER') ?: 'corforum_user');
define('FORUM_DB_PASS', getenv('COR_FORUM_DB_PASS') ?: 'corforum_password');

// Spawn coordinates for each realm
define('SPAWN_COORDS', [
    'syrtis' => ['x' => 237, 'y' => 5397],
    'alsius' => ['x' => 1509, 'y' => 377],
    'ignis' => ['x' => 5000, 'y' => 618]
]);

// Database connection
function getDB() {
    static $db = null;
    if ($db === null) {
        try {
            $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
            $db = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
        } catch (PDOException $e) {
            error_log('Database connection failed: ' . $e->getMessage());
            respondError('Database connection failed', 500);
        }
    }
    return $db;
}

// Response helpers
function respondSuccess($data = []) {
    echo json_encode(array_merge(['success' => true], $data));
    exit;
}

function respondError($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

// Generate session token
function generateSessionToken() {
    return bin2hex(random_bytes(32));
}

// Get current timestamp
function now() {
    return time();
}

// Compute a simple session fingerprint from IP and User-Agent
function computeSessionFingerprint() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    // If behind a trusted proxy, you may prefer HTTP_X_FORWARDED_FOR
    $ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
    return hash('sha256', $ip . '|' . $ua);
}

// Load a JSON file from disk and return decoded array or null
function jsonLoadFile($path) {
    if (!is_readable($path)) return null;
    $json = file_get_contents($path);
    $data = json_decode($json, true);
    return is_array($data) ? $data : null;
}

// Load levels definitions from api/gameData/levels.json (caches in memory)
function loadLevels() {
    static $levels = null;
    if ($levels === null) {
        $data = jsonLoadFile(__DIR__ . '/gameData/levels.json');
        if (!is_array($data) || count($data) === 0) {
            $levels = [[ 'level' => 1, 'xp' => 0 ]];
        } else {
            usort($data, function($a, $b) { return ($a['xp'] ?? 0) <=> ($b['xp'] ?? 0); });
            $levels = $data;
        }
    }
    return $levels;
}

// Convert xp to level by finding the highest level whose xp threshold is <= given xp
function xpToLevel($xp) {
    $xp = (int)$xp;
    $levels = loadLevels();
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

// Normalize coordinates array to [[x,y], ...]
function normalizePoints($coords) {
    $norm = [];
    foreach ($coords as $pt) {
        if (is_array($pt) && array_values($pt) === $pt) {
            $x = (int)$pt[0]; $y = (int)$pt[1];
        } else {
            $x = isset($pt['x']) ? (int)$pt['x'] : (int)($pt[0] ?? 0);
            $y = isset($pt['y']) ? (int)$pt['y'] : (int)($pt[1] ?? 0);
        }
        $norm[] = [$x, $y];
    }
    return $norm;
}

// Get current server in-game time. Computes from `server_time` row if present.
function getServerTime() {
    $db = getDB();
    try {
        $stmt = $db->prepare('SELECT started_at, ingame_hour, ingame_minute, tick_seconds FROM server_time WHERE id = 1 LIMIT 1');
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) return ['hour' => 0, 'minute' => 0];

        $startedAt = (int)($row['started_at'] ?? 0);
        $tickSeconds = (int)($row['tick_seconds'] ?? 150);
        if ($tickSeconds <= 0) $tickSeconds = 150;

        $now = time();
        $elapsed = max(0, $now - $startedAt);

        $ingameHoursPassed = floor($elapsed / $tickSeconds);
        $hour = (int)($ingameHoursPassed % 24);
        $withinTick = $elapsed % $tickSeconds;
        $minute = (int)floor(($withinTick / $tickSeconds) * 60);

        return ['hour' => $hour, 'minute' => $minute];
    } catch (Exception $e) {
        return ['hour' => 0, 'minute' => 0];
    }
}

// Map an in-game hour (0-23) to a daytime icon filename available in public/assets/ui-v1
function getDaytimeIcon($hour) {
    $h = (int)$hour;
    if ($h < 0 || $h > 23) $h = 0;

    // Ranges mapped to available icons: dawn, morning, day, afternoon, sunset, dusk, nightfall, night
    if ($h === 5) return '/assets/v1/time/ui-icon-time-dawn.png';
    if ($h >= 6 && $h <= 8) return '/assets/v1/time/ui-icon-time-morning.png';
    if ($h >= 9 && $h <= 11) return '/assets/v1/time/ui-icon-time-day.png';
    if ($h >= 12 && $h <= 16) return '/assets/v1/time/ui-icon-time-afternoon.png';
    if ($h === 17) return '/assets/v1/time/ui-icon-time-sunset.png';
    if ($h === 18) return '/assets/v1/time/ui-icon-time-dusk.png';
    if ($h >= 19 && $h <= 20) return '/assets/v1/time/ui-icon-time-nightfall.png';
    if ($h >= 21 || $h <= 4) return '/assets/v1/time/ui-icon-time-night.png';
    // fallback
    return '/assets/v1/time/ui-icon-time-day.png';
}


// Validate session and return user data
function validateSession() {
    $sessionToken = $_SERVER['HTTP_X_SESSION_TOKEN'] ?? '';
    if (!$sessionToken) {
        respondError('Session token required', 401);
    }

    $db = getDB();
    // Require fingerprint column to be present in sessions table
    $stmt = $db->prepare('SELECT user_id, username, realm, fingerprint FROM sessions WHERE session_id = ? AND expires_at > ?');
    $stmt->execute([$sessionToken, now()]);
    $session = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$session) {
        respondError('Invalid or expired session', 401);
    }

    // Renew session
    $newExpiresAt = now() + SESSION_DURATION;
    $stmt = $db->prepare('UPDATE sessions SET last_activity = ?, expires_at = ? WHERE session_id = ?');
    $stmt->execute([now(), $newExpiresAt, $sessionToken]);

    // Update player last_active
    $stmt = $db->prepare('UPDATE players SET last_active = ? WHERE user_id = ?');
    $stmt->execute([now(), $session['user_id']]);

    // Validate fingerprint if the session row stores one
    $currentFp = computeSessionFingerprint();
    if (isset($session['fingerprint']) && $session['fingerprint'] !== null && $session['fingerprint'] !== '' ) {
        if ($session['fingerprint'] !== $currentFp) {
            respondError('Invalid or expired session', 401);
        }
    }

    return $session;
}

// Router
$requestUri = $_SERVER['REQUEST_URI'];
$requestMethod = $_SERVER['REQUEST_METHOD'];

// Parse URI
$path = parse_url($requestUri, PHP_URL_PATH);
$path = preg_replace('#^/api/?#', '/', $path);

// Routes
if ($path === '/login' && $requestMethod === 'POST') {
    handleLogin();
} elseif ($path === '/realm/select' && $requestMethod === 'POST') {
    handleRealmSelect();
} elseif ($path === '/player/position' && $requestMethod === 'GET') {
    handleGetPosition();
} elseif ($path === '/player/position' && $requestMethod === 'POST') {
    handleUpdatePosition();
} elseif ($path === '/players/online' && $requestMethod === 'GET') {
    handleGetOnlinePlayers();
} elseif ($path === '/territories' && $requestMethod === 'GET') {
    handleGetTerritories();
} elseif ($path === '/superbosses' && $requestMethod === 'GET') {
    handleGetSuperbosses();
} elseif ($path === '/inventory' && $requestMethod === 'GET') {
    handleGetInventory();
} elseif ($path === '/inventory/add' && $requestMethod === 'POST') {
    handleAddInventoryItem();
} elseif ($path === '/inventory/remove' && $requestMethod === 'POST') {
    handleRemoveInventoryItem();
} elseif ($path === '/items' && $requestMethod === 'GET') {
    handleGetItems();
} elseif ($path === '/equipment' && $requestMethod === 'GET') {
    handleGetEquipment();
} elseif ($path === '/equipment/equip' && $requestMethod === 'POST') {
    handleEquipItem();
} elseif ($path === '/equipment/unequip' && $requestMethod === 'POST') {
    handleUnequipItem();
} elseif ($path === '/paths' && $requestMethod === 'GET') {
    handleGetPaths();
} elseif ($path === '/paths/get' && $requestMethod === 'GET') {
    handleGetPath();
} elseif ($path === '/regions' && $requestMethod === 'GET') {
    handleGetRegions();
} elseif ($path === '/player/move' && $requestMethod === 'POST') {
    handleStartMove();
} elseif ($path === '/shoutbox' && $requestMethod === 'GET') {
    handleGetShoutbox();
} elseif ($path === '/shoutbox' && $requestMethod === 'POST') {
    handlePostShoutbox();
} elseif ($path === '/screenshots' && $requestMethod === 'GET') {
    handleGetScreenshots();
} elseif ($path === '/screenshots' && $requestMethod === 'POST') {
    handleAddScreenshot();
} elseif (preg_match('#^/screenshots/(\d+)$#', $path, $matches) && $requestMethod === 'PUT') {
    handleUpdateScreenshot($matches[1]);
} elseif (preg_match('#^/screenshots/(\d+)$#', $path, $matches) && $requestMethod === 'DELETE') {
    handleDeleteScreenshot($matches[1]);
} else {
    respondError('Endpoint not found', 404);
}

/* ================================================================
    LOGIN ENDPOINT
================================================================ */
function handleLogin() {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    if (!$username || !$password) {
        respondError('Username and password are required');
    }

    // Call cor-forum.de API
    $ch = curl_init(FORUM_API_URL . '/login');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query(['username' => $username, 'password' => $password]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['X-API-KEY: ' . FORUM_API_KEY],
        CURLOPT_TIMEOUT => 10
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || !$response) {
        respondError('Failed to connect to forum API', 500);
    }

    $data = json_decode($response, true);
    if (!$data || !$data['success']) {
        respondError($data['error'] ?? 'Invalid credentials');
    }

    $userId = $data['userID'];
    $username = $data['username'];
    
    // Verify forum account activation: require membership in groupID = 3
    try {
        $fdb = getForumDbConnection();
        $stmt = $fdb->prepare('SELECT COUNT(*) AS cnt FROM wcf1_user_to_group WHERE userID = ? AND groupID = ?');
        if (!$stmt) { $err = $fdb->error; $fdb->close(); respondError('Forum DB query failed: ' . $err, 500); }
        $requiredGroup = 3;
        $stmt->bind_param('ii', $userId, $requiredGroup);
        $stmt->execute();
        $res = $stmt->get_result();
        $row = $res ? $res->fetch_assoc() : null;
        $stmt->close();
        $fdb->close();
        if (!$row || intval($row['cnt']) === 0) {
            respondError('Your cor-forum.de account is not activated. Please check your email for the activation link.', 403);
        }
    } catch (Exception $e) {
        respondError('Failed to validate forum account', 500);
    }
    // Check if the forum user is banned (banned != 0)
    try {
        $fdb = getForumDbConnection();
        $stmt = $fdb->prepare('SELECT banned FROM wcf1_user WHERE userID = ? LIMIT 1');
        if (!$stmt) { $err = $fdb->error; $fdb->close(); respondError('Forum DB query failed: ' . $err, 500); }
        $stmt->bind_param('i', $userId);
        $stmt->execute();
        $res = $stmt->get_result();
        $userRow = $res ? $res->fetch_assoc() : null;
        $stmt->close();
        $fdb->close();
        if ($userRow && isset($userRow['banned']) && intval($userRow['banned']) !== 0) {
            respondError('Your cor-forum.de account is banned', 403);
        }
    } catch (Exception $e) {
        respondError('Failed to validate forum account', 500);
    }
    // Create or update session
    $db = getDB();
    $sessionToken = generateSessionToken();
    $expiresAt = now() + SESSION_DURATION;
    $fingerprint = computeSessionFingerprint();

    // Check if user exists
    $stmt = $db->prepare('SELECT user_id, realm FROM players WHERE user_id = ?');
    $stmt->execute([$userId]);
    $player = $stmt->fetch(PDO::FETCH_ASSOC);

    $realm = $player ? $player['realm'] : null;

    // Delete old sessions for this user
    $stmt = $db->prepare('DELETE FROM sessions WHERE user_id = ?');
    $stmt->execute([$userId]);

    // Create new session with fingerprint (fingerprint column is required)
    $stmt = $db->prepare('INSERT INTO sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([$sessionToken, $userId, $username, $realm, now(), $expiresAt, now(), $fingerprint]);

    respondSuccess([
        'sessionToken' => $sessionToken,
        'userId' => $userId,
        'username' => $username,
        'realm' => $realm,
        'needsRealmSelection' => $realm === null
    ]);
}

/* ================================================================
    REALM SELECTION ENDPOINT
================================================================ */
function handleRealmSelect() {
    $session = validateSession();
    $realm = strtolower(trim($_POST['realm'] ?? ''));

    if (!in_array($realm, ['syrtis', 'alsius', 'ignis'])) {
        respondError('Invalid realm. Must be: syrtis, alsius, or ignis');
    }

    $db = getDB();

    // Check if player already has a realm
    $stmt = $db->prepare('SELECT realm FROM players WHERE user_id = ?');
    $stmt->execute([$session['user_id']]);
    $existingPlayer = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($existingPlayer && $existingPlayer['realm'] !== null) {
        respondError('Realm already selected and cannot be changed');
    }

    // Get spawn coordinates
    $spawnX = SPAWN_COORDS[$realm]['x'];
    $spawnY = SPAWN_COORDS[$realm]['y'];

    // Insert or update player
    if ($existingPlayer) {
        $stmt = $db->prepare('UPDATE players SET realm = ?, x = ?, y = ?, health = ?, max_health = ?, mana = ?, max_mana = ?, last_active = ? WHERE user_id = ?');
        $stmt->execute([$realm, $spawnX, $spawnY, 400, 600, 150, 200, now(), $session['user_id']]);
    } else {
        $stmt = $db->prepare('INSERT INTO players (user_id, username, realm, x, y, health, max_health, mana, max_mana, last_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$session['user_id'], $session['username'], $realm, $spawnX, $spawnY, 400, 600, 150, 200, now()]);
    }

    // Give starter items if player doesn't have any
    $stmt = $db->prepare('SELECT COUNT(*) FROM inventory WHERE user_id = ?');
    $stmt->execute([$session['user_id']]);
    $itemCount = $stmt->fetchColumn();

    if ($itemCount == 0) {
        // Give the new player a specific starter set by template_key
        $starterItems = [
            ['template_key' => 'gold_coin', 'quantity' => 50],
            ['template_key' => 'iron_sword', 'quantity' => 1],
            ['template_key' => 'wooden_shield', 'quantity' => 1],
            ['template_key' => 'leather_cap', 'quantity' => 1],
            ['template_key' => 'alasthor_amulet', 'quantity' => 1]
        ];

        // Look up item_id and equipment_slot by template_key
        $find = $db->prepare('SELECT item_id, equipment_slot, name FROM items WHERE template_key = ? LIMIT 1');
        $ins = $db->prepare('INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?)');
        $now = now();
        $starterInventoryIds = [];
        $starterEquipmentSlots = [];

        foreach ($starterItems as $entry) {
            $find->execute([$entry['template_key']]);
            $row = $find->fetch(PDO::FETCH_ASSOC);
            if ($row && isset($row['item_id'])) {
                $ins->execute([$session['user_id'], (int)$row['item_id'], (int)$entry['quantity'], $now]);
                $starterInventoryIds[$entry['template_key']] = (int)$db->lastInsertId();
                $starterEquipmentSlots[$entry['template_key']] = $row['equipment_slot'];
            }
        }

        // Auto-equip starter items if present (use equipment_slot from items table)
        $equip = ensureEquipmentRow($db, $session['user_id']);
        $equip['updated_at'] = now();
        foreach ($starterInventoryIds as $tkey => $invId) {
            $slot = $starterEquipmentSlots[$tkey] ?? null;
            if ($slot && array_key_exists($slot, $equip) && $invId) {
                $equip[$slot] = $invId;
            }
        }
        updateEquipmentDB($db, $equip);
    }

    // Update session realm
    $stmt = $db->prepare('UPDATE sessions SET realm = ? WHERE user_id = ?');
    $stmt->execute([$realm, $session['user_id']]);

    respondSuccess([
        'realm' => $realm,
        'position' => ['x' => $spawnX, 'y' => $spawnY]
    ]);
}

/* ================================================================
    GET PLAYER POSITION (includes active walker/destination if present)
================================================================ */

// Include walker/destination info in position responses
function handleGetPosition() {
    $session = validateSession();

    if ($session['realm'] === null) {
        respondError('Realm not selected');
    }

    $db = getDB();
    $stmt = $db->prepare('SELECT username, x, y, realm, health, max_health, mana, max_mana, xp, level, intelligence, dexterity, concentration, strength, constitution FROM players WHERE user_id = ?');
    $stmt->execute([$session['user_id']]);
    $player = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$player) {
        respondError('Player not found', 404);
    }

    // Fetch most recent active walker for this user (if any)
    $walker = null;
    $stmt = $db->prepare("SELECT positions, current_index FROM walkers WHERE user_id = ? AND status IN ('new','walking') ORDER BY started_at DESC LIMIT 1");
    $stmt->execute([$session['user_id']]);
    $w = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($w) {
        $positions = json_decode($w['positions'], true);
        if (is_array($positions) && count($positions) > 0) {
            $last = $positions[count($positions)-1];
            // ensure [x,y]
            $dest = [ (int)$last[0], (int)$last[1] ];
            // normalize positions to integer pairs
            $norm = [];
            foreach ($positions as $pp) {
                $nx = isset($pp[0]) ? (int)$pp[0] : 0;
                $ny = isset($pp[1]) ? (int)$pp[1] : 0;
                $norm[] = [$nx, $ny];
            }
            $walker = [ 'currentIndex' => (int)$w['current_index'], 'destination' => $dest, 'steps' => count($positions), 'positions' => $norm ];
        }
    }

    $xpVal = isset($player['xp']) ? (int)$player['xp'] : 0;
    $levels = loadLevels();
    $nextXp = null;
    foreach ($levels as $l) {
        $threshold = isset($l['xp']) ? (int)$l['xp'] : 0;
        if ($threshold > $xpVal) { $nextXp = $threshold; break; }
    }
    $xpToNext = $nextXp !== null ? ($nextXp - $xpVal) : 0;

    // compute damage and armor from base stats + equipped items
    $strength = isset($player['strength']) ? (int)$player['strength'] : 20;
    $intelligence = isset($player['intelligence']) ? (int)$player['intelligence'] : 20;
    $constitution = isset($player['constitution']) ? (int)$player['constitution'] : 20;
    $dexterity = isset($player['dexterity']) ? (int)$player['dexterity'] : 20;

    // gather equipped items and sum their `damage` and `armor` stats (if present)
    $equip = ensureEquipmentRow($db, $session['user_id']);
    $slots = getEquipmentSlots();
    $itemDamage = 0;
    $itemArmor = 0;
    foreach ($slots as $s) {
        $invId = $equip[$s] ?? null;
        if ($invId) {
            $it = fetchEquippedItemDetails($db, $invId);
            if ($it && isset($it['stats']) && is_array($it['stats'])) {
                // prefer explicit `damage`/`armor` keys inside item stats
                $itemDamage += isset($it['stats']['damage']) ? (int)$it['stats']['damage'] : 0;
                $itemArmor += isset($it['stats']['armor']) ? (int)$it['stats']['armor'] : 0;
            }
        }
    }

    // simple formulas: base contributions from attributes + item bonuses
    $baseDamage = (int)floor($strength * 0.5 + $intelligence * 0.3);
    $baseArmor = (int)floor($constitution * 0.5 + $dexterity * 0.3);

    $computedDamage = $baseDamage + $itemDamage;
    $computedArmor = $baseArmor + $itemArmor;

    $resp = [
        'username' => isset($player['username']) ? $player['username'] : null,
        'position' => [ 'x' => (int)$player['x'], 'y' => (int)$player['y'] ],
        'realm' => $player['realm'],
        'health' => (int)$player['health'],
        'maxHealth' => (int)$player['max_health'],
        'mana' => (int)$player['mana'],
        'maxMana' => (int)$player['max_mana'],
        'damage' => $computedDamage,
        'armor' => $computedArmor,
        'xp' => $xpVal,
        'level' => isset($player['level']) ? (int)$player['level'] : xpToLevel($xpVal),
        'xpToNext' => $xpToNext,
        'stats' => [
            'intelligence' => isset($player['intelligence']) ? (int)$player['intelligence'] : 20,
            'dexterity' => isset($player['dexterity']) ? (int)$player['dexterity'] : 20,
            'concentration' => isset($player['concentration']) ? (int)$player['concentration'] : 20,
            'strength' => isset($player['strength']) ? (int)$player['strength'] : 20,
            'constitution' => isset($player['constitution']) ? (int)$player['constitution'] : 20,
        ]
    ];

    if ($walker) $resp['walker'] = $walker;

    // Add current server in-game time and a daytime icon for the client
    $st = getServerTime();
    $resp['serverTime'] = ['hour' => (int)$st['hour'], 'minute' => (int)$st['minute']];
    $resp['daytimeIcon'] = getDaytimeIcon((int)$st['hour']);

    respondSuccess($resp);
}

/* ================================================================
    UPDATE PLAYER POSITION
================================================================ */
function handleUpdatePosition() {
    $session = validateSession();

    if ($session['realm'] === null) {
        respondError('Realm not selected');
    }

    $x = isset($_POST['x']) ? (int)$_POST['x'] : null;
    $y = isset($_POST['y']) ? (int)$_POST['y'] : null;

    if ($x === null || $y === null) {
        respondError('X and Y coordinates are required');
    }

    // Validate coordinates within map bounds (0-6144)
    if ($x < 0 || $x > 6144 || $y < 0 || $y > 6144) {
        respondError('Coordinates out of bounds (0-6144)');
    }

    $db = getDB();
    $stmt = $db->prepare('UPDATE players SET x = ?, y = ?, last_active = ? WHERE user_id = ?');
    $stmt->execute([$x, $y, now(), $session['user_id']]);

    respondSuccess([
        'position' => ['x' => $x, 'y' => $y]
    ]);
}

/* ================================================================
    GET ONLINE PLAYERS
================================================================ */
function handleGetOnlinePlayers() {
    $session = validateSession();

    $db = getDB();
    // Get players active within last 5 seconds
    $stmt = $db->prepare('SELECT user_id, username, realm, x, y, health, max_health, mana, max_mana, xp, level, intelligence, dexterity, concentration, strength, constitution, last_active FROM players WHERE last_active > ?');
    $stmt->execute([now() - 5]);
    $players = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = [];
    foreach ($players as $player) {
        $pxp = isset($player['xp']) ? (int)$player['xp'] : 0;
        $plevel = isset($player['level']) ? (int)$player['level'] : xpToLevel($pxp);
        $result[] = [
            'userId' => (int)$player['user_id'],
            'username' => $player['username'],
            'realm' => $player['realm'],
            'x' => (int)$player['x'],
            'y' => (int)$player['y'],
            'health' => (int)$player['health'],
            'maxHealth' => (int)$player['max_health'],
            'xp' => $pxp,
            'level' => $plevel,
            'stats' => [
                'intelligence' => isset($player['intelligence']) ? (int)$player['intelligence'] : 20,
                'dexterity' => isset($player['dexterity']) ? (int)$player['dexterity'] : 20,
                'concentration' => isset($player['concentration']) ? (int)$player['concentration'] : 20,
                'strength' => isset($player['strength']) ? (int)$player['strength'] : 20,
                'constitution' => isset($player['constitution']) ? (int)$player['constitution'] : 20,
            ],
            'lastActive' => (int)$player['last_active']
        ];
    }

    respondSuccess(['players' => $result]);
}

/* ================================================================
    GET TERRITORIES
================================================================ */
function handleGetTerritories() {
    $session = validateSession();

    $db = getDB();
    $stmt = $db->prepare('SELECT territory_id, realm, name, type, health, max_health, x, y, owner_realm, owner_players, contested, contested_since, icon_name, icon_name_contested FROM territories');
    $stmt->execute();
    $territories = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = [];
    foreach ($territories as $territory) {
        $result[] = [
            'territoryId' => (int)$territory['territory_id'],
            'realm' => $territory['realm'],
            'name' => $territory['name'],
            'type' => $territory['type'],
            'health' => (int)$territory['health'],
            'maxHealth' => (int)$territory['max_health'],
            'x' => (int)$territory['x'],
            'y' => (int)$territory['y'],
            'ownerRealm' => $territory['owner_realm'],
            'ownerPlayers' => $territory['owner_players'],
            'contested' => (bool)$territory['contested'],
            'contestedSince' => $territory['contested_since'] ? (int)$territory['contested_since'] : null,
            'iconName' => $territory['icon_name'] ?? null,
            'iconNameContested' => $territory['icon_name_contested'] ?? null,
            'iconUrl' => ($territory['icon_name'] ?? null) ? '/assets/markers/' . $territory['icon_name'] : null,
            'iconUrlContested' => ($territory['icon_name_contested'] ?? null) ? '/assets/markers/' . $territory['icon_name_contested'] : null
        ];
    }

    respondSuccess(['territories' => $result]);
}
/* ================================================================
    GET SUPERBOSSES
================================================================ */
function handleGetSuperbosses() {
    $session = validateSession();

    $db = getDB();
    $stmt = $db->prepare('SELECT boss_id, name, icon_name, health, max_health, x, y, last_attacked, respawn_time FROM superbosses WHERE health > 0');
    $stmt->execute();
    $bosses = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = [];
    foreach ($bosses as $boss) {
        $result[] = [
            'bossId' => (int)$boss['boss_id'],
            'name' => $boss['name'],
            'health' => (int)$boss['health'],
            'maxHealth' => (int)$boss['max_health'],
            'x' => (int)$boss['x'],
            'y' => (int)$boss['y'],
            'iconName' => $boss['icon_name'] ?? null,
            'iconUrl' => ($boss['icon_name'] ?? null) ? '/assets/markers/' . $boss['icon_name'] : null,
            'lastAttacked' => $boss['last_attacked'] ? (int)$boss['last_attacked'] : null,
            'respawnTime' => $boss['respawn_time'] ? (int)$boss['respawn_time'] : null
        ];
    }

    respondSuccess(['superbosses' => $result]);
}

/* ================================================================
    PATHS (named paths of positions)
================================================================ */
function handleGetPaths() {
    $session = validateSession();
    $pathsFile = __DIR__ . '/gameData/paths.json';
    if (!is_readable($pathsFile)) {
        respondSuccess(['paths' => []]);
    }

    $json = file_get_contents($pathsFile);
    $data = json_decode($json, true);
    if (!is_array($data)) $data = [];

    // normalize entries
    $result = [];
    foreach ($data as $p) {
        $result[] = [
            'pathId' => isset($p['id']) ? $p['id'] : null,
            'name' => $p['name'] ?? null,
            'positions' => $p['positions'] ?? [],
            'loop' => !empty($p['loop']),
            'createdAt' => isset($p['createdAt']) ? (int)$p['createdAt'] : null
        ];
    }

    respondSuccess(['paths' => $result]);
}

function handleGetPath() {
    $session = validateSession();
    $name = $_GET['name'] ?? ($_GET['id'] ?? '');
    if ($name === '') respondError('name is required');
    $data = jsonLoadFile(__DIR__ . '/gameData/paths.json');
    if (!is_array($data)) respondError('Path not found', 404);

    foreach ($data as $p) {
        if ((isset($p['id']) && $p['id'] === $name) || (isset($p['name']) && $p['name'] === $name)) {
            $result = [
                'pathId' => $p['id'] ?? null,
                'name' => $p['name'] ?? null,
                'positions' => $p['positions'] ?? [],
                'loop' => !empty($p['loop']),
                'createdAt' => isset($p['createdAt']) ? (int)$p['createdAt'] : null
            ];
            respondSuccess(['path' => $result]);
        }
    }

    respondError('Path not found', 404);
}

/* ================================================================
    GET REGIONS (for drawing on client maps)
    Loads regions from `regions.json` and returns normalized coordinates
================================================================ */
function handleGetRegions() {
    $session = validateSession();
    $rdata = jsonLoadFile(__DIR__ . '/gameData/regions.json') ?: [];

    $result = [];
    foreach ($rdata as $r) {
        $coords = $r['coordinates'] ?? $r['positions'] ?? $r['points'] ?? [];
        $norm = normalizePoints($coords);

        $result[] = [
            'regionId' => $r['id'] ?? $r['regionId'] ?? null,
            'name' => $r['name'] ?? null,
            'type' => $r['type'] ?? null,
            'coordinates' => $norm,
            'properties' => isset($r['properties']) ? $r['properties'] : (isset($r['props']) ? $r['props'] : []),
            'owner' => $r['owner'] ?? $r['ownerRealm'] ?? null,
            'walkable' => isset($r['walkable']) ? (bool)$r['walkable'] : (isset($r['properties']['walkable']) ? (bool)$r['properties']['walkable'] : true)
        ];
    }

    respondSuccess(['regions' => $result]);
}

/* ================================================================
    START MOVE (pathfinding + create walker)
================================================================ */
function handleStartMove() {
    $session = validateSession();
    if ($session['realm'] === null) respondError('Realm not selected');

    $targetX = isset($_POST['x']) ? (int)$_POST['x'] : null;
    $targetY = isset($_POST['y']) ? (int)$_POST['y'] : null;
    if ($targetX === null || $targetY === null) respondError('x and y are required');

    // Server-side: enforce region walk permissions (prevent clients from bypassing)
    try {
        $rdata = jsonLoadFile(__DIR__ . '/gameData/regions.json');
        $regionsExist = is_array($rdata) && count($rdata) > 0;
        $matched = false;
        if ($regionsExist) {
            foreach ($rdata as $r) {
                $poly = normalizePoints($r['coordinates'] ?? $r['positions'] ?? $r['points'] ?? []);
                if (count($poly) === 0) continue;
                if (pointInPolygonPHP($targetX, $targetY, $poly)) {
                    $matched = true;
                    $rtype = $r['type'] ?? null;
                    $rowner = $r['owner'] ?? $r['ownerRealm'] ?? null;
                    $rwalkable = isset($r['walkable']) ? (bool)$r['walkable'] : (isset($r['properties']['walkable']) ? (bool)$r['properties']['walkable'] : true);
                    $ownerMatches = ($rowner === null) ? true : ((string)$rowner === (string)$session['realm']);
                    if ($rtype === 'warzone') {
                        break;
                    }
                    if (!($rwalkable && $ownerMatches)) {
                        respondError('Cannot walk to that region.', 403);
                    }
                    break;
                }
            }
        }
        if ($regionsExist && !$matched) {
            respondError('You cannot swim.', 403);
        }
    } catch (Exception $e) { /* ignore and continue defensively */ }

    // load paths
    $data = jsonLoadFile(__DIR__ . '/gameData/paths.json');
    if (!is_array($data)) respondError('Invalid paths data', 500);

    // Build graph of nodes (each point in paths)
    $nodes = []; // {id: int, x, y}
    $nodeIndex = []; // mapping pathIdx->pointIdx->nodeId
    $nextId = 0;
    foreach ($data as $pi => $p) {
        $pts = $p['positions'] ?? [];
        $norm = normalizePoints($pts);
        foreach ($norm as $pj => $pt) {
            $x = $pt[0]; $y = $pt[1];
            $nodes[$nextId] = ['x'=>$x,'y'=>$y,'path'=>$p['id'] ?? ($p['name'] ?? $pi),'pathIndex'=>$pi,'pointIndex'=>$pj];
            $nodeIndex[$pi][$pj] = $nextId;
            $nextId++;
        }
    }

    if (count($nodes) === 0) respondError('No path nodes available', 500);

    // Build adjacency with edges between consecutive points and cross-path links within threshold
    $adj = [];
    foreach ($nodes as $id => $n) $adj[$id] = [];
    // consecutive edges
    foreach ($nodeIndex as $pi => $pts) {
        $prev = null;
        foreach ($pts as $pj => $nid) {
            if ($prev !== null) {
                $d = distance($nodes[$prev]['x'],$nodes[$prev]['y'],$nodes[$nid]['x'],$nodes[$nid]['y']);
                $adj[$prev][$nid] = $d;
                $adj[$nid][$prev] = $d;
            }
            $prev = $nid;
        }
    }
    // cross links (threshold)
    $linkThreshold = 40; // pixels
    $ids = array_keys($nodes);
    for ($i = 0; $i < count($ids); $i++) {
        for ($j = $i+1; $j < count($ids); $j++) {
            $a = $nodes[$ids[$i]]; $b = $nodes[$ids[$j]];
            $d = distance($a['x'],$a['y'],$b['x'],$b['y']);
            if ($d <= $linkThreshold) {
                $adj[$ids[$i]][$ids[$j]] = $d;
                $adj[$ids[$j]][$ids[$i]] = $d;
            }
        }
    }

    // find nearest node to player and nearest node to target
    $db = getDB();
    $stmt = $db->prepare('SELECT x,y FROM players WHERE user_id = ?');
    $stmt->execute([$session['user_id']]);
    $p = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$p) respondError('Player not found',404);
    $px = (int)$p['x']; $py = (int)$p['y'];

    $start = null; $end = null; $minS = PHP_INT_MAX; $minE = PHP_INT_MAX;
    foreach ($nodes as $nid => $n) {
        $ds = distance($px,$py,$n['x'],$n['y']);
        if ($ds < $minS) { $minS = $ds; $start = $nid; }
        $de = distance($targetX,$targetY,$n['x'],$n['y']);
        if ($de < $minE) { $minE = $de; $end = $nid; }
    }
    if ($start === null) respondError('No path start found',500);

    // Decide whether to use direct walking or the path network.
    // Use direct walking for short trips (avoid using the network),
    // but prefer the network for longer travel.
    $tripDist = distance($px, $py, $targetX, $targetY);
    $directThreshold = 300; // pixels - trips shorter or equal to this go direct
    $maxNodeDistance = 300; // pixels - if nearest node is this far or farther, we may still start direct

    $positions = [];
    if ($tripDist <= $directThreshold) {
        // Short trip: walk directly from player to target
        $positions[] = [$px, $py];
    } else {
        // Long trip: prefer the path network where available
        if ($minS > $maxNodeDistance) {
            // No nearby node for player: start directly from player's position
            $positions[] = [$px, $py];
        } else {
            // Try to Dijkstra from start to end if we have an end node
            $pathNodeIds = null;
            if ($end !== null) {
                $pathNodeIds = dijkstra($adj, $start, $end);
            }

            // If we couldn't find an end node or no route exists, fall back to
            // starting at the nearest path node and then go to the target.
            if ($pathNodeIds === null) {
                $positions[] = [ $nodes[$start]['x'], $nodes[$start]['y'] ];
            } else {
                // Build positions array of [x,y] from the found path nodes
                foreach ($pathNodeIds as $nid) {
                    $positions[] = [$nodes[$nid]['x'],$nodes[$nid]['y']];
                }
            }
        }
    }

    // append intermediate steps from the last path node to the exact target
    $last = $positions[count($positions)-1];
    $lx = (int)$last[0]; $ly = (int)$last[1];
    $dx = $targetX - $lx; $dy = $targetY - $ly;
    $distToTarget = distance($lx, $ly, $targetX, $targetY);
    $stepSize = 40; // pixels per step for direct segments
    if ($distToTarget <= $stepSize || $distToTarget == 0) {
        $positions[] = [$targetX, $targetY];
    } else {
        $steps = (int)ceil($distToTarget / $stepSize);
        for ($si = 1; $si <= $steps; $si++) {
            $t = $si / $steps;
            $px = (int)round($lx + $dx * $t);
            $py = (int)round($ly + $dy * $t);
            $positions[] = [$px, $py];
        }
    }

    // create a new walker for the user
    // Rules:
    // - If the user already has any finished ('done') walk, do not allow a new walk.
    // - If the user has an active walk ('new' or 'walking'), mark it as 'interrupted_by_new_walk'.
    // - Insert a new walker row with status 'walking'.
    $now = time();

    // Mark any active walks as interrupted
    $stmt = $db->prepare("UPDATE walkers SET status = 'interrupted_by_new_walk', updated_at = ? WHERE user_id = ? AND status IN ('new','walking')");
    $stmt->execute([$now, $session['user_id']]);

    // Insert new walker row
    $stmt = $db->prepare('INSERT INTO walkers (user_id, positions, current_index, started_at, updated_at, status, finished_at) VALUES (?, ?, ?, ?, ?, ?, NULL)');
    $stmt->execute([$session['user_id'], json_encode($positions), 0, $now, $now, 'walking']);

    $destination = $positions[count($positions)-1];
    $norm = [];
    foreach ($positions as $pp) {
        $nx = isset($pp[0]) ? (int)$pp[0] : 0;
        $ny = isset($pp[1]) ? (int)$pp[1] : 0;
        $norm[] = [$nx, $ny];
    }
    $walkerInfo = ['currentIndex' => 0, 'destination' => [(int)$destination[0], (int)$destination[1]], 'steps' => count($positions), 'positions' => $norm];
    respondSuccess(['message'=>'walking started','steps'=>count($positions),'walker' => $walkerInfo]);
}

// small helpers
function distance($x1,$y1,$x2,$y2){
    $dx = $x1-$x2; $dy = $y1-$y2; return sqrt($dx*$dx + $dy*$dy);
}

function dijkstra($adj, $start, $goal){
    $dist = [];$prev = [];$Q = [];
    foreach ($adj as $v => $_) { $dist[$v] = INF; $prev[$v]=null; $Q[$v]=true; }
    $dist[$start]=0;
    while (!empty($Q)){
        $u = null; $best = INF;
        foreach ($Q as $v => $_){ if ($dist[$v] < $best){ $best=$dist[$v]; $u=$v; } }
        if ($u === null) break;
        if ($u == $goal) break;
        unset($Q[$u]);
        foreach ($adj[$u] as $v => $w){ if (!isset($dist[$v])) continue; $alt = $dist[$u] + $w; if ($alt < $dist[$v]){ $dist[$v]=$alt; $prev[$v]=$u; } }
    }
    if ($dist[$goal]===INF) return null;
    $S = []; $u = $goal; while ($u!==null){ array_unshift($S,$u); $u = $prev[$u]; }
    return $S;
}

// Point-in-polygon check (ray casting) for integer raster coords
function pointInPolygonPHP($x, $y, $polygon) {
    $inside = false;
    $n = count($polygon);
    if ($n < 3) return false;
    $j = $n - 1;
    for ($i = 0; $i < $n; $j = $i++) {
        $xi = $polygon[$i][0]; $yi = $polygon[$i][1];
        $xj = $polygon[$j][0]; $yj = $polygon[$j][1];
        $intersect = ((($yi > $y) != ($yj > $y)) && ($x < ($xj - $xi) * ($y - $yi) / ($yj - $yi + 0.0) + $xi));
        if ($intersect) $inside = !$inside;
    }
    return $inside;
}

/* ================================================================
    GET INVENTORY
================================================================ */
function handleGetInventory() {
    $session = validateSession();

    if ($session['realm'] === null) {
        respondError('Realm not selected');
    }

    $db = getDB();
    // Exclude any inventory rows that are currently equipped by this user
    $equip = ensureEquipmentRow($db, $session['user_id']);
    $slots = getEquipmentSlots();
    $excluded = [];
    foreach ($slots as $s) {
        if (!empty($equip[$s])) $excluded[] = (int)$equip[$s];
    }

    if (count($excluded) > 0) {
        $placeholders = implode(',', array_fill(0, count($excluded), '?'));
        $sql = '
        SELECT 
            inv.inventory_id, 
            inv.item_id,
            inv.quantity, 
            inv.acquired_at,
            items.name,
            items.type,
            items.description,
            items.stats,
            items.rarity,
            items.stackable,
            items.level,
            items.equipment_slot,
            items.icon_name
        FROM inventory inv
        JOIN items ON inv.item_id = items.item_id
        WHERE inv.user_id = ? AND inv.inventory_id NOT IN (' . $placeholders . ')
        ORDER BY inv.acquired_at DESC
        ';
        $params = array_merge([$session['user_id']], $excluded);
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
    } else {
        // No equipped exclusions: select the full set of item fields (including level)
        $sql = '
        SELECT 
            inv.inventory_id, 
            inv.item_id,
            inv.quantity, 
            inv.acquired_at,
            items.name,
            items.type,
            items.description,
            items.stats,
            items.rarity,
            items.stackable,
            items.level,
            items.equipment_slot,
            items.icon_name
        FROM inventory inv
        JOIN items ON inv.item_id = items.item_id
        WHERE inv.user_id = ? 
        ORDER BY inv.acquired_at DESC
        ';
        $stmt = $db->prepare($sql);
        $stmt->execute([$session['user_id']]);
    }
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = [];
    foreach ($items as $item) {
        $result[] = [
            'inventoryId' => (int)$item['inventory_id'],
            'itemId' => (int)$item['item_id'],
            'itemName' => $item['name'],
            'itemType' => $item['type'],
            'quantity' => (int)$item['quantity'],
            'description' => $item['description'],
            'stats' => json_decode($item['stats'], true),
            'rarity' => $item['rarity'],
            'stackable' => (bool)$item['stackable'],
            'level' => isset($item['level']) ? (int)$item['level'] : 1,
            'equipmentSlot' => $item['equipment_slot'] !== null ? $item['equipment_slot'] : null,
            'iconName' => $item['icon_name'] ?? null,
            'acquiredAt' => (int)$item['acquired_at']
        ];
    }

    respondSuccess(['items' => $result]);
}

/* ================================================================
    ADD INVENTORY ITEM
================================================================ */
function handleAddInventoryItem() {
    $session = validateSession();

    if ($session['realm'] === null) {
        respondError('Realm not selected');
    }

    $itemId = isset($_POST['itemId']) ? (int)$_POST['itemId'] : null;
    $quantity = isset($_POST['quantity']) ? (int)$_POST['quantity'] : 1;

    if (!$itemId) {
        respondError('Item ID is required');
    }

    if ($quantity < 1) {
        respondError('Quantity must be at least 1');
    }

    $db = getDB();
    
    // Check if item exists in items table
    $stmt = $db->prepare('SELECT item_id, name, stackable FROM items WHERE item_id = ?');
    $stmt->execute([$itemId]);
    $item = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$item) {
        respondError('Item does not exist', 404);
    }
    
    // Check if player already has this item (for stackable items)
    $stmt = $db->prepare('SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?');
    $stmt->execute([$session['user_id'], $itemId]);
    $existingItem = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($existingItem && $item['stackable']) {
        // Update quantity for stackable items
        $newQuantity = $existingItem['quantity'] + $quantity;
        $stmt = $db->prepare('UPDATE inventory SET quantity = ? WHERE inventory_id = ?');
        $stmt->execute([$newQuantity, $existingItem['inventory_id']]);
        
        respondSuccess([
            'inventoryId' => (int)$existingItem['inventory_id'],
            'itemId' => $itemId,
            'itemName' => $item['name'],
            'quantity' => $newQuantity
        ]);
    } else {
        // Insert new item (or another copy for non-stackable items)
        $stmt = $db->prepare('INSERT INTO inventory (user_id, item_id, quantity, acquired_at) VALUES (?, ?, ?, ?)');
        $stmt->execute([$session['user_id'], $itemId, $quantity, now()]);
        
        respondSuccess([
            'inventoryId' => (int)$db->lastInsertId(),
            'itemId' => $itemId,
            'itemName' => $item['name'],
            'quantity' => $quantity
        ]);
    }
}

/* ================================================================
    REMOVE INVENTORY ITEM
================================================================ */
function handleRemoveInventoryItem() {
    $session = validateSession();

    if ($session['realm'] === null) {
        respondError('Realm not selected');
    }

    $inventoryId = isset($_POST['inventoryId']) ? (int)$_POST['inventoryId'] : null;
    $quantity = isset($_POST['quantity']) ? (int)$_POST['quantity'] : 1;

    if (!$inventoryId) {
        respondError('Inventory ID is required');
    }

    if ($quantity < 1) {
        respondError('Quantity must be at least 1');
    }

    $db = getDB();
    
    // Get current item with details from items table
    $stmt = $db->prepare('
        SELECT inv.inventory_id, inv.quantity, items.name
        FROM inventory inv
        JOIN items ON inv.item_id = items.item_id
        WHERE inv.inventory_id = ? AND inv.user_id = ?
    ');
    $stmt->execute([$inventoryId, $session['user_id']]);
    $item = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$item) {
        respondError('Item not found', 404);
    }

    if ($item['quantity'] <= $quantity) {
        // Remove item completely
        $stmt = $db->prepare('DELETE FROM inventory WHERE inventory_id = ?');
        $stmt->execute([$inventoryId]);
        
        respondSuccess([
            'removed' => true,
            'itemName' => $item['name']
        ]);
    } else {
        // Decrease quantity
        $newQuantity = $item['quantity'] - $quantity;
        $stmt = $db->prepare('UPDATE inventory SET quantity = ? WHERE inventory_id = ?');
        $stmt->execute([$newQuantity, $inventoryId]);
        
        respondSuccess([
            'removed' => false,
            'itemName' => $item['name'],
            'quantity' => $newQuantity
        ]);
    }
}

/* ================================================================
    GET ALL ITEMS (Templates)
================================================================ */
function handleGetItems() {
    $session = validateSession();

    $db = getDB();
    $stmt = $db->prepare('SELECT item_id, name, type, description, stats, rarity, stackable, level, equipment_slot, icon_name FROM items ORDER BY type, name');
    $stmt->execute();
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = [];
    foreach ($items as $item) {
        $result[] = [
            'itemId' => (int)$item['item_id'],
            'name' => $item['name'],
            'type' => $item['type'],
            'description' => $item['description'],
            'stats' => json_decode($item['stats'], true),
            'rarity' => $item['rarity'],
            'stackable' => (bool)$item['stackable'],
            'level' => isset($item['level']) ? (int)$item['level'] : 1,
            'equipmentSlot' => $item['equipment_slot'] !== null ? $item['equipment_slot'] : null,
            'iconName' => $item['icon_name'] ?? null
        ];
    }

    respondSuccess(['items' => $result]);
}

/* ================================================================
    EQUIPMENT ENDPOINTS
================================================================ */
function getEquipmentSlots() {
    return ['head','body','hands','shoulders','legs','weapon_right','weapon_left','ring_right','ring_left','amulet'];
}

// Update equipment row helper (builds SQL and executes)
function updateEquipmentDB($db, $equip) {
    $slots = getEquipmentSlots();
    $setParts = [];
    $params = [];
    foreach ($slots as $s) {
        $setParts[] = "$s = ?";
        $params[] = $equip[$s] !== null ? $equip[$s] : null;
    }
    $setParts[] = "updated_at = ?";
    $params[] = $equip['updated_at'];
    $params[] = $equip['equipment_id'];

    $sql = 'UPDATE equipment SET ' . implode(', ', $setParts) . ' WHERE equipment_id = ?';
    $stmt = $db->prepare($sql);
    $stmt->execute(array_values($params));
}

function ensureEquipmentRow($db, $userId) {
    $stmt = $db->prepare('SELECT * FROM equipment WHERE user_id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) return $row;

    $now = now();
    $stmt = $db->prepare('INSERT INTO equipment (user_id, created_at, updated_at) VALUES (?, ?, ?)');
    $stmt->execute([$userId, $now, $now]);
    $id = $db->lastInsertId();
    $stmt = $db->prepare('SELECT * FROM equipment WHERE equipment_id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch(PDO::FETCH_ASSOC);
}

function fetchEquippedItemDetails($db, $inventoryId) {
    if (!$inventoryId) return null;
    $stmt = $db->prepare('
        SELECT inv.inventory_id, inv.item_id, inv.quantity, items.name, items.type, items.description, items.stats, items.rarity, items.stackable, items.level, items.equipment_slot, items.icon_name
        FROM inventory inv
        JOIN items ON inv.item_id = items.item_id
        WHERE inv.inventory_id = ?
    ');
    $stmt->execute([$inventoryId]);
    $it = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$it) return null;
    return [
        'inventoryId' => (int)$it['inventory_id'],
        'itemId' => (int)$it['item_id'],
        'name' => $it['name'],
        'type' => $it['type'],
        'quantity' => (int)$it['quantity'],
        'description' => $it['description'],
        'stats' => json_decode($it['stats'], true),
        'rarity' => $it['rarity'],
        'stackable' => (bool)$it['stackable'],
        'level' => isset($it['level']) ? (int)$it['level'] : 1,
        'equipmentSlot' => isset($it['equipment_slot']) ? $it['equipment_slot'] : null,
        'iconName' => $it['icon_name'] ?? null
    ];
}

function handleGetEquipment() {
    $session = validateSession();
    if ($session['realm'] === null) respondError('Realm not selected');

    $db = getDB();
    $equip = ensureEquipmentRow($db, $session['user_id']);

    $slots = getEquipmentSlots();
    $result = [];
    foreach ($slots as $slot) {
        $invId = $equip[$slot] ?? null;
        $result[$slot] = [
            'inventoryId' => $invId ? (int)$invId : null,
            'item' => $invId ? fetchEquippedItemDetails($db, $invId) : null
        ];
    }

    respondSuccess(['equipment' => $result]);
}

function handleEquipItem() {
    $session = validateSession();
    if ($session['realm'] === null) respondError('Realm not selected');

    $inventoryId = isset($_POST['inventoryId']) ? (int)$_POST['inventoryId'] : 0;

    $slots = getEquipmentSlots();

    if (!$inventoryId) respondError('inventoryId is required');

    $db = getDB();
    try {
        $db->beginTransaction();

        // verify ownership
        $stmt = $db->prepare('SELECT inventory_id, quantity FROM inventory WHERE inventory_id = ? AND user_id = ?');
        $stmt->execute([$inventoryId, $session['user_id']]);
        $inv = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$inv) {
            $db->rollBack();
            respondError('Inventory item not found', 404);
        }

        // fetch item template info (equipment_slot)
        $stmt = $db->prepare('SELECT items.item_id, items.equipment_slot FROM inventory inv JOIN items ON inv.item_id = items.item_id WHERE inv.inventory_id = ?');
        $stmt->execute([$inventoryId]);
        $tpl = $stmt->fetch(PDO::FETCH_ASSOC);
        $templateSlot = $tpl['equipment_slot'] ?? null;

        // Items without a template equipment_slot are not equippable
        if (!$templateSlot) {
            $db->rollBack();
            respondError('This item cannot be equipped', 400);
        }

        // decide target slot: use the item's template slot (auto-assigned)
        $targetSlot = $templateSlot;
        if (!in_array($targetSlot, $slots)) {
            $db->rollBack();
            respondError('Item template references an invalid equipment slot', 500);
        }

        // ensure equipment row exists
        $equip = ensureEquipmentRow($db, $session['user_id']);
        // clear any other slot that references this inventory id
        foreach ($slots as $s) {
            if (!empty($equip[$s]) && (int)$equip[$s] === $inventoryId) {
                $equip[$s] = null;
            }
        }

        // if target slot already occupied, unequip it first
        if (!empty($equip[$targetSlot])) {
            $equip[$targetSlot] = null;
        }

        // set target slot
        $equip[$targetSlot] = $inventoryId;
        $equip['updated_at'] = now();

        updateEquipmentDB($db, $equip);

        $db->commit();

        // return updated equipment
        handleGetEquipment();
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Equip transaction failed: ' . $e->getMessage());
        respondError('Server error', 500);
    }
}

function handleUnequipItem() {
    $session = validateSession();
    if ($session['realm'] === null) respondError('Realm not selected');

    $slot = trim($_POST['slot'] ?? '');
    $slots = getEquipmentSlots();
    if (!in_array($slot, $slots)) respondError('Invalid slot');

    $db = getDB();
    try {
        $db->beginTransaction();

        $equip = ensureEquipmentRow($db, $session['user_id']);

        if (empty($equip[$slot])) {
            $db->rollBack();
            respondError('Slot is already empty');
        }

        $equip[$slot] = null;
        $equip['updated_at'] = now();

        updateEquipmentDB($db, $equip);

        $db->commit();

        handleGetEquipment();
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('Unequip transaction failed: ' . $e->getMessage());
        respondError('Server error', 500);
    }
}

/* ================================================================
    SHOUTBOX: Read and write directly to forum MySQL
    GET  /shoutbox -> last 50 messages (oldest first)
    POST /shoutbox -> insert message
================================================================ */

function getForumDbConnection() {
    $mysqli = new mysqli(FORUM_DB_HOST, FORUM_DB_USER, FORUM_DB_PASS, FORUM_DB_NAME, FORUM_DB_PORT);
    if ($mysqli->connect_errno) {
        error_log('Forum DB connect failed: ' . $mysqli->connect_error);
        respondError('Forum database connection failed', 500);
    }
    $mysqli->set_charset('utf8mb4');
    return $mysqli;
}

function handleGetShoutbox() {
    // Require an authenticated session to read shoutbox messages
    $session = validateSession();
    $db = getForumDbConnection();
    $stmt = $db->prepare("SELECT entryID, userID, shoutboxID, username, `time`, message FROM wcf1_shoutbox_entry ORDER BY `time` DESC LIMIT 50");
    if (!$stmt) { $err = $db->error; $db->close(); respondError('Query prepare failed: ' . $err, 500); }
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($row = $res->fetch_assoc()) {
        $rows[] = $row;
    }
    $stmt->close();
    $db->close();

    // return chronological order (oldest first)
    $rows = array_reverse($rows);
    respondSuccess(['messages' => $rows]);
}

function handlePostShoutbox() {
    $session = validateSession();
    $userID = (int)$session['user_id'];
    $shoutboxID = isset($_POST['shoutboxID']) && is_numeric($_POST['shoutboxID']) ? intval($_POST['shoutboxID']) : 1;
    $message = $_POST['message'] ?? '';
    $time = $_POST['time'] ?? null; // optional

    // message is required
    if ($message === '') {
        respondError('message is required.', 400);
    }

    // normalize time: prefer Unix timestamp (seconds). If provided as string, try parsing; fallback to now.
    if ($time === null || $time === '') {
        $time = time();
    } else {
        $time = trim((string)$time);
        if (is_numeric($time)) {
            $time = (int)$time;
        } else {
            $ts = strtotime($time);
            $time = ($ts === false) ? time() : (int)$ts;
        }
    }

    // Lookup username from the game's `players` table (MariaDB). Reject if not found.
    $username = '';
    try {
        $gdb = getDB();
        $s = $gdb->prepare('SELECT username FROM players WHERE user_id = ? LIMIT 1');
        $s->execute([$session['user_id']]);
        $row = $s->fetch(PDO::FETCH_ASSOC);
        if ($row && !empty($row['username'])) {
            $username = trim($row['username']);
        }
    } catch (Exception $e) {
        // lookup failed
    }
    
    if ($username === '') {
        respondError('Username not found. Cannot post message.', 404);
    }

    $db = getForumDbConnection();

    $stmt = $db->prepare("INSERT INTO wcf1_shoutbox_entry (userID, shoutboxID, username, `time`, message) VALUES (?, ?, ?, ?, ?)");
    if (!$stmt) { $err = $db->error; $db->close(); respondError('Query prepare failed: ' . $err, 500); }
    // Bind parameters: userID (int), shoutboxID (int), username (string), time (int), message (string)
    $stmt->bind_param('iisis', $userID, $shoutboxID, $username, $time, $message);
    $ok = $stmt->execute();
    if ($ok) {
        $insertId = $stmt->insert_id;
        $stmt->close();
        $db->close();
        respondSuccess(['entryID' => $insertId]);
    } else {
        $err = $stmt->error;
        $stmt->close();
        $db->close();
        respondError('Insert failed: ' . $err, 500);
    }
}

/* ================================================================
    SCREENSHOTS: Manage screenshot metadata and file uploads using SQLite
================================================================ */

function getScreenshotsDB() {
    static $db = null;
    if ($db === null) {
        $dockerPath = '/var/www/api/screenshots.sqlite';
        $localPath = __DIR__ . '/screenshots.sqlite';
        $dbPath = file_exists($dockerPath) || is_dir('/var/www/api') ? $dockerPath : $localPath;
        
        $db = new PDO('sqlite:' . $dbPath);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }
    return $db;
}

function sanitizeFilename($name) {
    // Replace spaces, dots, commas, and other special chars with hyphens
    $name = preg_replace('/[^a-zA-Z0-9_-]/', '-', $name);
    // Remove multiple consecutive hyphens
    $name = preg_replace('/-+/', '-', $name);
    // Trim hyphens from start/end
    return trim($name, '-');
}

function handleGetScreenshots() {
    $session = validateSession();
    
    $db = getScreenshotsDB();
    $stmt = $db->query("SELECT * FROM screenshots ORDER BY id ASC");
    $rows = $stmt->fetchAll();
    
    // Transform to match frontend format
    $screenshots = array_map(function($row) {
        return [
            'id' => (int)$row['id'],
            'filename' => $row['filename'],
            'name' => [
                'en' => $row['name_en'],
                'de' => $row['name_de'],
                'es' => $row['name_es']
            ],
            'description' => [
                'en' => $row['description_en'],
                'de' => $row['description_de'],
                'es' => $row['description_es']
            ],
            'location' => $row['location'],
            'visibleCharacters' => $row['visible_characters'],
            'x' => (int)$row['x'],
            'y' => (int)$row['y'],
            'uploadedBy' => is_numeric($row['uploaded_by']) ? (int)$row['uploaded_by'] : $row['uploaded_by'],
            'uploadedAt' => (int)$row['uploaded_at'],
            'updatedAt' => $row['updated_at'] ? (int)$row['updated_at'] : null
        ];
    }, $rows);
    
    respondSuccess(['screenshots' => $screenshots]);
}

function handleAddScreenshot() {
    $session = validateSession();
    
    // Parse form data
    $name_en = trim($_POST['name_en'] ?? '');
    $name_de = trim($_POST['name_de'] ?? '');
    $name_es = trim($_POST['name_es'] ?? '');
    $description_en = trim($_POST['description_en'] ?? '');
    $description_de = trim($_POST['description_de'] ?? '');
    $description_es = trim($_POST['description_es'] ?? '');
    $location = trim($_POST['location'] ?? '');
    $visible_characters = trim($_POST['visible_characters'] ?? '');
    $x = isset($_POST['x']) ? (int)$_POST['x'] : null;
    $y = isset($_POST['y']) ? (int)$_POST['y'] : null;
    
    // Validate required fields
    if ($x === null || $y === null) {
        respondError('X and Y coordinates are required');
    }
    
    // Handle file upload
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $errorMsg = 'Screenshot file is required';
        if (isset($_FILES['file']['error'])) {
            switch ($_FILES['file']['error']) {
                case UPLOAD_ERR_INI_SIZE:
                case UPLOAD_ERR_FORM_SIZE:
                    $errorMsg = 'File is too large';
                    break;
                case UPLOAD_ERR_PARTIAL:
                    $errorMsg = 'File was only partially uploaded';
                    break;
                case UPLOAD_ERR_NO_FILE:
                    $errorMsg = 'No file was uploaded';
                    break;
                case UPLOAD_ERR_NO_TMP_DIR:
                    $errorMsg = 'Missing temporary folder';
                    break;
                case UPLOAD_ERR_CANT_WRITE:
                    $errorMsg = 'Failed to write file to disk';
                    break;
            }
        }
        respondError($errorMsg);
    }
    
    $file = $_FILES['file'];
    
    // Get file extension and validate
    $extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    
    if (!in_array($extension, $allowedExtensions)) {
        respondError('Invalid file type. Allowed: jpg, jpeg, png, gif, webp');
    }
    
    // Determine filename: use name_en, name_de, name_es, or original filename
    $baseName = $name_en ?: ($name_de ?: ($name_es ?: pathinfo($file['name'], PATHINFO_FILENAME)));
    $baseName = sanitizeFilename($baseName);
    $filename = $baseName . '.' . $extension;
    
    // Upload file to external API
    // API expects: ?action=upload, field name 'screenshot', optional 'name' field, X-API-KEY header
    $apiUrl = SCREENSHOTS_API_URL . '?action=upload';
    $ch = curl_init($apiUrl);
    
    $postFields = [
        'screenshot' => new CURLFile($file['tmp_name'], $file['type'], $filename),
        'name' => $filename
    ];
    
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $postFields,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'X-API-KEY: ' . SCREENSHOTS_API_KEY
        ]
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    
    if ($httpCode !== 200 || !$response) {
        error_log('Screenshot upload failed: HTTP ' . $httpCode . ', Error: ' . $curlError . ', Response: ' . $response);
        respondError('Failed to upload screenshot to server. HTTP ' . $httpCode . ': ' . ($curlError ?: 'Unknown error'), 500);
    }
    
    $uploadResult = json_decode($response, true);
    if (!$uploadResult || !isset($uploadResult['ok']) || !$uploadResult['ok']) {
        $errorMsg = isset($uploadResult['error']) ? $uploadResult['error'] : 'Unknown upload error';
        error_log('Screenshot upload API error: ' . $errorMsg . ', Raw response: ' . $response);
        respondError('Failed to upload screenshot: ' . $errorMsg, 500);
    }
    
    // Get the uploaded filename
    $uploadedFilename = isset($uploadResult['saved_as']) ? $uploadResult['saved_as'] : $filename;
    
    // Insert into database
    $db = getScreenshotsDB();
    $stmt = $db->prepare("
        INSERT INTO screenshots (
            filename, name_en, name_de, name_es,
            description_en, description_de, description_es,
            location, visible_characters, x, y,
            uploaded_by, uploaded_at
        ) VALUES (
            :filename, :name_en, :name_de, :name_es,
            :description_en, :description_de, :description_es,
            :location, :visible_characters, :x, :y,
            :uploaded_by, :uploaded_at
        )
    ");
    
    $stmt->execute([
        ':filename' => $uploadedFilename,
        ':name_en' => $name_en ?: null,
        ':name_de' => $name_de ?: null,
        ':name_es' => $name_es ?: null,
        ':description_en' => $description_en ?: null,
        ':description_de' => $description_de ?: null,
        ':description_es' => $description_es ?: null,
        ':location' => $location ?: null,
        ':visible_characters' => $visible_characters ?: null,
        ':x' => $x,
        ':y' => $y,
        ':uploaded_by' => $session['user_id'],
        ':uploaded_at' => now()
    ]);
    
    $newId = $db->lastInsertId();
    
    $newScreenshot = [
        'id' => (int)$newId,
        'filename' => $uploadedFilename,
        'name' => [
            'en' => $name_en ?: null,
            'de' => $name_de ?: null,
            'es' => $name_es ?: null
        ],
        'description' => [
            'en' => $description_en ?: null,
            'de' => $description_de ?: null,
            'es' => $description_es ?: null
        ],
        'location' => $location ?: null,
        'visibleCharacters' => $visible_characters ?: null,
        'x' => $x,
        'y' => $y,
        'uploadedBy' => $session['user_id'],
        'uploadedAt' => now()
    ];
    
    respondSuccess(['screenshot' => $newScreenshot]);
}

function handleUpdateScreenshot($id) {
    $session = validateSession();
    $id = (int)$id;
    
    // Parse form data
    $input = file_get_contents('php://input');
    parse_str($input, $_PUT);
    
    $name_en = trim($_PUT['name_en'] ?? '');
    $name_de = trim($_PUT['name_de'] ?? '');
    $name_es = trim($_PUT['name_es'] ?? '');
    $description_en = trim($_PUT['description_en'] ?? '');
    $description_de = trim($_PUT['description_de'] ?? '');
    $description_es = trim($_PUT['description_es'] ?? '');
    $location = trim($_PUT['location'] ?? '');
    $visible_characters = trim($_PUT['visible_characters'] ?? '');
    $x = isset($_PUT['x']) ? (int)$_PUT['x'] : null;
    $y = isset($_PUT['y']) ? (int)$_PUT['y'] : null;
    
    // Validate required fields
    if ($x === null || $y === null) {
        respondError('X and Y coordinates are required');
    }
    
    // Update in database
    $db = getScreenshotsDB();
    $stmt = $db->prepare("
        UPDATE screenshots SET
            name_en = :name_en,
            name_de = :name_de,
            name_es = :name_es,
            description_en = :description_en,
            description_de = :description_de,
            description_es = :description_es,
            location = :location,
            visible_characters = :visible_characters,
            x = :x,
            y = :y,
            updated_at = :updated_at
        WHERE id = :id
    ");
    
    $stmt->execute([
        ':name_en' => $name_en ?: null,
        ':name_de' => $name_de ?: null,
        ':name_es' => $name_es ?: null,
        ':description_en' => $description_en ?: null,
        ':description_de' => $description_de ?: null,
        ':description_es' => $description_es ?: null,
        ':location' => $location ?: null,
        ':visible_characters' => $visible_characters ?: null,
        ':x' => $x,
        ':y' => $y,
        ':updated_at' => now(),
        ':id' => $id
    ]);
    
    if ($stmt->rowCount() === 0) {
        respondError('Screenshot not found', 404);
    }
    
    // Get updated screenshot
    $stmt = $db->prepare("SELECT * FROM screenshots WHERE id = :id");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    
    if (!$row) {
        respondError('Screenshot not found', 404);
    }
    
    $screenshot = [
        'id' => (int)$row['id'],
        'filename' => $row['filename'],
        'name' => [
            'en' => $row['name_en'],
            'de' => $row['name_de'],
            'es' => $row['name_es']
        ],
        'description' => [
            'en' => $row['description_en'],
            'de' => $row['description_de'],
            'es' => $row['description_es']
        ],
        'location' => $row['location'],
        'visibleCharacters' => $row['visible_characters'],
        'x' => (int)$row['x'],
        'y' => (int)$row['y'],
        'uploadedBy' => is_numeric($row['uploaded_by']) ? (int)$row['uploaded_by'] : $row['uploaded_by'],
        'uploadedAt' => (int)$row['uploaded_at'],
        'updatedAt' => $row['updated_at'] ? (int)$row['updated_at'] : null
    ];
    
    respondSuccess(['screenshot' => $screenshot]);
}

function handleDeleteScreenshot($id) {
    $session = validateSession();
    $id = (int)$id;
    
    $db = getScreenshotsDB();
    
    // Get screenshot info before deleting
    $stmt = $db->prepare("SELECT * FROM screenshots WHERE id = :id");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    
    if (!$row) {
        respondError('Screenshot not found', 404);
    }
    
    $deletedScreenshot = [
        'id' => (int)$row['id'],
        'filename' => $row['filename'],
        'name' => [
            'en' => $row['name_en'],
            'de' => $row['name_de'],
            'es' => $row['name_es']
        ],
        'description' => [
            'en' => $row['description_en'],
            'de' => $row['description_de'],
            'es' => $row['description_es']
        ],
        'location' => $row['location'],
        'visibleCharacters' => $row['visible_characters'],
        'x' => (int)$row['x'],
        'y' => (int)$row['y'],
        'uploadedBy' => is_numeric($row['uploaded_by']) ? (int)$row['uploaded_by'] : $row['uploaded_by'],
        'uploadedAt' => (int)$row['uploaded_at']
    ];
    
    // Note: External API doesn't support delete operation
    // Files remain on the server but metadata is removed from database
    
    // Delete from database
    $stmt = $db->prepare("DELETE FROM screenshots WHERE id = :id");
    $stmt->execute([':id' => $id]);
    
    respondSuccess(['message' => 'Screenshot deleted', 'screenshot' => $deletedScreenshot]);
}

