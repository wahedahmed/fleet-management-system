/**
 * CORS Configuration
 * Handles Cross-Origin Resource Sharing settings for the application
 * Date: 2025-12-24
 */

const corsOptions = {
  // Allow requests from these origins
  origin: process.env.CORS_ORIGIN || [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000'
  ],

  // Allow these HTTP methods
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  // Allow these headers in requests
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],

  // Headers to expose to the client
  exposedHeaders: ['Content-Length', 'X-JSON-Response'],

  // Allow credentials (cookies, authorization headers)
  credentials: true,

  // Preflight request caching time in seconds
  maxAge: 86400 // 24 hours
};

module.exports = corsOptions;
