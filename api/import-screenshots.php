<?php
/**
 * Bulk Screenshot Import Script
 * 
 * Uploads screenshots from a directory to the external API and inserts
 * metadata entries into the screenshots SQLite database with placeholder coordinates.
 * Screenshots can then be edited via the web interface to assign proper locations.
 * 
 * Usage: php import-screenshots.php /path/to/screenshots/directory
 */

// Load environment variables if .env exists
if (file_exists(__DIR__ . '/../.env')) {
    $lines = file(__DIR__ . '/../.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) continue;
        list($key, $value) = explode('=', $line, 2);
        putenv(trim($key) . '=' . trim($value));
    }
}

// Configuration
define('SCREENSHOTS_API_URL', 'https://cor-forum.de/regnum/RegnumNostalgia/screenshots_api.php');
define('SCREENSHOTS_API_KEY', getenv('SCREENSHOTS_API_KEY') ?: '');

// Upload behaviour
define('UPLOAD_TIMEOUT', 10); // seconds
define('UPLOAD_MAX_RETRIES', 5); // abort script after this many failed attempts per file

// Use same path logic as the main API for SQLite database
function getScreenshotsDB() {
    $dockerPath = '/var/www/api/screenshots.sqlite';
    $localPath = __DIR__ . '/screenshots.sqlite';
    $dbPath = file_exists($dockerPath) || is_dir('/var/www/api') ? $dockerPath : $localPath;
    
    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    return $db;
}

// Default coordinates for imported screenshots (can be edited later)
define('DEFAULT_X', 0);
define('DEFAULT_Y', 0);

// Check for API key
if (empty(SCREENSHOTS_API_KEY)) {
    die("ERROR: SCREENSHOTS_API_KEY not set in environment\n");
}

// Check command line argument
if ($argc < 2) {
    die("Usage: php import-screenshots.php /path/to/screenshots/directory\n");
}

$sourceDir = rtrim($argv[1], '/') . '/';

if (!is_dir($sourceDir)) {
    die("ERROR: Directory not found: {$sourceDir}\n");
}

// Get all image files
$allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
$files = [];
$dir = new DirectoryIterator($sourceDir);
foreach ($dir as $fileInfo) {
    if ($fileInfo->isDot()) continue;
    $ext = strtolower($fileInfo->getExtension());
    if (in_array($ext, $allowedExtensions)) {
        $files[] = $fileInfo->getPathname();
    }
}

$totalFiles = count($files);
if ($totalFiles === 0) {
    die("ERROR: No image files found in {$sourceDir}\n");
}

echo "Found {$totalFiles} image files to import\n";
echo "Screenshots will be saved to database\n";

// Initialize database connection
$db = getScreenshotsDB();

// Check if table exists, if not create it
require_once __DIR__ . '/init-screenshots-db.php';
initScreenshotsDatabase();

echo "Starting import...\n\n";

// Prepare statement for duplicate check
$checkStmt = $db->prepare("SELECT id FROM screenshots WHERE filename = :filename");

// Prepare insert statement
$insertStmt = $db->prepare("
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

// Import statistics
$imported = 0;
$failed = 0;
$skipped = 0;
$startTime = time();

foreach ($files as $index => $filePath) {
    $fileName = basename($filePath);
    $fileNum = $index + 1;
    
    echo "[{$fileNum}/{$totalFiles}] Processing: {$fileName}... ";
    
    // Check if already exists
    $checkStmt->execute([':filename' => $fileName]);
    if ($checkStmt->fetch()) {
        echo "SKIPPED (already exists)\n";
        $skipped++;
        continue;
    }
    
    // Upload to external API
    $result = uploadScreenshot($filePath, $fileName);
    
    if ($result['success']) {
        // Insert into database
        try {
            $uploadedFilename = $result['filename'];
            $baseFilename = pathinfo($uploadedFilename, PATHINFO_FILENAME);
            
            $insertStmt->execute([
                ':filename' => $uploadedFilename,
                ':name_en' => $baseFilename,
                ':name_de' => null,
                ':name_es' => null,
                ':description_en' => null,
                ':description_de' => null,
                ':description_es' => null,
                ':location' => null,
                ':visible_characters' => null,
                ':x' => DEFAULT_X,
                ':y' => DEFAULT_Y,
                ':uploaded_by' => 'import-script',
                ':uploaded_at' => time()
            ]);
            
            echo "SUCCESS (saved as: {$uploadedFilename})\n";
            $imported++;
            
            // Progress update every 100 files
            if ($imported % 100 === 0) {
                echo "  → Progress: {$imported}/{$totalFiles} imported\n";
            }
        } catch (PDOException $e) {
            echo "FAILED (DB error: " . $e->getMessage() . ")\n";
            $failed++;
        }
    } else {
        echo "FAILED ({$result['error']})\n";
        $failed++;
        // If uploadScreenshot signals a fatal error (retries exhausted), abort the whole import
        if (!empty($result['fatal'])) {
            echo "FATAL: Upload failed after " . UPLOAD_MAX_RETRIES . " attempts for {$fileName}. Aborting.\n";
            // Print summary then exit
            $elapsed = time() - $startTime;
            echo "\n" . str_repeat('=', 50) . "\n";
            echo "Import Aborted!\n";
            echo str_repeat('=', 50) . "\n";
            echo "Total files:  {$totalFiles}\n";
            echo "Imported:     {$imported}\n";
            echo "Skipped:      {$skipped}\n";
            echo "Failed:       {$failed}\n";
            echo "Time elapsed: {$elapsed} seconds\n";
            exit(1);
        }
    }
    
    // Brief pause to avoid overwhelming the API
    usleep(100000); // 100ms
}

// Final summary
$elapsed = time() - $startTime;
echo "\n" . str_repeat('=', 50) . "\n";
echo "Import Complete!\n";
echo str_repeat('=', 50) . "\n";
echo "Total files:  {$totalFiles}\n";
echo "Imported:     {$imported}\n";
echo "Skipped:      {$skipped}\n";
echo "Failed:       {$failed}\n";
echo "Time elapsed: {$elapsed} seconds\n";
echo "\nScreenshots saved to database\n";
echo "\nNext steps:\n";
echo "1. Open the game in your browser\n";
echo "2. Right-click on the map to open Screenshots Manager\n";
echo "3. Edit each screenshot to assign proper coordinates and metadata\n";

/**
 * Upload a screenshot to the external API
 */
function uploadScreenshot($filePath, $fileName) {
    $apiUrl = SCREENSHOTS_API_URL . '?action=upload';

    // Get mime type
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $filePath);

    for ($attempt = 1; $attempt <= UPLOAD_MAX_RETRIES; $attempt++) {
        $ch = curl_init($apiUrl);

        $postFields = [
            'screenshot' => new CURLFile($filePath, $mimeType, $fileName),
            'name' => $fileName
        ];

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $postFields,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => UPLOAD_TIMEOUT,
            CURLOPT_HTTPHEADER => [
                'X-API-KEY: ' . SCREENSHOTS_API_KEY
            ]
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        // curl_close() is deprecated since PHP 8.5 and is a no-op since PHP 8.0
        // No explicit close required.

        // Success case
        if ($httpCode === 200 && $response) {
            $uploadResult = json_decode($response, true);
            if ($uploadResult && isset($uploadResult['ok']) && $uploadResult['ok']) {
                return [
                    'success' => true,
                    'filename' => $uploadResult['saved_as']
                ];
            }
            $errorMsg = isset($uploadResult['error']) ? $uploadResult['error'] : 'Unknown upload error';
        } else {
            $errorMsg = "HTTP {$httpCode}: " . ($curlError ?: 'Unknown error');
        }

        // If this wasn't the last attempt, wait and retry
        if ($attempt < UPLOAD_MAX_RETRIES) {
            $waitSec = $attempt * 0.5; // 0.5s, 1.0s, 1.5s, ...
            echo "Attempt {$attempt} failed for {$fileName} ({$errorMsg}). Retrying after {$waitSec}s...\n";
            usleep((int)($waitSec * 1000000));
            continue;
        }

        // Final failure after retries
        return [
            'success' => false,
            'error' => $errorMsg,
            'fatal' => true
        ];
    }
}
