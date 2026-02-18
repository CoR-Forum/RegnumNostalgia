#!/usr/bin/env python3
"""
Assemble V1 Ingame Map from 3x3 Grid
Stitches 9 tiles (1024x1024 each) into a 3072x3072 image, then upscales
to 6144x6144 so that 1 image pixel = 1 game coordinate unit.

This 1:1 mapping is required for the Leaflet tile layer to align with the
game's 6144x6144 coordinate system without any coordinate transformations.

Tile naming: {row}-{col}.png
  Row 1 = top, Row 3 = bottom
  Col 1 = left, Col 3 = right

Grid layout:
  1-1.png  1-2.png  1-3.png
  2-1.png  2-2.png  2-3.png
  3-1.png  3-2.png  3-3.png
"""

import os
import sys
from PIL import Image

# Configuration
# When running in Docker, tiles-v1/ is mounted at /app/tiles-v1-source/
# When running locally, use relative path from this script
TILE_DIR = os.environ.get("TILE_DIR", os.path.join(os.path.dirname(__file__), "..", "public", "assets", "tiles-v1"))
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", os.path.dirname(__file__))
TILE_SIZE = 1024
GRID_ROWS = 3
GRID_COLS = 3
ASSEMBLED_SIZE = TILE_SIZE * GRID_COLS  # 3072
GAME_SIZE = 6144  # Game coordinate space — upscale target
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "v1-map-6144x6144.png")


def assemble_map():
    """Assemble the full v1 map from 3x3 grid of tiles, then upscale to game size."""
    print(f"Assembling {GRID_ROWS}x{GRID_COLS} v1 map from {TILE_DIR}/")
    print(f"Assembled size: {ASSEMBLED_SIZE}x{ASSEMBLED_SIZE} pixels")
    print(f"Final output size: {GAME_SIZE}x{GAME_SIZE} pixels (2x Lanczos upscale)")
    print()

    output_image = Image.new("RGB", (ASSEMBLED_SIZE, ASSEMBLED_SIZE), color="black")

    tiles_loaded = 0
    tiles_missing = 0

    for row in range(1, GRID_ROWS + 1):
        for col in range(1, GRID_COLS + 1):
            tile_filename = f"{row}-{col}.png"
            tile_path = os.path.join(TILE_DIR, tile_filename)

            x_offset = (col - 1) * TILE_SIZE
            y_offset = (row - 1) * TILE_SIZE

            if os.path.exists(tile_path):
                tile = Image.open(tile_path)
                if tile.size != (TILE_SIZE, TILE_SIZE):
                    print(f"  Warning: {tile_filename} has size {tile.size}, resizing to {TILE_SIZE}x{TILE_SIZE}")
                    tile = tile.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
                output_image.paste(tile, (x_offset, y_offset))
                tiles_loaded += 1
                print(f"  Loaded {tile_filename} -> ({x_offset}, {y_offset})")
            else:
                print(f"  Missing: {tile_filename} -> using black placeholder")
                tiles_missing += 1

    print()
    print(f"Assembly complete!")
    print(f"  Tiles loaded: {tiles_loaded}")
    print(f"  Tiles missing: {tiles_missing}")
    print(f"  Total: {tiles_loaded + tiles_missing}/{GRID_ROWS * GRID_COLS}")
    print()

    # Upscale from 3072x3072 to 6144x6144 using Lanczos resampling
    # This ensures 1 image pixel = 1 game coordinate unit
    print(f"Upscaling {ASSEMBLED_SIZE}x{ASSEMBLED_SIZE} -> {GAME_SIZE}x{GAME_SIZE} (Lanczos)...")
    output_image = output_image.resize((GAME_SIZE, GAME_SIZE), Image.LANCZOS)
    print(f"Upscale complete.")
    print()

    print(f"Saving to {OUTPUT_FILE}...")
    output_image.save(OUTPUT_FILE, "PNG", optimize=False)

    file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"Saved! File size: {file_size_mb:.2f} MB")
    print(f"Dimensions: {output_image.size[0]}x{output_image.size[1]} pixels")
    print()
    print("Next steps:")
    print(f"  1. cd MapGenerator")
    print(f"  2. ln -sf v1-map-6144x6144.png source-map.png")
    print(f"  3. Run tile generation with zoom 0-5:")
    print(f"     docker run --rm \\")
    print(f'       -v "$(pwd)/source-map.png:/app/source-map.png:ro" \\')
    print(f'       -v "$(pwd)/tiles-v1:/app/tiles" \\')
    print(f"       -e ZOOM_RANGE=0-5 \\")
    print(f"       regnum-tile-generator")


if __name__ == "__main__":
    if not os.path.exists(TILE_DIR):
        print(f"Error: Tile directory '{TILE_DIR}' not found!")
        print(f"Current directory: {os.getcwd()}")
        sys.exit(1)

    available_tiles = [f for f in os.listdir(TILE_DIR) if f.endswith(".png")]
    print(f"Found {len(available_tiles)} tile files in {TILE_DIR}/")
    print(f"Files: {sorted(available_tiles)}")
    print()

    assemble_map()
