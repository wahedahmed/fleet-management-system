const Redis = require('ioredis');
const logger = require('../utils/logger');

/**
 * Redis configuration
 */
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: true,
  connectTimeout: 10000,
};

/**
 * Create Redis client instance
 */
const redis = new Redis(redisConfig);

/**
 * Connection event handlers
 */
redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

redis.on('error', (err) => {
  logger.error('Redis client error:', err);
});

redis.on('close', () => {
  logger.warn('Redis client connection closed');
});

redis.on('reconnecting', () => {
  logger.info('Redis client reconnecting...');
});

redis.on('end', () => {
  logger.info('Redis client connection ended');
});

/**
 * Cache helper functions
 */
const cacheHelpers = {
  /**
   * Set a value in cache with optional expiration
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<string>} Redis response
   */
  async set(key, value, ttl = null) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        return await redis.setex(key, ttl, serialized);
      }
      return await redis.set(key, serialized);
    } catch (err) {
      logger.error(`Error setting cache key ${key}:`, err);
      throw err;
    }
  },

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    try {
      const value = await redis.get(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (err) {
      logger.error(`Error getting cache key ${key}:`, err);
      throw err;
    }
  },

  /**
   * Delete one or more cache keys
   * @param {...string} keys - Keys to delete
   * @returns {Promise<number>} Number of keys deleted
   */
  async del(...keys) {
    try {
      if (keys.length === 0) return 0;
      return await redis.del(...keys);
    } catch (err) {
      logger.error(`Error deleting cache keys:`, err);
      throw err;
    }
  },

  /**
   * Clear all cache keys matching a pattern
   * @param {string} pattern - Pattern to match (e.g., 'vehicle:*')
   * @returns {Promise<number>} Number of keys deleted
   */
  async clearPattern(pattern) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) return 0;
      return await redis.del(...keys);
    } catch (err) {
      logger.error(`Error clearing cache pattern ${pattern}:`, err);
      throw err;
    }
  },

  /**
   * Check if a key exists
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} True if key exists
   */
  async exists(key) {
    try {
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (err) {
      logger.error(`Error checking cache key existence ${key}:`, err);
      throw err;
    }
  },

  /**
   * Get TTL for a key
   * @param {string} key - Cache key
   * @returns {Promise<number>} TTL in seconds (-1 if no expiration, -2 if key doesn't exist)
   */
  async getTTL(key) {
    try {
      return await redis.ttl(key);
    } catch (err) {
      logger.error(`Error getting TTL for key ${key}:`, err);
      throw err;
    }
  },

  /**
   * Increment a numeric value
   * @param {string} key - Cache key
   * @param {number} increment - Amount to increment by (default 1)
   * @returns {Promise<number>} New value
   */
  async increment(key, increment = 1) {
    try {
      return await redis.incrby(key, increment);
    } catch (err) {
      logger.error(`Error incrementing cache key ${key}:`, err);
      throw err;
    }
  },

  /**
   * Decrement a numeric value
   * @param {string} key - Cache key
   * @param {number} decrement - Amount to decrement by (default 1)
   * @returns {Promise<number>} New value
   */
  async decrement(key, decrement = 1) {
    try {
      return await redis.decrby(key, decrement);
    } catch (err) {
      logger.error(`Error decrementing cache key ${key}:`, err);
      throw err;
    }
  },

  /**
   * Get multiple values at once
   * @param {...string} keys - Keys to retrieve
   * @returns {Promise<any[]>} Array of values
   */
  async mget(...keys) {
    try {
      if (keys.length === 0) return [];
      const values = await redis.mget(...keys);
      return values.map(val => val ? JSON.parse(val) : null);
    } catch (err) {
      logger.error(`Error getting multiple cache keys:`, err);
      throw err;
    }
  },

  /**
   * Set multiple values at once
   * @param {object} keyValuePairs - Object with key-value pairs
   * @returns {Promise<string>} Redis response
   */
  async mset(keyValuePairs) {
    try {
      const args = [];
      for (const [key, value] of Object.entries(keyValuePairs)) {
        args.push(key);
        args.push(JSON.stringify(value));
      }
      return await redis.mset(...args);
    } catch (err) {
      logger.error(`Error setting multiple cache keys:`, err);
      throw err;
    }
  },
};

/**
 * Pub/Sub helper functions
 */
const pubSubHelpers = {
  // Map to store subscription handlers
  subscribers: new Map(),

  /**
   * Subscribe to a channel
   * @param {string} channel - Channel name
   * @param {function} handler - Callback function for messages
   * @returns {Promise<void>}
   */
  async subscribe(channel, handler) {
    try {
      if (!this.subscribers.has(channel)) {
        this.subscribers.set(channel, []);
        await redis.subscribe(channel);
        logger.info(`Subscribed to channel: ${channel}`);
      }
      this.subscribers.get(channel).push(handler);
    } catch (err) {
      logger.error(`Error subscribing to channel ${channel}:`, err);
      throw err;
    }
  },

  /**
   * Unsubscribe from a channel
   * @param {string} channel - Channel name
   * @returns {Promise<void>}
   */
  async unsubscribe(channel) {
    try {
      if (this.subscribers.has(channel)) {
        this.subscribers.delete(channel);
        await redis.unsubscribe(channel);
        logger.info(`Unsubscribed from channel: ${channel}`);
      }
    } catch (err) {
      logger.error(`Error unsubscribing from channel ${channel}:`, err);
      throw err;
    }
  },

  /**
   * Publish a message to a channel
   * @param {string} channel - Channel name
   * @param {any} message - Message to publish
   * @returns {Promise<number>} Number of subscribers that received the message
   */
  async publish(channel, message) {
    try {
      const serialized = JSON.stringify(message);
      return await redis.publish(channel, serialized);
    } catch (err) {
      logger.error(`Error publishing to channel ${channel}:`, err);
      throw err;
    }
  },

  /**
   * Subscribe to multiple channels
   * @param {string[]} channels - Array of channel names
   * @param {function} handler - Callback function for messages
   * @returns {Promise<void>}
   */
  async subscribeMultiple(channels, handler) {
    try {
      for (const channel of channels) {
        await this.subscribe(channel, handler);
      }
    } catch (err) {
      logger.error(`Error subscribing to multiple channels:`, err);
      throw err;
    }
  },

  /**
   * Get list of all subscribed channels
   * @returns {string[]} Array of subscribed channels
   */
  getSubscribedChannels() {
    return Array.from(this.subscribers.keys());
  },
};

/**
 * List/Queue helper functions
 */
const listHelpers = {
  /**
   * Push value(s) to the right of a list
   * @param {string} key - List key
   * @param {...any} values - Values to push
   * @returns {Promise<number>} Length of list after push
   */
  async rpush(key, ...values) {
    try {
      const serialized = values.map(v => JSON.stringify(v));
      return await redis.rpush(key, ...serialized);
    } catch (err) {
      logger.error(`Error pushing to list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Push value(s) to the left of a list
   * @param {string} key - List key
   * @param {...any} values - Values to push
   * @returns {Promise<number>} Length of list after push
   */
  async lpush(key, ...values) {
    try {
      const serialized = values.map(v => JSON.stringify(v));
      return await redis.lpush(key, ...serialized);
    } catch (err) {
      logger.error(`Error pushing to left of list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Pop value from the right of a list
   * @param {string} key - List key
   * @returns {Promise<any>} Popped value or null
   */
  async rpop(key) {
    try {
      const value = await redis.rpop(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      logger.error(`Error popping from list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Pop value from the left of a list
   * @param {string} key - List key
   * @returns {Promise<any>} Popped value or null
   */
  async lpop(key) {
    try {
      const value = await redis.lpop(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      logger.error(`Error popping from left of list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Get range of values from a list
   * @param {string} key - List key
   * @param {number} start - Start index
   * @param {number} stop - Stop index
   * @returns {Promise<any[]>} Array of values
   */
  async lrange(key, start = 0, stop = -1) {
    try {
      const values = await redis.lrange(key, start, stop);
      return values.map(v => JSON.parse(v));
    } catch (err) {
      logger.error(`Error getting range from list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Get length of a list
   * @param {string} key - List key
   * @returns {Promise<number>} Length of list
   */
  async llen(key) {
    try {
      return await redis.llen(key);
    } catch (err) {
      logger.error(`Error getting length of list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Get value at index in a list
   * @param {string} key - List key
   * @param {number} index - Index position
   * @returns {Promise<any>} Value at index or null
   */
  async lindex(key, index) {
    try {
      const value = await redis.lindex(key, index);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      logger.error(`Error getting index from list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Set value at index in a list
   * @param {string} key - List key
   * @param {number} index - Index position
   * @param {any} value - Value to set
   * @returns {Promise<string>} Redis response
   */
  async lset(key, index, value) {
    try {
      const serialized = JSON.stringify(value);
      return await redis.lset(key, index, serialized);
    } catch (err) {
      logger.error(`Error setting value at index in list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Remove elements from a list
   * @param {string} key - List key
   * @param {number} count - Number of elements to remove (0 = all)
   * @param {any} value - Value to remove
   * @returns {Promise<number>} Number of elements removed
   */
  async lrem(key, count, value) {
    try {
      const serialized = JSON.stringify(value);
      return await redis.lrem(key, count, serialized);
    } catch (err) {
      logger.error(`Error removing elements from list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Trim a list to specified range
   * @param {string} key - List key
   * @param {number} start - Start index
   * @param {number} stop - Stop index
   * @returns {Promise<string>} Redis response
   */
  async ltrim(key, start, stop) {
    try {
      return await redis.ltrim(key, start, stop);
    } catch (err) {
      logger.error(`Error trimming list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Blocking pop from right (waits for timeout seconds)
   * @param {string} key - List key
   * @param {number} timeout - Timeout in seconds
   * @returns {Promise<[string, any]|null>} Array [key, value] or null on timeout
   */
  async brpop(key, timeout = 0) {
    try {
      const result = await redis.brpop(key, timeout);
      if (!result) return null;
      return [result[0], JSON.parse(result[1])];
    } catch (err) {
      logger.error(`Error blocking pop from list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Blocking pop from left (waits for timeout seconds)
   * @param {string} key - List key
   * @param {number} timeout - Timeout in seconds
   * @returns {Promise<[string, any]|null>} Array [key, value] or null on timeout
   */
  async blpop(key, timeout = 0) {
    try {
      const result = await redis.blpop(key, timeout);
      if (!result) return null;
      return [result[0], JSON.parse(result[1])];
    } catch (err) {
      logger.error(`Error blocking pop from left of list ${key}:`, err);
      throw err;
    }
  },

  /**
   * Clear all elements from a list
   * @param {string} key - List key
   * @returns {Promise<number>} Number of elements deleted
   */
  async clear(key) {
    try {
      return await redis.del(key);
    } catch (err) {
      logger.error(`Error clearing list ${key}:`, err);
      throw err;
    }
  },
};

/**
 * Health check function
 */
async function healthCheck() {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error('Redis health check failed:', err);
    return false;
  }
}

/**
 * Disconnect Redis client
 */
async function disconnect() {
  try {
    await redis.quit();
    logger.info('Redis client disconnected');
  } catch (err) {
    logger.error('Error disconnecting Redis client:', err);
    throw err;
  }
}

/**
 * Get raw Redis client instance
 */
function getClient() {
  return redis;
}

module.exports = {
  redis,
  redisConfig,
  cacheHelpers,
  pubSubHelpers,
  listHelpers,
  healthCheck,
  disconnect,
  getClient,
};
