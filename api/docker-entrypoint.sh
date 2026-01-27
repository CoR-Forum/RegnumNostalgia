#!/bin/sh
set -e

# Install system dependencies for SQLite and cron
apk add --no-cache sqlite-dev dcron

# Install PDO SQLite extension
docker-php-ext-install pdo pdo_sqlite

# Initialize database if it doesn't exist
if [ ! -f /var/www/api/database.sqlite ]; then
    echo "Initializing database..."
    php /var/www/api/init-db.php
else
    echo "Database already exists, skipping initialization"
fi

# Set up cron job for health regeneration
echo "Setting up cron jobs..."
echo "* * * * * /usr/local/bin/php /var/www/api/cron/regenerate-health.php >> /var/log/cron.log 2>&1" > /etc/crontabs/root

# Make sure cron script is executable
chmod +x /var/www/api/cron/regenerate-health.php

# Create log file for cron
touch /var/log/cron.log

# Start crond in background
crond -b -l 2

echo "Cron daemon started"

# Start PHP-FPM
exec php-fpm
