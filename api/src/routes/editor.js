const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const logger = require('../config/logger');

const REGIONS_FILE = path.join(__dirname, '../../gameData/regions.json');
const PATHS_FILE = path.join(__dirname, '../../gameData/paths.json');
const WALLS_FILE = path.join(__dirname, '../../gameData/walls.json');

// Helper function to read JSON file
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Error reading ${filePath}:`, error);
    throw error;
  }
}

// Helper function to write JSON file
async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    logger.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}

// ==================== REGIONS ====================

// GET all regions
router.get('/regions', async (req, res) => {
  try {
    const regions = await readJsonFile(REGIONS_FILE);
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load regions' });
  }
});

// GET single region by id
router.get('/regions/:id', async (req, res) => {
  try {
    const regions = await readJsonFile(REGIONS_FILE);
    const region = regions.find(r => r.id === req.params.id);
    if (!region) {
      return res.status(404).json({ error: 'Region not found' });
    }
    res.json(region);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load region' });
  }
});

// POST create new region
router.post('/regions', async (req, res) => {
  try {
    const regions = await readJsonFile(REGIONS_FILE);
    const newRegion = req.body;
    
    // Validate required fields
    if (!newRegion.id || !newRegion.name) {
      return res.status(400).json({ error: 'Region must have id and name' });
    }
    
    // Check for duplicate id
    if (regions.find(r => r.id === newRegion.id)) {
      return res.status(400).json({ error: 'Region with this id already exists' });
    }
    
    regions.push(newRegion);
    await writeJsonFile(REGIONS_FILE, regions);
    
    logger.info(`Region created: ${newRegion.id}`);
    res.status(201).json(newRegion);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create region' });
  }
});

// PUT update existing region
router.put('/regions/:id', async (req, res) => {
  try {
    const regions = await readJsonFile(REGIONS_FILE);
    const index = regions.findIndex(r => r.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Region not found' });
    }
    
    const updatedRegion = { ...regions[index], ...req.body, id: req.params.id };
    regions[index] = updatedRegion;
    
    await writeJsonFile(REGIONS_FILE, regions);
    
    logger.info(`Region updated: ${req.params.id}`);
    res.json(updatedRegion);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update region' });
  }
});

// DELETE region
router.delete('/regions/:id', async (req, res) => {
  try {
    const regions = await readJsonFile(REGIONS_FILE);
    const index = regions.findIndex(r => r.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Region not found' });
    }
    
    regions.splice(index, 1);
    await writeJsonFile(REGIONS_FILE, regions);
    
    logger.info(`Region deleted: ${req.params.id}`);
    res.json({ message: 'Region deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete region' });
  }
});

// ==================== PATHS ====================

// GET all paths
router.get('/paths', async (req, res) => {
  try {
    const paths = await readJsonFile(PATHS_FILE);
    res.json(paths);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load paths' });
  }
});

// GET single path by id
router.get('/paths/:id', async (req, res) => {
  try {
    const paths = await readJsonFile(PATHS_FILE);
    const path = paths.find(p => p.id === req.params.id);
    if (!path) {
      return res.status(404).json({ error: 'Path not found' });
    }
    res.json(path);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load path' });
  }
});

// POST create new path
router.post('/paths', async (req, res) => {
  try {
    const paths = await readJsonFile(PATHS_FILE);
    const newPath = req.body;
    
    // Validate required fields
    if (!newPath.id || !newPath.name) {
      return res.status(400).json({ error: 'Path must have id and name' });
    }
    
    // Check for duplicate id
    if (paths.find(p => p.id === newPath.id)) {
      return res.status(400).json({ error: 'Path with this id already exists' });
    }
    
    // Ensure positions array exists
    if (!newPath.positions) {
      newPath.positions = [];
    }
    
    // Ensure loop property exists
    if (typeof newPath.loop === 'undefined') {
      newPath.loop = false;
    }
    
    paths.push(newPath);
    await writeJsonFile(PATHS_FILE, paths);
    
    logger.info(`Path created: ${newPath.id}`);
    res.status(201).json(newPath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create path' });
  }
});

// PUT update existing path
router.put('/paths/:id', async (req, res) => {
  try {
    const paths = await readJsonFile(PATHS_FILE);
    const index = paths.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    const updatedPath = { ...paths[index], ...req.body, id: req.params.id };
    paths[index] = updatedPath;
    
    await writeJsonFile(PATHS_FILE, paths);
    
    logger.info(`Path updated: ${req.params.id}`);
    res.json(updatedPath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update path' });
  }
});

// DELETE path
router.delete('/paths/:id', async (req, res) => {
  try {
    const paths = await readJsonFile(PATHS_FILE);
    const index = paths.findIndex(p => p.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    paths.splice(index, 1);
    await writeJsonFile(PATHS_FILE, paths);
    
    logger.info(`Path deleted: ${req.params.id}`);
    res.json({ message: 'Path deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete path' });
  }
});

// ==================== WALLS ====================

// GET all walls
router.get('/walls', async (req, res) => {
  try {
    const walls = await readJsonFile(WALLS_FILE);
    res.json(walls);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load walls' });
  }
});

// GET single wall by id
router.get('/walls/:id', async (req, res) => {
  try {
    const walls = await readJsonFile(WALLS_FILE);
    const wall = walls.find(w => w.id === req.params.id);
    if (!wall) {
      return res.status(404).json({ error: 'Wall not found' });
    }
    res.json(wall);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load wall' });
  }
});

// POST create new wall
router.post('/walls', async (req, res) => {
  try {
    const walls = await readJsonFile(WALLS_FILE);
    const newWall = req.body;
    
    // Validate required fields
    if (!newWall.id || !newWall.name) {
      return res.status(400).json({ error: 'Wall must have id and name' });
    }
    
    // Check for duplicate id
    if (walls.find(w => w.id === newWall.id)) {
      return res.status(400).json({ error: 'Wall with this id already exists' });
    }
    
    // Ensure positions array exists
    if (!newWall.positions) {
      newWall.positions = [];
    }
    
    walls.push(newWall);
    await writeJsonFile(WALLS_FILE, walls);
    
    logger.info(`Wall created: ${newWall.id}`);
    res.status(201).json(newWall);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create wall' });
  }
});

// PUT update existing wall
router.put('/walls/:id', async (req, res) => {
  try {
    const walls = await readJsonFile(WALLS_FILE);
    const index = walls.findIndex(w => w.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Wall not found' });
    }
    
    const updatedWall = { ...walls[index], ...req.body, id: req.params.id };
    walls[index] = updatedWall;
    
    await writeJsonFile(WALLS_FILE, walls);
    
    logger.info(`Wall updated: ${req.params.id}`);
    res.json(updatedWall);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update wall' });
  }
});

// DELETE wall
router.delete('/walls/:id', async (req, res) => {
  try {
    const walls = await readJsonFile(WALLS_FILE);
    const index = walls.findIndex(w => w.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Wall not found' });
    }
    
    walls.splice(index, 1);
    await writeJsonFile(WALLS_FILE, walls);
    
    logger.info(`Wall deleted: ${req.params.id}`);
    res.json({ message: 'Wall deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete wall' });
  }
});

module.exports = router;
