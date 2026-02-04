# Player Log System

The player log system provides in-game logging functionality for individual players. Logs are stored in the database and displayed in the chat window alongside the shoutbox.

## Database Schema

The `player_logs` table stores log entries:

```sql
CREATE TABLE player_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message TEXT NOT NULL,
  log_type VARCHAR(32) NOT NULL DEFAULT 'info',
  created_at INT NOT NULL,
  INDEX idx_player_logs_user_id (user_id),
  INDEX idx_player_logs_created_at (created_at),
  INDEX idx_player_logs_user_created (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES players(user_id)
)
```

## Server-Side Usage

### Adding Log Messages

Import the `addPlayerLog` function from the sockets module:

```javascript
const { addPlayerLog } = require('../sockets');
```

Call the function to add a log message:

```javascript
await addPlayerLog(userId, message, logType, io);
```

**Parameters:**
- `userId` (number): The user ID to send the log to
- `message` (string): The log message text
- `logType` (string): Type of log - 'info', 'success', 'error', 'warning', 'combat'
- `io` (object, optional): Socket.io instance for real-time delivery

**Log Types and Colors:**
- `info` - Blue (#9ecbff) - General information
- `success` - Green (#7ed321) - Successful actions
- `error` - Red (#ff4757) - Errors and failures
- `warning` - Orange (#ffa502) - Warnings
- `combat` - Red-orange (#ff6348) - Combat-related events

### Examples

```javascript
// Item collection
await addPlayerLog(userId, 'Collected Iron Sword', 'success', io);

// Equipment
await addPlayerLog(userId, 'Equipped Steel Helmet', 'info', io);

// Warnings
await addPlayerLog(userId, 'Item already collected by another player', 'warning', io);

// Errors
await addPlayerLog(userId, 'Failed to equip item: Level requirement not met', 'error', io);

// Combat
await addPlayerLog(userId, 'Defeated by Bandit Leader', 'combat', io);
```

## WebSocket Events

### Client → Server

**Get log history:**
```javascript
socket.emit('log:get', {}, (response) => {
  if (response.success) {
    console.log(response.logs); // Array of log entries
  }
});
```

### Server → Client

**Real-time log message:**
```javascript
socket.on('log:message', (data) => {
  // data.logId, data.userId, data.message, data.logType, data.createdAt
  console.log(`[${data.logType}] ${data.message}`);
});
```

## Frontend Integration

The log is automatically displayed in [shoutbox.html](../public/shoutbox.html) in the top 30% of the window, with the chat taking the bottom 70%.

The frontend registers a global handler:

```javascript
window.onLogMessage = function(data) {
  // Handles incoming log messages
};
```

Log messages are automatically color-coded based on their type and limited to the most recent 50 entries.

## Current Integrations

The log system is currently integrated in:

1. **Item Collection** (`api/src/queues/walkerQueue.js`)
   - Success: "Collected [item name]"
   - Warning: "Item already collected by another player"

2. **Equipment** (`api/src/sockets/index.js`)
   - Info: "Equipped [item name]"
   - Info: "Unequipped [item name]"

## Future Extensions

The log system can be extended to track:
- Combat events (damage dealt/received, kills)
- Territory captures
- Level ups and stat increases
- Quest completions
- Trading activities
- Party/guild events
- System notifications
