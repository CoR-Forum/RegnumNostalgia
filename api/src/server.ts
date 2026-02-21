const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

const logger = require('./config/logger');
const { testConnections, initScreenshotsDb, gameDb } = require('./config/database');
const { preloadStaticData, flushLastActive, cleanupOnlinePlayers } = require('./config/cache');
const { ONLINE_THRESHOLD_SECONDS } = require('./config/constants');
const { initializeQueues, closeQueues, walkerQueue, healthQueue, spellQueue, timeQueue, territoryQueue } = require('./queues');
const { initializeSocketHandlers } = require('./sockets');
const { initDatabase } = require('../scripts/init-db');
const { importItems } = require('../scripts/import-items');

// Routes
const authRoutes = require('./routes/auth');
const screenshotsRoutes = require('./routes/screenshots');
const settingsRoutes = require('./routes/settings');

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = createServer(app);

// CORS configuration
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS 
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*'];

app.use(cors({
  origin: allowedOrigins[0] === '*' ? '*' : allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-Token', 'X-API-KEY'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const { gameDb, forumDb, redis } = require('./config/database');
    
    // Test database connections
    const mysqlHealthy = await gameDb.query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    
    const forumMysqlHealthy = await forumDb.query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    
    const redisHealthy = await redis.ping()
      .then(() => true)
      .catch(() => false);

    const allHealthy = mysqlHealthy && forumMysqlHealthy && redisHealthy;

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      connections: {
        mysql: mysqlHealthy,
        forumMysql: forumMysqlHealthy,
        redis: redisHealthy
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'error',
      error: error.message
    });
  }
});

// Mount API routes
app.use('/login', authRoutes);
app.use('/realm', authRoutes);
app.use('/screenshots', screenshotsRoutes);
app.use('/user/settings', settingsRoutes);

// Bull Board setup (queue monitoring dashboard)
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullAdapter(walkerQueue),
    new BullAdapter(healthQueue),
    new BullAdapter(spellQueue),
    new BullAdapter(timeQueue),
    new BullAdapter(territoryQueue)
  ],
  serverAdapter
});

app.use('/admin/queues', serverAdapter.getRouter());

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Socket.io setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins[0] === '*' ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 2000,
  pingInterval: 5000
});

// Initialize Socket.io handlers
initializeSocketHandlers(io);

// Startup
async function start() {
  try {
    logger.info('Starting Regnum Nostalgia API server...');

    // Test database connections
    await testConnections();

    // Initialize database schema if needed
    await initDatabase();

    // Import items if needed
    await importItems();

    // Initialize screenshots database
    await initScreenshotsDb();

    // Preload static game data (items, levels) into Redis cache
    await preloadStaticData(gameDb);

    // Initialize Bull queues with Socket.io instance
    await initializeQueues(io);

    // Start periodic last_active flush from Redis to MariaDB (every 5s)
    setInterval(() => flushLastActive(gameDb), 5000);

    // Periodically clean up stale entries from Redis online players set
    setInterval(() => cleanupOnlinePlayers(ONLINE_THRESHOLD_SECONDS), 10000);

    // Start HTTP server
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Bull Board: http://localhost:${PORT}/admin/queues`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');

  try {
    // Close queues
    await closeQueues();

    // Close HTTP server
    await new Promise((resolve) => {
      httpServer.close(resolve);
    });

    // Close Socket.io
    io.close();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

// Start the server
start();

module.exports = { app, httpServer, io };
