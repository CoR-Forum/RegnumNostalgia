#!/bin/bash

# Docker-optimized tile generation script for Regnum Online Interactive Map
# This script runs inside a Docker container with GDAL pre-installed

set -e  # Exit on any error

echo "🚀 Starting tile generation for Regnum Online Map..."
echo "Docker environment detected - GDAL is pre-installed"

# Check if source map exists
if [ ! -f "source-map.png" ]; then
    echo "❌ Error: source-map.png not found!"
    echo "Please ensure source-map.png is in the project root directory."
    exit 1
fi

# Get the gdal2tiles.py tool if not present
if [ ! -f "gdal2tiles.py" ]; then
    echo "📥 Downloading gdal2tiles.py..."
    curl -L https://raw.githubusercontent.com/Joshua2504/gdal2tiles-leaflet/master/gdal2tiles.py \
         -o gdal2tiles.py
    if [ $? -ne 0 ]; then
        echo "❌ Failed to download gdal2tiles.py"
        exit 1
    fi
    echo "✅ Downloaded gdal2tiles.py successfully"
fi

# Ensure tiles directory exists and is writable
mkdir -p tiles
chmod 755 tiles

# Set GDAL environment variables for performance
export GDAL_ALLOW_LARGE_LIBJPEG_MEM_ALLOC=1
export GDAL_CACHEMAX=512

echo "🔧 Processing source-map.png..."
echo "📊 Generating tiles for zoom levels 0-9 (10 total levels)..."

# Generate tiles with optimized settings for Docker
python3 ./gdal2tiles.py -l -p raster -z 0-9 -w none source-map.png tiles

if [ $? -eq 0 ]; then
    echo "✅ Tile generation completed successfully!"
    echo "📁 Tiles saved in ./tiles directory"
    echo "🌐 You can now open 'index.html' in your browser to view the map"
    
    # Count generated tiles for verification
    TILE_COUNT=$(find tiles -name "*.png" | wc -l)
    echo "📈 Generated $TILE_COUNT tile files"
else
    echo "❌ Tile generation failed!"
    exit 1
fi