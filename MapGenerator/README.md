# Docker Setup for Regnum Online Map Tile Generation

This guide explains how to use Docker to generate map tiles for the Regnum Online Interactive Map project, eliminating the need to install GDAL and Python dependencies on your local machine.

## 🗺️ Map Coordinate System

The Regnum Online map uses a specific coordinate system based on the original game design:

### Coordinate Specifications
- **Map dimensions:** 6144 × 6144 game units
- **Chunk system:** 48 × 48 chunks, each 128 × 128 units (48 × 128 = 6144)
- **Original-map image dimensions:** 18432 × 18432 pixels (3× resolution for better zoom detail)
- **V1-map image dimensions:** 6144 × 6144 pixels (1:1 with game coords, upscaled from 3072×3072)
- **Scale factor (original-map):** 3.0 (image pixels / game coordinates)
- **Scale factor (v1-map):** 1.0 (image pixels = game coordinates)

### Original Map Source
- **Original tiles:** 18 × 18 grid of 1024×1024 tiles (from original game)
- **Total original resolution:** 18,432 × 18,432 pixels
- **Missing tiles:** 2 tiles (76009.jpg, 76027.jpg) - replaced with black placeholders
- **Assembly script:** `assemble-original-map.py` reconstructs the full map from tiles

### Coordinate Transformation
- **Game coordinates → Image pixels:** Multiply by 3.0 (e.g., game position 1000 = image pixel 3000)
- **Image pixels → Game coordinates:** Divide by 3.0
- **NPC/Player positions:** Stored in game coordinates (0-6144 range)
- **Display:** Client transforms game coordinates to image coordinates automatically

## 🐳 Quick Start

### Prerequisites
- Docker installed on your system
- Source map image or original tiles
- Python 3 with Pillow (for assembly scripts)

### V1 Map Assembly from Ingame Tiles (3×3 Grid)

The v1 ingame map consists of 9 PNG tiles in a 3×3 grid (each 1024×1024). The assembly
script stitches them into a single image and upscales to 6144×6144 (1:1 with game coords).

1. **Ensure tiles are in place:** `public/assets/tiles-v1/1-1.png` through `3-3.png`

2. **Build and run everything in Docker:**
   ```bash
   cd MapGenerator
   docker build -t regnum-tile-generator .
   docker run --rm \
     -v "$(pwd)/../public/assets/tiles-v1:/app/tiles-v1-source:ro" \
     -v "$(pwd)/tiles-v1:/app/tiles" \
     -v "$(pwd)/tiles-v1-compressed:/app/tiles-compressed" \
     -e TILE_DIR=/app/tiles-v1-source \
     -e OUTPUT_DIR=/app \
     -e ZOOM_RANGE=0-5 \
     regnum-tile-generator bash -c \
       "python3 assemble-v1-map.py && ln -sf v1-map-6144x6144.png source-map.png && ./generate-tiles.sh"
   ```
   This assembles the 3×3 grid → upscales to 6144×6144 → generates ~770 tiles (zoom 0-5) in two variants:
   - `tiles-v1/` — original quality PNGs
   - `tiles-v1-compressed/` — lossy-compressed PNGs (pngquant, 65-80% quality)

3. **Upload to CDN** at `https://cor-forum.de/regnum/RegnumNostalgia/map/tiles-v1/`
   Use the compressed version for better load times, or the original for maximum quality.

The frontend uses `leaflet-rastercoords` + `L.tileLayer` with URL pattern `tiles-v1/{z}/{x}/{y}.png`.

### Map Assembly from Original Tiles (18×18 Grid)

If you have the original 18×18 grid of tiles:

1. **Assemble the original high-resolution map:**
   ```bash
   python3 assemble-original-map.py
   ```

   This creates `original-map-18432x18432.png` (230 MB) from 322 tiles in the `original-map/` directory.

2. **Create symlink for tile generation:**
   ```bash
   ln -s original-map-18432x18432.png source-map.png
   ```

### Image Preparation from Other Sources

If you need to resize an existing map:

1. **Install ImageMagick:**
   ```bash
   brew install imagemagick
   ```

2. **Resize to correct dimensions (18432×18432):**
   ```bash
   magick your-map.png -resize 18432x18432 -filter Lanczos source-map.png
   ```

   > ⚠️ **Important:** Always use Lanczos filter for map scaling to preserve details and avoid artifacts.

### Simple Usage

1. **Build Docker image:**
   ```bash
   docker build -t regnum-tile-generator .
   ```

2. **Generate tiles:**
   ```bash
   docker run --rm \
     -v "$(pwd)/source-map.png:/app/source-map.png:ro" \
     -v "$(pwd)/tiles:/app/tiles" \
     regnum-tile-generator
   ```

   Use `-e ZOOM_RANGE=0-5` to override the default zoom range (0-9) for smaller source images.

3. **That's it!** The script will:
   - Process the source map
   - Generate tiles for the specified zoom levels (default 0-9 for 18432×18432)
   - Save tiles to the `./tiles` directory

## 📋 Map Files Overview

### Source Files
- `original-map/` - Directory with 322 original 1024×1024 tiles (75879.jpg - 76202.jpg)
- `assemble-original-map.py` - Python script to reconstruct full 18432×18432 map from original tiles
- `assemble-v1-map.py` - Python script to stitch 3×3 v1 tiles and upscale to 6144×6144
- `original-map-18432x18432.png` - Full assembled original map (230 MB)
- `v1-map-6144x6144.png` - Assembled v1 ingame map (~70 MB)
- `source-map.png` - Symlink pointing to the active source map

### Generated Files
- `tiles/` - Directory containing all generated Leaflet tiles (original map)
- `tiles-v1/` - Directory containing v1 Leaflet tiles (zoom 0-5)
- `tiles/{z}/{x}/{y}.png` - Individual tile files organized by zoom level

## 🛠️ Manual Docker Commands

### Build the image:
```bash
docker build -t regnum-tile-generator .
```

### Run tile generation:
```bash
docker run --rm \
  -v "$(pwd)/source-map.png:/app/source-map.png:ro" \
  -v "$(pwd)/tiles:/app/tiles" \
  regnum-tile-generator
```

### Interactive shell for debugging:
```bash
docker run --rm -it \
  -v "$(pwd):/app" \
  regnum-tile-generator bash
```

## 📁 File Structure

The Docker setup includes these files:

- `Dockerfile` - Docker image definition with GDAL and Python
- `generate-tiles.sh` - Main tile generation script (supports configurable `ZOOM_RANGE`)
- `gdal2tiles.py` - GDAL tool for tile generation (Leaflet-optimized)
- `assemble-original-map.py` - Script to reconstruct 18432×18432 map from 322 original tiles
- `assemble-v1-map.py` - Script to stitch 3×3 v1 ingame tiles and upscale to 6144×6144
- `.dockerignore` - Optimizes Docker build process

## 🔧 Technical Details

### Docker Environment
- **Base Image:** Ubuntu 22.04
- **Python:** Python 3 with GDAL bindings and Pillow (PIL)
- **GDAL:** Full raster processing support with Leaflet optimization
- **Memory:** Optimized for large image processing (18432×18432)

### Volume Mounts
- `./source-map.png` → `/app/source-map.png` (read-only)
- `./tiles` → `/app/tiles` (read-write for output)
- Scripts are copied during build (not mounted)

### Environment Variables
- `GDAL_ALLOW_LARGE_LIBJPEG_MEM_ALLOC=1` - Enable large JPEG processing
- `GDAL_CACHEMAX=512` - Set GDAL memory cache to 512 MB
- `ZOOM_RANGE` - Override tile generation zoom levels (default: `0-9`). Use `0-5` for 6144×6144 images.

### Tile Generation Settings
- **Zoom levels:** Configurable via `ZOOM_RANGE` env var (default 0-9)
  - 18432×18432 source: use `0-9` (10 levels, ~110k tiles)
  - 6144×6144 source: use `0-5` (6 levels, ~700 tiles)
- **Tile size:** 256×256 pixels (Leaflet standard)
- **Profile:** Raster (simple image tiles, not geographic projection)
- **Format:** PNG with optimization

## 🚀 Performance Details

### Original Map Processing (18432×18432)
- **Input:** 18432×18432 PNG (230 MB)
- **Output:** ~110,604 tile files across 10 zoom levels
- **Generation time:** ~15-20 minutes (depending on system)
- **Disk space:** ~500 MB for all tiles

### V1 Map Processing (6144×6144)
- **Input:** 6144×6144 PNG (~70 MB)
- **Output:** ~700 tile files across 6 zoom levels (0-5)
- **Generation time:** ~1-2 minutes
- **Disk space:** ~30 MB for all tiles

### Zoom Level Breakdown
- **Zoom 0:** 1 tile (full map view)
- **Zoom 1:** 4 tiles (2×2 grid)
- **Zoom 2:** 16 tiles (4×4 grid)
- **...continues exponentially...**
- **Zoom 9:** 262,144 theoretical tiles (only visible areas generated)

### RasterCoords Calculation
For the 18432×18432 image with 256px tiles:
```
zoom = ceil(log(18432 / 256) / log(2))
     = ceil(log(72) / log(2))
     = ceil(6.169)
     = 7
```
The RasterCoords plugin uses zoom level 7 for coordinate transformations.

## 🏗️ Generated Output

After successful tile generation:
- Tiles are saved to `./tiles` directory
- Directory structure: `tiles/{z}/{x}/{y}.png`
- Zoom levels 0-9 are generated
- Total tile count displayed in generation output

## 🔍 Troubleshooting

### Common Issues:

1. **Missing source-map.png:**
   ```
   Error: source-map.png not found!
   ```
   **Solution:** Create symlink or copy your source map to `source-map.png`
   ```bash
   ln -s original-map-18432x18432.png source-map.png
   ```

2. **Docker not running:**
   ```
   Cannot connect to Docker daemon
   ```
   **Solution:** Start Docker Desktop or Docker service

3. **Coordinate misalignment (NPCs/players in wrong positions):**
   - Verify `imageDimensions: [18432, 18432]` in app.js
   - Verify `scaleX = 3.0` and `scaleY = 3.0` are calculated correctly
   - Check RasterCoords is using `this.zoomLevel()` not hardcoded value

4. **Memory issues with large images:**
   - The Docker container is configured for 18432×18432 processing
   - Increase Docker Desktop memory limit to 4GB+ if needed

5. **Wrong map dimensions:**
   - Original game: 6144×6144 game coordinates (48 chunks × 128 units)
   - Image should be: 18432×18432 pixels (3× scale factor)
   - NOT 6157×6192 (this was incorrect scaling from previous version)

### Debug Mode:
```bash
docker run --rm -it -v "$(pwd):/app" regnum-tile-generator bash
```

## 📊 Coordinate System Validation

To verify your coordinate system is correct:

1. **Check NPC position display:**
   - NPC "Irehok" is at game coordinates: `x: 1156, y: 4592`
   - When standing at that location, player should see: `Location: 1156, 4592`
   - NPC marker should appear at the player's position

2. **Verify scale factors:**
   ```javascript
   // In app.js
   gameDimensions: [6144, 6144]      // Game coordinates
   imageDimensions: [18432, 18432]   // Image pixels (3× scale)
   scaleX: 18432 / 6144 = 3.0        // Transformation factor
   ```

3. **Check RasterCoords:**
   ```javascript
   // In rastercoords.js - should use calculated zoom, not hardcoded
   this.zoom = this.zoomLevel()  // ✓ Correct
   this.zoom = 5.420             // ✗ Wrong - causes offset issues
   ```

## 🧹 Cleanup

Remove generated tiles:
```bash
rm -rf tiles/
```

Remove Docker image:
```bash
docker rmi regnum-tile-generator
```

## 📖 Key Lessons Learned

### Critical Fixes Applied
1. **Fixed hardcoded zoom:** Changed from `5.420` to calculated `this.zoomLevel()`
2. **Correct map dimensions:** Using 6144×6144 game coords, 18432×18432 image pixels
3. **Proper scale factors:** Automatically calculated as 3.0 from dimensions
4. **Tile generation:** Generates 0-9 zoom levels from 18432×18432 source
5. **Original tiles preserved:** Assembled from 322 original 1024×1024 tiles

### Coordinate System Rules
- **Server:** Always uses 6144×6144 game coordinates
- **Client:** Transforms to 18432×18432 for display (multiply by 3.0)
- **NPCs/Players:** Positions stored in 6144×6144 coordinate space
- **Tiles:** Generated from 18432×18432 for maximum detail

---

The Docker setup ensures consistent, reliable tile generation with proper coordinate system alignment for the Regnum Online map.
