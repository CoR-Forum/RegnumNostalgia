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

# Start PHP-FPM
exec php-fpm
