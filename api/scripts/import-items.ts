#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { gameDb } = require('../src/config/database');
const logger = require('../src/config/logger');

async function importItems() {
  try {
    // Check if items already exist
    const [rows] = await gameDb.query('SELECT COUNT(*) as count FROM items');
    if (rows[0].count > 0) {
      logger.info(`Items table already has ${rows[0].count} items — continuing import to add/update items`);
    }

    logger.info('Starting items import...');

    // In Docker: script is at /app/scripts, gameData is at /app/gameData
    const itemsDir = path.resolve(__dirname, '../gameData/items');
    
    const itemFiles = [
      'weapons.json',
      'armor.json',
      'consumables.json',
      'currency.json',
      'misc.json',
      'alasthor.json',
      'tenax.json',
      'vesper.json',
      'magicgems.json',
      'premium.json',
      'gm.json'
    ];

    let totalImported = 0;
    let totalUpdated = 0;

    for (const file of itemFiles) {
      const filePath = path.join(itemsDir, file);
      
      if (!fs.existsSync(filePath)) {
        logger.warn(`Item file not found: ${file}`);
        continue;
      }

      const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      logger.info(`Importing ${items.length} items from ${file}`);

      for (const item of items) {
        try {
          // Avoid using INSERT ... ON DUPLICATE KEY UPDATE because MySQL
          // may consume AUTO_INCREMENT values for attempted inserts that
          // end up doing updates, producing gaps in item_id. Instead,
          // check existence first and run UPDATE or INSERT accordingly.
          const [existingRows] = await gameDb.query(
            'SELECT item_id FROM items WHERE template_key = ?',
            [item.template_key]
          );

          if (existingRows && existingRows.length > 0) {
            await gameDb.query(
              `UPDATE items SET
                 name = ?,
                 description = ?,
                 stats = ?,
                 rarity = ?,
                 stackable = ?,
                 equipment_slot = ?,
                 icon_name = ?,
                 weight = ?
               WHERE template_key = ?`,
              [
                item.name,
                item.description || null,
                item.stats ? JSON.stringify(item.stats) : null,
                item.rarity || 'common',
                item.stackable ? 1 : 0,
                item.equipment_slot || null,
                item.icon_name || null,
                typeof item.weight !== 'undefined' ? item.weight : null,
                item.template_key
              ]
            );
            totalUpdated++;
          } else {
            await gameDb.query(
              `INSERT INTO items (template_key, name, type, description, stats, rarity, stackable, level, equipment_slot, icon_name, weight)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                item.template_key,
                item.name,
                item.type,
                item.description || null,
                item.stats ? JSON.stringify(item.stats) : null,
                item.rarity || 'common',
                item.stackable ? 1 : 0,
                item.level || 1,
                item.equipment_slot || null,
                item.icon_name || null,
                typeof item.weight !== 'undefined' ? item.weight : null
              ]
            );
            totalImported++;
          }
        } catch (err) {
          logger.error(`Failed to import item: ${item.template_key}`, { error: err.message });
        }
      }
    }

    logger.info(`Items import completed. Inserted: ${totalImported}, Updated: ${totalUpdated}`);
  } catch (err) {
    logger.error('Items import failed', { error: err.message });
    throw err;
  }
}

// CLI execution
if (require.main === module) {
  importItems()
    .then(() => {
      gameDb.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      gameDb.end();
      process.exit(1);
    });
}

module.exports = { importItems };
