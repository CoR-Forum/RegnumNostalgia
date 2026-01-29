#!/bin/sh
set -e

# Ensure application directory exists and is writable before initializing DB
mkdir -p /var/www/api
chown -R www-data:www-data /var/www/api || true
find /var/www/api -type d -exec chmod 750 {} + || true

# Wait for MariaDB to be ready
echo "Waiting for MariaDB..."
db_ready=0
db_host="${GAME_DB_HOST:-db}"
db_port="${GAME_DB_PORT:-3306}"
db_user="${GAME_DB_USER:-regnum_user}"
db_pass="${GAME_DB_PASS:-regnum_pass}"
db_root_pass="${GAME_DB_ROOT_PASSWORD:-}"

for i in $(seq 1 60); do
    if command -v nc >/dev/null 2>&1; then
        if nc -z "$db_host" "$db_port"; then
            echo "MariaDB port is open"
            db_ready=1
            break
        fi
    fi

    if [ -n "$db_root_pass" ]; then
        if mariadb-admin ping -h "$db_host" -P "$db_port" -u root -p"$db_root_pass" --silent; then
            echo "MariaDB is up (root ping)"
            db_ready=1
            break
        fi
    fi

    if mariadb-admin ping -h "$db_host" -P "$db_port" -u "$db_user" -p"$db_pass" --silent; then
        echo "MariaDB is up (app user ping)"
        db_ready=1
        break
    fi

    sleep 1
done

if [ "$db_ready" -ne 1 ]; then
    echo "ERROR: MariaDB did not become ready in time." >&2
    exit 1
fi

# Initialize MariaDB schema (idempotent)
echo "Initializing MariaDB schema (if needed)..."
if ! php /var/www/api/init-db.php; then
    echo "ERROR: Database initialization failed." >&2
    exit 1
fi

# Set up health regeneration loop (every 1 second)
echo "Starting health regeneration background service..."

# Initialize screenshots DB if it doesn't exist
if [ ! -f /var/www/api/screenshots.sqlite ]; then
    echo "Initializing screenshots database..."
    if ! php /var/www/api/init-screenshots-db.php; then
        echo "ERROR: Screenshots DB initialization failed." >&2
        ls -la /var/www/api || true
        # don't exit the container; continue but log the error
    fi
else
    echo "Screenshots DB already exists, skipping initialization"
fi

# Ensure the screenshots sqlite file is writable by PHP-FPM
if [ -f /var/www/api/screenshots.sqlite ]; then
    chown www-data:www-data /var/www/api/screenshots.sqlite || true
    chmod 660 /var/www/api/screenshots.sqlite || true
fi

# Ensure the item templates sqlite file is writable by PHP-FPM
if [ -f /var/www/api/itemTemplates.sqlite ]; then
    chown www-data:www-data /var/www/api/itemTemplates.sqlite || true
    chmod 660 /var/www/api/itemTemplates.sqlite || true
fi

# Make sure regeneration script is executable
chmod +x /var/www/api/cron/regenerate-health.php

# Start regeneration loop in background (logs -> stdout/stderr)
(while true; do
    /usr/local/bin/php /var/www/api/cron/regenerate-health.php 2>&1
    sleep 1
done) &

echo "Health regeneration service started (runs every 1 second)"

# Start server-time cron (every 10 seconds)
chmod +x /var/www/api/cron/process-server-time.php || true
echo "Starting server-time cron (every 10 seconds)..."
(while true; do
    /usr/local/bin/php /var/www/api/cron/process-server-time.php 2>&1
    sleep 10
done) &
echo "Server-time cron started (logs -> stdout)"

# Start territory update cron (every 15 seconds)
chmod +x /var/www/api/cron/update-territories.php || true
echo "Starting territory update cron (every 15 seconds)..."
(while true; do
    /usr/local/bin/php /var/www/api/cron/update-territories.php 2>&1
    sleep 5
done) &
echo "Territory update cron started (logs -> stdout)"

# Ensure walker worker exists and start it
chmod +x /var/www/api/cron/process-walking.php || true
echo "Starting walker worker (daemon mode)..."
/usr/local/bin/php /var/www/api/cron/process-walking.php --daemon 2>&1 &
echo "Walker worker started (logs -> stdout)"

# Start level calculation cron (updates player.level every 10s)
chmod +x /var/www/api/cron.php || true
echo "Starting level cron (background)..."
/usr/local/bin/php /var/www/api/cron.php 2>&1 &
echo "Level cron started (logs -> stdout)"

# Start PHP-FPM
exec php-fpm

