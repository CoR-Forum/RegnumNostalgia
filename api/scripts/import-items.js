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
      logger.info(`Items already imported (${rows[0].count} items)`);
      return;
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
      'alasthor.json'
    ];

    let totalImported = 0;

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
          await gameDb.query(
            `INSERT INTO items (template_key, name, type, description, stats, rarity, stackable, level, equipment_slot, icon_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               type = VALUES(type),
               description = VALUES(description),
               stats = VALUES(stats),
               rarity = VALUES(rarity),
               stackable = VALUES(stackable),
               level = VALUES(level),
               equipment_slot = VALUES(equipment_slot),
               icon_name = VALUES(icon_name)`,
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
              item.icon_name || null
            ]
          );
          totalImported++;
        } catch (err) {
          logger.error(`Failed to import item: ${item.template_key}`, { error: err.message });
        }
      }
    }

    logger.info(`Items import completed. Total: ${totalImported}`);
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
