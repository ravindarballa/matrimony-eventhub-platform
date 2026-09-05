/**
 * Starts an in-memory MongoDB replica set and keeps it running.
 *
 * A convenience for machines without Docker. It is a REPLICA SET, not a
 * standalone, because the booking flow uses multi-document transactions for the
 * slot lock and those require one.
 *
 * The port is fixed (27077 by default, or MONGO_PORT) so that the URI in
 * .env.example is correct as shipped - a random port would have to be pasted
 * into .env by hand on every restart, which is the kind of step people get
 * wrong once and then debug for twenty minutes.
 *
 * Data is in memory and vanishes when this process exits - use
 * `npm run infra:up` (Docker) when you want data to survive a restart.
 *
 *   node scripts/dev-mongo.mjs
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.MONGO_PORT ?? 27077);

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, name: 'testset', storageEngine: 'wiredTiger' },
  instanceOpts: [{ port }],
});

const uri = replSet.getUri('eventhub');

console.log('\n  In-memory MongoDB replica set is running.');
console.log(`    ${uri}\n`);
console.log('  This matches MONGODB_URI in .env.example, so nothing to paste.');
console.log('  Press Ctrl+C to stop. Data is not persisted.\n');

const shutdown = async () => {
  console.log('\n  Stopping MongoDB...');
  await replSet.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
