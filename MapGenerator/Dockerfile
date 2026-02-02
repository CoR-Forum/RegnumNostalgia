# Use Ubuntu as base image for better GDAL support
FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-gdal \
    gdal-bin \
    libgdal-dev \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for GDAL
ENV GDAL_ALLOW_LARGE_LIBJPEG_MEM_ALLOC=1
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# Set working directory
WORKDIR /app

# Copy the generation scripts (source-map.png will be mounted at runtime)
COPY generate-tiles.sh .
COPY gdal2tiles.py .

# Make the script executable
RUN chmod +x generate-tiles.sh

# Create tiles directory
RUN mkdir -p tiles

# Default command
CMD ["./generate-tiles.sh"]