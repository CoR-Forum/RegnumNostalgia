# Quick Start - WebSocket Testing

## 1. Start the Node.js Backend

```bash
cd /Users/joshua2504/projects/regnum-nostalgia
docker-compose -f docker-compose.node.yml up -d
```

## 2. Verify Services Running

```bash
# Check all containers
docker-compose -f docker-compose.node.yml ps

# Should show:
# - web (nginx) - running on port 80
# - api (node) - running on port 3000
# - db (mariadb) - running on port 3306
# - redis - running on port 6379
# - phpmyadmin - running on port 8080

# Check logs
docker-compose -f docker-compose.node.yml logs -f api
```

## 3. Test WebSocket Connection

### Option A: Main Game Interface
```bash
open http://localhost/game
```

1. Login with your credentials
2. Open browser DevTools (F12)
3. Check Console tab for: `WebSocket connected`
4. Check Network tab → WS filter → Click `socket.io` connection
5. Watch Messages tab for real-time events

### Option B: Standalone Test Page
```bash
open http://localhost/websocket-test.html
```

1. Token should auto-populate from localStorage (if you logged in before)
2. Click "Connect" button
3. Watch Event Log for incoming events
4. Try "Test Move Request" and "Test Chat Message" buttons

## 4. Monitor Background Jobs

### Bull Board Dashboard
```bash
open http://localhost/admin/queues
```

You should see 4 queues:
- **walker** - Processes every 2s (moves players along paths)
- **health** - Processes every 1s (regenerates HP/mana)
- **time** - Processes every 10s (updates ingame time)
- **territory** - Processes every 15s (fetches ownership from external API)

### Health Endpoint
```bash
curl http://localhost/api/health | jq
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "memory": { "heapUsed": 50, "heapTotal": 100 },
  "connections": { "players": 5 }
}
```

## 5. Watch Real-Time Events

### Browser Console
```javascript
// Enable Socket.io debug logging
localStorage.debug = '*'
location.reload()

// Get socket instance
const socket = window.getSocket()

// Check connection
socket.connected  // Should be true

// Listen for specific event
socket.on('players:online', (data) => {
  console.log('Online players:', data.players.length)
})

// Emit custom test event
socket.emit('position:update', { x: 3000, y: 3000 })
```

### Docker Logs
```bash
# Watch API logs in real-time
docker-compose -f docker-compose.node.yml logs -f api | grep -E "socket|emit|event"

# Watch Redis pub/sub
docker-compose -f docker-compose.node.yml exec redis redis-cli
> SUBSCRIBE *
# (Ctrl+C to exit)
```

## 6. Test Scenarios

### Test 1: Player Movement
1. Open game in browser
2. Right-click on map → "Walk Here"
3. Watch for events:
   - `move:started` - Server confirms path
   - `walker:step` - Position updates every 2s
   - `walker:completed` - Arrival at destination

### Test 2: Multi-Player Sync
1. Open game in 2 browser tabs (incognito for 2nd account)
2. Move player in tab 1
3. Tab 2 should show player 1 moving in real-time
4. Check `players:online` event every 2s

### Test 3: Territory Updates
1. Open game
2. Watch territory health bars
3. Should regenerate every 1 second (healthQueue)
4. Check `territories:update` events in console

### Test 4: Chat Messages
1. Open shoutbox
2. Send a message
3. Should appear instantly (no 5s delay)
4. Check `shoutbox:message` event in console

### Test 5: Reconnection
1. Open game, login
2. Disconnect network (turn off WiFi)
3. Console shows reconnection attempts
4. Reconnect network
5. After 5 failed attempts → page reloads

## 7. Verify Performance

### Check HTTP Request Reduction
**Before (with polling):**
- Open DevTools → Network tab
- Clear network log
- Wait 1 minute
- Count requests: ~56 per minute

**After (with WebSocket):**
- Repeat above steps
- Count requests: ~5 per minute (only initial API calls)
- **90%+ reduction achieved**

### Check WebSocket Traffic
- Network tab → WS filter
- Click socket.io connection
- Messages tab shows all events
- Should see:
  - `players:online` every 2s
  - `time:update` every 10s
  - `territories:update` when health changes
  - `walker:step` during movement

## 8. Troubleshooting

### WebSocket Not Connecting
```bash
# Check nginx WebSocket proxy
docker-compose -f docker-compose.node.yml exec web cat /etc/nginx/conf.d/default.conf | grep -A 10 "socket.io"

# Should show:
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection "upgrade";

# Check API server listening
docker-compose -f docker-compose.node.yml exec api netstat -tln | grep 3000

# Test WebSocket upgrade
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost/socket.io/
# Should return 400 Bad Request (expected without proper WebSocket handshake)
```

### Events Not Received
```bash
# Check queue workers running
docker-compose -f docker-compose.node.yml logs api | grep -E "Queue.*started"

# Should show:
# Walker queue started
# Health queue started
# Time queue started
# Territory queue started

# Check Redis connection
docker-compose -f docker-compose.node.yml exec redis redis-cli ping
# Should return: PONG

# Check database connection
docker-compose -f docker-compose.node.yml exec api node -e "
const { testConnections } = require('./src/config/database');
testConnections().then(() => console.log('OK')).catch(e => console.error(e));
"
```

### High Memory/CPU
```bash
# Monitor resource usage
docker stats

# Check queue job counts
open http://localhost/admin/queues

# Look for:
# - Failed jobs (should be 0)
# - Waiting jobs (should be < 100)
# - Active jobs (should be processing)

# Check for stuck jobs
docker-compose -f docker-compose.node.yml exec redis redis-cli
> KEYS bull:*:active
> KEYS bull:*:failed
```

## 9. Rollback to PHP

If issues occur:

```bash
# Stop Node.js backend
docker-compose -f docker-compose.node.yml down

# Start PHP backend
docker-compose up -d

# Frontend automatically falls back to REST polling
# No code changes needed
```

## 10. Production Deployment

Before deploying to production:

1. **Test under load**
   ```bash
   # Install siege
   brew install siege
   
   # Test API load
   siege -c 50 -t 1M http://localhost/api/health
   
   # Monitor
   docker stats
   open http://localhost/admin/queues
   ```

2. **Configure environment**
   - Set `NODE_ENV=production`
   - Use strong `JWT_SECRET`
   - Configure Redis persistence
   - Set up log rotation

3. **Enable monitoring**
   - Add error tracking (Sentry, Rollbar)
   - Add performance monitoring (New Relic, DataDog)
   - Set up alerting for queue failures

4. **Scale horizontally**
   ```yaml
   # docker-compose.node.yml
   api:
     deploy:
       replicas: 3  # Run 3 API instances
   
   nginx:
     # Add sticky sessions for Socket.io
     # ip_hash; in upstream block
   ```

## Quick Reference: Event Types

### Incoming (Client → Server)
- `position:update` - Update player position
- `move:request` - Request pathfinding + movement
- `shoutbox:send` - Post chat message

### Outgoing (Server → Client)
- `player:state` - Your player data
- `players:online` - All online players (every 2s)
- `walker:step` - Movement progress (every 2s)
- `territories:update` - Territory health (every 1s)
- `time:update` - Ingame time (every 10s)
- `shoutbox:message` - Chat message (real-time)

See [WEBSOCKET_MIGRATION.md](WEBSOCKET_MIGRATION.md) for complete event documentation.
