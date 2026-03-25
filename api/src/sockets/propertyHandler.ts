export {};

const { gameDb, forumDb } = require('../config/database');
const { getItemByTemplateKey, addShoutboxMessage, getLastShoutboxId, setLastShoutboxId } = require('../config/cache');
const logger = require('../config/logger');
const fs = require('fs').promises;
const path = require('path');

const REGIONS_FILE = path.join(__dirname, '../../gameData/regions.json');

function registerPropertyHandler(socket: any, user: any, io: any) {
  socket.on('property:purchase', async ({ regionId }: { regionId: string }, callback: Function) => {
    try {
      // 1. Load region config and verify it's a buyable property
      const regions = JSON.parse(await fs.readFile(REGIONS_FILE, 'utf8'));
      const region = regions.find((r: any) => r.id === regionId);
      if (!region || !region.buyable) {
        return callback({ success: false, error: 'This property is not for sale' });
      }

      // 2. Check not already owned
      const [existing] = await gameDb.query(
        'SELECT owner_user_id, owner_username FROM properties WHERE region_id = ?',
        [regionId]
      );
      if ((existing as any[]).length && (existing as any[])[0].owner_user_id === user.userId) {
        return callback({ success: false, error: 'You already own this property' });
      }
      if ((existing as any[]).length) {
        return callback({ success: false, error: `Already owned by ${(existing as any[])[0].owner_username}` });
      }

      // 3. Check player has enough currency in inventory
      const currencyItem = await getItemByTemplateKey(gameDb, region.buy_currency);
      if (!currencyItem) {
        return callback({ success: false, error: 'Unknown currency type' });
      }

      const [invRows] = await gameDb.query(
        'SELECT inventory_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [user.userId, currencyItem.item_id]
      );
      if (!(invRows as any[]).length || (invRows as any[])[0].quantity < region.buy_price) {
        const currencyDisplay = String(region.buy_currency).replace(/_/g, ' ');
        return callback({ success: false, error: `Not enough ${currencyDisplay}` });
      }

      // 4. Deduct currency from inventory
      const invId = (invRows as any[])[0].inventory_id;
      if ((invRows as any[])[0].quantity === region.buy_price) {
        await gameDb.query('DELETE FROM inventory WHERE inventory_id = ?', [invId]);
      } else {
        await gameDb.query(
          'UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ?',
          [region.buy_price, invId]
        );
      }

      // 5. Record current ownership (upsert) and append to history log
      const now = Math.floor(Date.now() / 1000);
      const prevUserId = (existing as any[]).length ? (existing as any[])[0].owner_user_id : null;
      const prevUsername = (existing as any[]).length ? (existing as any[])[0].owner_username : null;

      await gameDb.query(
        `INSERT INTO properties (region_id, owner_user_id, owner_username, purchase_price, purchase_currency, purchased_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           owner_user_id = VALUES(owner_user_id),
           owner_username = VALUES(owner_username),
           purchase_price = VALUES(purchase_price),
           purchase_currency = VALUES(purchase_currency),
           purchased_at = VALUES(purchased_at)`,
        [regionId, user.userId, user.username, region.buy_price, region.buy_currency, now]
      );

      await gameDb.query(
        `INSERT INTO property_ownership_log
           (region_id, previous_owner_user_id, previous_owner_username, new_owner_user_id, new_owner_username, purchase_price, purchase_currency, purchased_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [regionId, prevUserId, prevUsername, user.userId, user.username, region.buy_price, region.buy_currency, now]
      );

      logger.info('Property purchased', {
        regionId,
        userId: user.userId,
        username: user.username,
        prevOwner: prevUsername,
        price: region.buy_price,
        currency: region.buy_currency
      });

      // 6. Broadcast ownership update to all clients
      io.emit('property:updated', {
        regionId,
        ownedBy: user.username,
        ownedByUserId: user.userId
      });

      // 7. Refresh buyer's inventory display
      socket.emit('inventory:updated');

      // 8. Post system message to shoutbox
      const currencyDisplay = String(region.buy_currency).replace(/_/g, ' ');
      const chatMsg = prevUsername
        ? `${user.username} bought the property "${region.name}" from ${prevUsername} for ${region.buy_price} ${currencyDisplay}.`
        : `${user.username} bought the property "${region.name}" for ${region.buy_price} ${currencyDisplay}.`;
      try {
        const [res] = await forumDb.query(
          `INSERT INTO wcf1_shoutbox_entry (shoutboxID, userID, username, time, message) VALUES (1, 0, 'System', ?, ?)`,
          [now, chatMsg]
        );
        const systemMessage = { entryId: (res as any).insertId, userId: 0, username: 'System', time: now, message: chatMsg };
        const currentLastId = await getLastShoutboxId();
        if ((res as any).insertId > currentLastId) await setLastShoutboxId((res as any).insertId);
        await addShoutboxMessage(systemMessage);
        io.emit('shoutbox:message', systemMessage);
      } catch (chatErr: any) {
        logger.error('Failed to post property purchase shoutbox message', { error: chatErr.message });
        io.emit('shoutbox:message', { entryId: 0, userId: 0, username: 'System', time: now, message: chatMsg });
      }

      callback({ success: true });
    } catch (err: any) {
      logger.error('property:purchase failed', { error: err.message, userId: user.userId });
      callback({ success: false, error: 'Purchase failed' });
    }
  });
}

module.exports = { registerPropertyHandler };
