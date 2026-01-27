#!/bin/sh
set -e

# Install system dependencies for SQLite
apk add --no-cache sqlite-dev

# Install PDO SQLite extension
docker-php-ext-install pdo pdo_sqlite

# Initialize database if it doesn't exist
if [ ! -f /var/www/api/database.sqlite ]; then
    echo "Initializing database..."
    php /var/www/api/init-db.php
else
    echo "Database already exists, skipping initialization"
fi

# Ensure the application directory and sqlite file are writable by PHP-FPM
# (PHP-FPM typically runs as www-data inside the official images)
if [ -f /var/www/api/database.sqlite ]; then
    chown www-data:www-data /var/www/api/database.sqlite || true
    chmod 660 /var/www/api/database.sqlite || true
fi
chown -R www-data:www-data /var/www/api || true
find /var/www/api -type d -exec chmod 750 {} + || true

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

# Start PHP-FPM
exec php-fpm
