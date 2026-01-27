#!/bin/sh
set -e

# Install system dependencies for SQLite
apk add --no-cache sqlite-dev

# Install PDO SQLite extension
docker-php-ext-install pdo pdo_sqlite

# Ensure application directory exists and is writable before initializing DB
mkdir -p /var/www/api
chown -R www-data:www-data /var/www/api || true
find /var/www/api -type d -exec chmod 750 {} + || true

# Initialize database if it doesn't exist
if [ ! -f /var/www/api/database.sqlite ]; then
    echo "Initializing database..."
    if ! php /var/www/api/init-db.php; then
        echo "ERROR: Database initialization failed. Check filesystem permissions and that the host mount is writable by the container." >&2
        ls -la /var/www || true
        ls -la /var/www/api || true
        exit 1
    fi
else
    echo "Database already exists, skipping initialization"
fi

# Ensure the sqlite file is writable by PHP-FPM
if [ -f /var/www/api/database.sqlite ]; then
    chown www-data:www-data /var/www/api/database.sqlite || true
    chmod 660 /var/www/api/database.sqlite || true
fi

# Set up health regeneration loop (every 5 seconds)
echo "Starting health regeneration background service..."

# Make sure regeneration script is executable
chmod +x /var/www/api/cron/regenerate-health.php

# Create log file
touch /var/log/regenerate.log

# Start regeneration loop in background
(while true; do
    /usr/local/bin/php /var/www/api/cron/regenerate-health.php >> /var/log/regenerate.log 2>&1
    sleep 5
done) &

echo "Health regeneration service started (runs every 5 seconds)"

# Ensure walker worker exists and start it
chmod +x /var/www/api/cron/process-walking.php || true
touch /var/log/walker.log || true
echo "Starting walker worker (daemon mode)..."
/usr/local/bin/php /var/www/api/cron/process-walking.php --daemon >> /var/log/walker.log 2>&1 &
echo "Walker worker started; logs: /var/log/walker.log"

# Start PHP-FPM
exec php-fpm
