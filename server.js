/**
 * Fleet Management System - Main Server Entry Point
 * ================================================
 * Production-ready Node.js server with Express, MySQL, Redis, and WebSocket
 * 
 * Author: Fleet Management Team
 * Version: 1.0.0
 * Last Updated: 2025-12-24
 */

require('dotenv').config();
require('express-async-errors');

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// Custom modules
const logger = require('./src/utils/logger');
const { sequelize } = require('./src/config/database');
const redisClient = require('./src/config/redis');
const errorHandler = require('./src/middleware/errorHandler');
const requestLogger = require('./src/middleware/requestLogger');
const rateLimiter = require('./src/middleware/rateLimiter');
const corsOptions = require('./src/config/cors');
const apiRoutes = require('./src/routes');
const WebSocketServer = require('./src/websocket/server');

// Initialize Express app
const app = express();

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Initialize WebSocket Server
const wsServer = new WebSocketServer(server);

// ===========================
// Trust Proxy Configuration
// ===========================
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ===========================
// Security Middleware
// ===========================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ===========================
// CORS Configuration
// ===========================
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ===========================
// Compression Middleware
// ===========================
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
}));

// ===========================
// Body Parser Middleware
// ===========================
app.use(bodyParser.json({ limit: process.env.MAX_FILE_SIZE || '50mb' }));
app.use(bodyParser.urlencoded({ limit: process.env.MAX_FILE_SIZE || '50mb', extended: true }));

// ===========================
// Logging Middleware
// ===========================
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);

app.use(morgan('combined', { stream: accessLogStream }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Custom request logger
app.use(requestLogger);

// ===========================
// Rate Limiting Middleware
// ===========================
app.use('/api/', rateLimiter);

// ===========================
// Health Check Endpoint
// ===========================
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    database: 'checking...',
    redis: 'checking...',
  };

  // Check database connection
  sequelize.authenticate()
    .then(() => {
      health.database = 'connected';
    })
    .catch((err) => {
      health.database = `disconnected: ${err.message}`;
      health.status = 'DEGRADED';
    });

  // Check Redis connection
  redisClient.ping()
    .then(() => {
      health.redis = 'connected';
      res.status(health.status === 'OK' ? 200 : 503).json(health);
    })
    .catch((err) => {
      health.redis = `disconnected: ${err.message}`;
      health.status = 'DEGRADED';
      res.status(503).json(health);
    });
});

// ===========================
// Ready Endpoint (for K8s)
// ===========================
app.get('/ready', async (req, res) => {
  try {
    await sequelize.authenticate();
    const pong = await redisClient.ping();
    
    if (pong === 'PONG') {
      res.status(200).json({ ready: true });
    } else {
      res.status(503).json({ ready: false, error: 'Redis not responding' });
    }
  } catch (error) {
    res.status(503).json({ ready: false, error: error.message });
  }
});

// ===========================
// API Routes
// ===========================
app.use(`/api/${process.env.API_VERSION || 'v1'}`, apiRoutes);

// ===========================
// Swagger API Documentation
// ===========================
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerDocument = require('./src/docs/swagger');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

// ===========================
// Static Files
// ===========================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ===========================
// 404 Handler
// ===========================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path,
  });
});

// ===========================
// Global Error Handler
// ===========================
app.use(errorHandler);

// ===========================
// Database & Server Initialization
// ===========================
const PORT = process.env.APP_PORT || 3000;
const HOST = process.env.APP_HOST || '0.0.0.0';

const initializeServer = async () => {
  try {
    // Test database connection
    logger.info('Testing MySQL connection...');
    await sequelize.authenticate();
    logger.info('✅ MySQL connected successfully');

    // Test Redis connection
    logger.info('Testing Redis connection...');
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      logger.info('✅ Redis connected successfully');
    }

    // Sync database models (in development)
    if (process.env.NODE_ENV === 'development') {
      logger.info('Syncing database models...');
      await sequelize.sync({ alter: false });
      logger.info('✅ Database models synchronized');
    }

    // Start HTTP server
    server.listen(PORT, HOST, () => {
      logger.info(`
╔══════════════════════════════════════════════════════════╗
║  🚀 Fleet Management System Started Successfully!        ║
╠══════════════════════════════════════════════════════════╣
║  Environment: ${process.env.NODE_ENV.toUpperCase().padEnd(38)} ║
║  Server: http://${HOST}:${PORT}${' '.repeat(28 - String(PORT).length)} ║
║  API Version: ${(process.env.API_VERSION || 'v1').padEnd(41)} ║
║  WebSocket: ws://${HOST}:${PORT}${' '.repeat(28 - String(PORT).length)} ║
║  Docs: http://${HOST}:${PORT}/api-docs${' '.repeat(18 - String(PORT).length)} ║
╚══════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown handler
    const gracefulShutdown = async (signal) => {
      logger.info(`\n${signal} signal received: closing HTTP server gracefully...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          // Close database connection
          await sequelize.close();
          logger.info('Database connection closed');

          // Close Redis connection
          await redisClient.quit();
          logger.info('Redis connection closed');

          logger.info('All connections closed. Exiting.');
          process.exit(0);
        } catch (err) {
          logger.error('Error during graceful shutdown:', err);
          process.exit(1);
        }
      });

      // Forcefully close after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after 30 seconds');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      logger.error('Unhandled Rejection:', err);
      gracefulShutdown('UNHANDLED_REJECTION');
    });

  } catch (error) {
    logger.error('Failed to initialize server:', error);
    process.exit(1);
  }
};

// Start the server
initializeServer();

// Export app for testing
module.exports = { app, server };