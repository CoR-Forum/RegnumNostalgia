# Docker Setup for Regnum Online Map Tile Generation

This guide explains how to use Docker to generate map tiles for the Regnum Online Interactive Map project, eliminating the need to install GDAL and Python dependencies on your local machine.

## 🗺️ Map Coordinate System

The Regnum Online map uses a specific coordinate system based on the original game design:

### Coordinate Specifications
- **Map dimensions:** 6144 × 6144 game units
- **Chunk system:** 48 × 48 chunks, each 128 × 128 units (48 × 128 = 6144)
- **Image dimensions:** 18432 × 18432 pixels (3× resolution for better zoom detail)
- **Scale factor:** 3.0 (image pixels / game coordinates)

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
- ImageMagick (for image processing)

### Map Assembly from Original Tiles

If you have the original 18×18 grid of tiles:

1. **Assemble the original high-resolution map:**
   ```bash
   # (run this from the MapGenerator/ directory)
   python3 assemble-original-map.py
   ```

   This creates `original-map-18432x18432.png` (230 MB) from 322 tiles in the `original-map/` directory.

2. **Create symlink for tile generation:**
   ```bash
   ln -s original-map-18432x18432.png source-map.png
   ```

If the assembler reports missing tiles (for example `76009.jpg` or `76027.jpg`), create black 1024×1024 placeholders in `original-map/` before re-running the script:

```bash
# create a black 1024x1024 JPEG placeholder (requires ImageMagick)
magick -size 1024x1024 canvas:black original-map/76009.jpg
magick -size 1024x1024 canvas:black original-map/76027.jpg
# then re-run the assembler
python3 assemble-original-map.py
```

The tiles in `original-map/` should match the original filenames (e.g. `75879.jpg`..`76202.jpg`). The assembler stitches the 18×18 grid into `original-map-18432x18432.png` which the tile generator expects.

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
   -e GDAL_ALLOW_LARGE_LIBJPEG_MEM_ALLOC=1 \
   -e GDAL_CACHEMAX=512 \
   -v "$(pwd)/source-map.png:/app/source-map.png:ro" \
   -v "$(pwd)/tiles:/app/tiles" \
   regnum-tile-generator
```

3. **That's it!** The script will:
   - Process the 18432×18432 source map
   - Generate zoom levels 0-9 (10 total levels)
   - Save ~110,000+ tiles to the `./tiles` directory

## 📋 Map Files Overview

### Source Files
- `original-map/` - Directory with 322 original 1024×1024 tiles (75879.jpg - 76202.jpg)
- `assemble-original-map.py` - Python script to reconstruct full map from tiles
- `original-map-18432x18432.png` - Full assembled map (230 MB)
- `source-map.png` - Symlink pointing to the active source map

### Generated Files
- `tiles/` - Directory containing all generated Leaflet tiles
- `tiles/{z}/{x}/{y}.png` - Individual tile files organized by zoom level

## 🛠️ Manual Docker Commands

### Build the image:
```bash
docker build -t regnum-tile-generator .
```

### Run tile generation:
```bash
docker run --rm \
   -e GDAL_ALLOW_LARGE_LIBJPEG_MEM_ALLOC=1 \
   -e GDAL_CACHEMAX=512 \
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
- `generate-tiles.sh` - Main tile generation script
- `gdal2tiles.py` - GDAL tool for tile generation (Leaflet-optimized)
- `assemble-original-map.py` - Script to reconstruct map from original tiles
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

### Tile Generation Settings
- **Zoom levels:** 0-9 (10 total levels)
- **Tile size:** 256×256 pixels (Leaflet standard)
- **Profile:** Raster (simple image tiles, not geographic projection)
- **Format:** PNG with optimization

## 🚀 Performance Details

### Map Processing
- **Input:** 18432×18432 PNG (230 MB)
- **Output:** ~110,604 tile files across 10 zoom levels
- **Generation time:** ~15-20 minutes (depending on system)
- **Disk space:** ~500 MB for all tiles

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
