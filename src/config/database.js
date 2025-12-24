const { Sequelize } = require('sequelize');
require('dotenv').config();

/**
 * MySQL Sequelize Configuration
 * Supports multiple environments with connection pooling and error handling
 */

const environment = process.env.NODE_ENV || 'development';

const config = {
  development: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'fleet_management_dev',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: console.log,
    dialectOptions: {
      connectTimeout: 10000,
      supportBigNumbers: true,
      bigNumberStrings: true,
    },
    pool: {
      max: 5,
      min: 1,
      acquire: 30000,
      idle: 10000,
    },
    timezone: '+00:00',
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      connectTimeout: 10000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      ssl: process.env.DB_SSL === 'true' ? 'Amazon RDS' : false,
    },
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 10000,
      evictionRunIntervalMillis: 10000,
      handleDisconnects: true,
    },
    timezone: '+00:00',
  },
  test: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'fleet_management_test',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      connectTimeout: 10000,
      supportBigNumbers: true,
      bigNumberStrings: true,
    },
    pool: {
      max: 3,
      min: 1,
      acquire: 30000,
      idle: 10000,
    },
    timezone: '+00:00',
  },
};

const databaseConfig = config[environment];

// Validate required environment variables in production
if (environment === 'production') {
  const requiredEnvVars = ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_HOST'];
  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar]
  );

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvVars.join(', ')}`
    );
  }
}

// Initialize Sequelize instance
const sequelize = new Sequelize(
  databaseConfig.database,
  databaseConfig.username,
  databaseConfig.password,
  {
    host: databaseConfig.host,
    port: databaseConfig.port,
    dialect: databaseConfig.dialect,
    logging: databaseConfig.logging,
    dialectOptions: databaseConfig.dialectOptions,
    pool: databaseConfig.pool,
    timezone: databaseConfig.timezone,
    define: {
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
      timestamps: true,
      underscored: true,
    },
  }
);

// Connection error handling
sequelize.authenticate()
  .then(() => {
    console.log('✓ Database connection established successfully');
  })
  .catch((error) => {
    console.error('✗ Database connection failed:', error.message);
    if (environment === 'production') {
      process.exit(1);
    }
  });

// Handle pool connection errors
sequelize.pool?.on?.('error', (error) => {
  console.error('✗ Database pool error:', error.message);
});

sequelize.pool?.on?.('idle-object', () => {
  console.debug('Database connection returned to pool');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nClosing database connections...');
  try {
    await sequelize.close();
    console.log('✓ Database connections closed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error closing database connections:', error.message);
    process.exit(1);
  }
});

module.exports = sequelize;
