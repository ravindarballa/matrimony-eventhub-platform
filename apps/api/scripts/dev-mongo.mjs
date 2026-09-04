/**
 * Starts an in-memory MongoDB replica set and keeps it running.
 *
 * A convenience for machines without Docker. It is a REPLICA SET, not a
 * standalone, because the booking flow uses multi-document transactions for the
 * slot lock and those require one.
 *
 * Data is in memory and vanishes when this process exits - use
 * `npm run infra:up` (Docker) when you want data to survive a restart.
 *
 *   node scripts/dev-mongo.mjs
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});

const uri = replSet.getUri('eventhub');

console.log('\n  In-memory MongoDB replica set is running.');
console.log('  Point the API at it with:\n');
console.log(`    MONGODB_URI=${uri}\n`);
console.log('  Press Ctrl+C to stop. Data is not persisted.\n');

const shutdown = async () => {
  console.log('\n  Stopping MongoDB...');
  await replSet.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
