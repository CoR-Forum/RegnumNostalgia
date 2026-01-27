<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Session-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Constants
define('DB_PATH', __DIR__ . '/database.sqlite');
define('FORUM_API_URL', 'https://cor-forum.de/api.php');
define('FORUM_API_KEY', getenv('COR_FORUM_API_KEY') ?: '');
define('SESSION_DURATION', 86400); // 24 hours

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
            $db = new PDO('sqlite:' . DB_PATH);
            $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
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

// Validate session and return user data
function validateSession() {
    $sessionToken = $_SERVER['HTTP_X_SESSION_TOKEN'] ?? '';
    if (!$sessionToken) {
        respondError('Session token required', 401);
    }

    $db = getDB();
    $stmt = $db->prepare('SELECT user_id, username, realm FROM sessions WHERE session_id = ? AND expires_at > ?');
    $stmt->execute([$sessionToken, now()]);
    $session = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$session) {
        respondError('Invalid or expired session', 401);
    }

    // Renew session
    $newExpiresAt = now() + SESSION_DURATION;
    $stmt = $db->prepare('UPDATE sessions SET last_activity = ?, expires_at = ? WHERE session_id = ?');
    $stmt->execute([now(), $newExpiresAt, $sessionToken]);

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

    // Create or update session
    $db = getDB();
    $sessionToken = generateSessionToken();
    $expiresAt = now() + SESSION_DURATION;

    // Check if user exists
    $stmt = $db->prepare('SELECT user_id, realm FROM players WHERE user_id = ?');
    $stmt->execute([$userId]);
    $player = $stmt->fetch(PDO::FETCH_ASSOC);

    $realm = $player ? $player['realm'] : null;

    // Delete old sessions for this user
    $stmt = $db->prepare('DELETE FROM sessions WHERE user_id = ?');
    $stmt->execute([$userId]);

    // Create new session
    $stmt = $db->prepare('INSERT INTO sessions (session_id, user_id, username, realm, created_at, expires_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([$sessionToken, $userId, $username, $realm, now(), $expiresAt, now()]);

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
        $stmt = $db->prepare('UPDATE players SET realm = ?, x = ?, y = ?, last_active = ? WHERE user_id = ?');
        $stmt->execute([$realm, $spawnX, $spawnY, now(), $session['user_id']]);
    } else {
        $stmt = $db->prepare('INSERT INTO players (user_id, username, realm, x, y, last_active) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$session['user_id'], $session['username'], $realm, $spawnX, $spawnY, now()]);
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
    GET PLAYER POSITION
================================================================ */
function handleGetPosition() {
    $session = validateSession();

    if ($session['realm'] === null) {
        respondError('Realm not selected');
    }

    $db = getDB();
    $stmt = $db->prepare('SELECT x, y, realm FROM players WHERE user_id = ?');
    $stmt->execute([$session['user_id']]);
    $player = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$player) {
        respondError('Player not found', 404);
    }

    respondSuccess([
        'position' => [
            'x' => (int)$player['x'],
            'y' => (int)$player['y']
        ],
        'realm' => $player['realm']
    ]);
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
    $stmt = $db->prepare('SELECT user_id, username, realm, x, y, last_active FROM players WHERE last_active > ?');
    $stmt->execute([now() - 5]);
    $players = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = [];
    foreach ($players as $player) {
        $result[] = [
            'userId' => (int)$player['user_id'],
            'username' => $player['username'],
            'realm' => $player['realm'],
            'x' => (int)$player['x'],
            'y' => (int)$player['y'],
            'lastActive' => (int)$player['last_active']
        ];
    }

    respondSuccess(['players' => $result]);
}
