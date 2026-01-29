FROM php:8.2-fpm-alpine

# Install system dependencies
RUN apk add --no-cache \
    sqlite-dev \
    mariadb-client \
    mariadb-dev \
    busybox-extras \
    $PHPIZE_DEPS

# Install PHP extensions
RUN docker-php-ext-install pdo pdo_sqlite mysqli pdo_mysql

WORKDIR /var/www/api

# Keep default php-fpm entrypoint; custom entrypoint is provided by docker-compose
