const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { screenshotsDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const { SCREENSHOTS_API_URL, SCREENSHOTS_API_KEY } = require('../config/constants');
const logger = require('../config/logger');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/**
 * GET /screenshots
 * Returns all screenshots metadata from SQLite
 */
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const db = screenshotsDb();
    
    db.all(
      `SELECT id, filename, name_en, name_de, name_es, description_en, description_de, description_es,
              location, visible_characters, x, y, uploaded_by, uploaded_at, updated_at
       FROM screenshots
       ORDER BY uploaded_at DESC`,
      [],
      (err, rows) => {
        if (err) {
          logger.error('Failed to get screenshots', { error: err.message });
          return res.status(500).json({ error: 'Internal server error' });
        }

        res.json({ screenshots: rows });
      }
    );

  } catch (error) {
    logger.error('Failed to get screenshots', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /screenshots
 * Uploads screenshot to external API and stores metadata in SQLite
 */
router.post('/', authenticateJWT, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const {
    name_en, name_de, name_es,
    description_en, description_de, description_es,
    location, visible_characters, x, y
  } = req.body;

  try {
    // Upload to external API
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const uploadResponse = await axios.post(
      `${SCREENSHOTS_API_URL}?action=upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'X-API-KEY': SCREENSHOTS_API_KEY
        }
      }
    );

    if (!uploadResponse.data || !uploadResponse.data.ok) {
      throw new Error('Upload to external API failed');
    }

    const filename = uploadResponse.data.saved_as;

    // Store metadata in SQLite
    const db = screenshotsDb();
    
    db.run(
      `INSERT INTO screenshots 
       (filename, name_en, name_de, name_es, description_en, description_de, description_es,
        location, visible_characters, x, y, uploaded_by, uploaded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        filename, name_en, name_de, name_es,
        description_en, description_de, description_es,
        location, visible_characters,
        x ? parseFloat(x) : null,
        y ? parseFloat(y) : null,
        req.user.username
      ],
      function(err) {
        if (err) {
          logger.error('Failed to save screenshot metadata', { error: err.message });
          return res.status(500).json({ error: 'Failed to save metadata' });
        }

        logger.info('Screenshot uploaded', { 
          id: this.lastID,
          filename,
          uploadedBy: req.user.username
        });

        res.json({ 
          success: true, 
          id: this.lastID,
          filename
        });
      }
    );

  } catch (error) {
    logger.error('Failed to upload screenshot', { 
      error: error.message,
      userId: req.user.userId
    });
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * PUT /screenshots/:id
 * Updates screenshot metadata
 */
router.put('/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const {
    name_en, name_de, name_es,
    description_en, description_de, description_es,
    location, visible_characters, x, y
  } = req.body;

  try {
    const db = screenshotsDb();

    db.run(
      `UPDATE screenshots
       SET name_en = ?, name_de = ?, name_es = ?,
           description_en = ?, description_de = ?, description_es = ?,
           location = ?, visible_characters = ?, x = ?, y = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        name_en, name_de, name_es,
        description_en, description_de, description_es,
        location, visible_characters,
        x ? parseFloat(x) : null,
        y ? parseFloat(y) : null,
        id
      ],
      function(err) {
        if (err) {
          logger.error('Failed to update screenshot', { error: err.message, id });
          return res.status(500).json({ error: 'Update failed' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Screenshot not found' });
        }

        logger.info('Screenshot updated', { id, userId: req.user.userId });
        res.json({ success: true });
      }
    );

  } catch (error) {
    logger.error('Failed to update screenshot', { error: error.message, id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /screenshots/:id
 * Deletes screenshot metadata (file remains on external server)
 */
router.delete('/:id', authenticateJWT, async (req, res) => {
  const { id } = req.params;

  try {
    const db = screenshotsDb();

    db.run(
      'DELETE FROM screenshots WHERE id = ?',
      [id],
      function(err) {
        if (err) {
          logger.error('Failed to delete screenshot', { error: err.message, id });
          return res.status(500).json({ error: 'Delete failed' });
        }

        if (this.changes === 0) {
          return res.status(404).json({ error: 'Screenshot not found' });
        }

        logger.info('Screenshot deleted', { id, userId: req.user.userId });
        res.json({ success: true });
      }
    );

  } catch (error) {
    logger.error('Failed to delete screenshot', { error: error.message, id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
