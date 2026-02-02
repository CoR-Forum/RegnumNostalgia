#!/usr/bin/env python3
"""
Assemble Original Regnum Online Map Tiles
Stitches 18x18 grid of 1024x1024 tiles into a single 18432x18432 image

Tile layout: Column-by-column, top-to-bottom
- Column 1: tiles 75879-75896 (18 tiles)
- Column 2: tiles 75897-75914 (18 tiles)
- ...continuing...
- Column 18: tiles 76185-76202 (18 tiles)

Missing tiles: 76009, 76027 (both in row 5)
"""

import os
from PIL import Image
import sys

# Configuration
TILE_DIR = "original-map"
TILE_SIZE = 1024
GRID_SIZE = 18
OUTPUT_SIZE = TILE_SIZE * GRID_SIZE  # 18432
START_TILE = 75879
END_TILE = 76202
MISSING_TILES = [76009, 76027]
OUTPUT_FILE = "original-map-18432x18432.png"

def create_blank_tile():
    """Create a black placeholder tile for missing tiles"""
    return Image.new('RGB', (TILE_SIZE, TILE_SIZE), color='black')

def assemble_map():
    """Assemble the full map from individual tiles"""
    print(f"Assembling {GRID_SIZE}x{GRID_SIZE} map from {TILE_DIR}/")
    print(f"Output size: {OUTPUT_SIZE}x{OUTPUT_SIZE} pixels")
    print(f"Missing tiles: {MISSING_TILES}")
    print()

    # Create the output image
    output_image = Image.new('RGB', (OUTPUT_SIZE, OUTPUT_SIZE), color='black')

    tile_num = START_TILE
    tiles_processed = 0
    tiles_missing = 0

    # Column-by-column, top-to-bottom layout
    for col in range(GRID_SIZE):
        for row in range(GRID_SIZE):
            tile_filename = f"{tile_num}.jpg"
            tile_path = os.path.join(TILE_DIR, tile_filename)

            # Calculate position in output image
            x_offset = col * TILE_SIZE
            y_offset = row * TILE_SIZE

            # Load tile or use placeholder
            if tile_num in MISSING_TILES:
                print(f"  Missing tile {tile_num} at column {col+1}, row {row+1} - using black placeholder")
                tile = create_blank_tile()
                tiles_missing += 1
            elif os.path.exists(tile_path):
                tile = Image.open(tile_path)
                # Verify tile size
                if tile.size != (TILE_SIZE, TILE_SIZE):
                    print(f"  Warning: tile {tile_num} has unexpected size {tile.size}, resizing...")
                    tile = tile.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
                tiles_processed += 1
            else:
                print(f"  Warning: tile {tile_num} not found at {tile_path} - using black placeholder")
                tile = create_blank_tile()
                tiles_missing += 1

            # Paste tile into output image
            output_image.paste(tile, (x_offset, y_offset))

            # Progress indicator
            if (tiles_processed + tiles_missing) % 50 == 0:
                print(f"  Processed {tiles_processed + tiles_missing}/{GRID_SIZE * GRID_SIZE} tiles...")

            tile_num += 1

    print()
    print(f"Assembly complete!")
    print(f"  Tiles processed: {tiles_processed}")
    print(f"  Missing/placeholder tiles: {tiles_missing}")
    print(f"  Total tiles: {tiles_processed + tiles_missing}/{GRID_SIZE * GRID_SIZE}")
    print()

    # Save the output image
    print(f"Saving to {OUTPUT_FILE}...")
    output_image.save(OUTPUT_FILE, "PNG", optimize=False)

    # Get file size
    file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"Saved! File size: {file_size_mb:.2f} MB")
    print()
    print(f"Output: {OUTPUT_FILE}")
    print(f"Dimensions: {output_image.size[0]}x{output_image.size[1]} pixels")

if __name__ == "__main__":
    # Check if tile directory exists
    if not os.path.exists(TILE_DIR):
        print(f"Error: Tile directory '{TILE_DIR}' not found!")
        print(f"Current directory: {os.getcwd()}")
        sys.exit(1)

    # Count available tiles
    available_tiles = len([f for f in os.listdir(TILE_DIR) if f.endswith('.jpg')])
    print(f"Found {available_tiles} tile files in {TILE_DIR}/")
    print()

    # Assemble the map
    assemble_map()
