require('dotenv').config();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// BullMQ requires this specific option set on the Redis connection
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// One queue, each episode moves through named steps as it progresses.
// This mirrors the same queue pattern used in the VEIL try-on pipeline.
const episodeQueue = new Queue('devlok-episodes', { connection });

module.exports = { connection, episodeQueue };
