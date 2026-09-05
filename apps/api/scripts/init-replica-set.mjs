/**
 * Initiates a single-node replica set on a locally installed MongoDB, and
 * proves that transactions work against it.
 *
 * Why this is needed at all: this project uses multi-document transactions in
 * two places that matter - the booking slot lock, and payment capture writing
 * the ledger atomically - and a standalone mongod rejects them outright with
 * "Transaction numbers are only allowed on a replica set member or mongos".
 * A single-node replica set is still one process on one machine; it simply has
 * the oplog that transactions require.
 *
 * It uses the driver already in this project rather than mongosh, so there is
 * nothing extra to install. It is safe to re-run: an already-initiated set is
 * reported and left alone.
 *
 * Run it AFTER mongod.cfg has replSetName set and the service restarted:
 *
 *   npm run db:init-rs
 */
import mongoose from 'mongoose';

const host = process.env.MONGO_HOST ?? '127.0.0.1:27017';
const setName = process.env.MONGO_REPLSET ?? 'rs0';

// directConnection is essential here: without it the driver tries to discover a
// replica set that does not exist yet and never connects.
const adminUri = `mongodb://${host}/admin?directConnection=true`;

console.log(`\n  Connecting to ${host} ...`);
await mongoose.connect(adminUri, { serverSelectionTimeoutMS: 5000 });
const admin = mongoose.connection.db.admin();

let status;
try {
  status = await admin.command({ replSetGetStatus: 1 });
  console.log(`  Already a replica set: ${status.set} (${status.myState === 1 ? 'PRIMARY' : 'state ' + status.myState})`);
} catch (e) {
  const message = String(e?.codeName ?? e?.message ?? e);

  if (message.includes('NotYetInitialized') || message.includes('no replset config')) {
    console.log(`  Initiating replica set "${setName}" ...`);
    await admin.command({
      replSetInitiate: { _id: setName, members: [{ _id: 0, host }] },
    });

    // Election takes a moment; there is nothing to do until it is PRIMARY.
    process.stdout.write('  Waiting for PRIMARY');
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s = await admin.command({ replSetGetStatus: 1 });
        if (s.myState === 1) {
          console.log(' — elected.');
          break;
        }
      } catch {
        // still coming up
      }
      process.stdout.write('.');
    }
  } else if (message.includes('NoReplicationEnabled') || message.includes('not running with --replSet')) {
    console.error(`
  This mongod is still a standalone.

  Add these two lines to mongod.cfg, then restart the MongoDB service from an
  ELEVATED PowerShell, and run this again:

    replication:
      replSetName: ${setName}

  The config file is usually at:
    C:\\Program Files\\MongoDB\\Server\\<version>\\bin\\mongod.cfg
`);
    await mongoose.disconnect();
    process.exit(1);
  } else {
    throw e;
  }
}

// The whole point of the exercise: a transaction has to actually commit.
console.log('\n  Verifying that transactions work ...');
await mongoose.disconnect();
await mongoose.connect(
  `mongodb://${host}/eventhub?replicaSet=${setName}&directConnection=true`,
);

const probe = mongoose.connection.collection('_transaction_probe');
const session = await mongoose.connection.getClient().startSession();
try {
  await session.withTransaction(async () => {
    await probe.insertOne({ at: new Date() }, { session });
  });
  await probe.drop().catch(() => {});
  console.log('  Transactions work.\n');
} finally {
  await session.endSession();
}

console.log('  Point the API at it with this line in apps/api/.env:\n');
console.log(
  `    MONGODB_URI=mongodb://${host}/eventhub?replicaSet=${setName}&directConnection=true\n`,
);
console.log('  Unlike the in-memory server, this data survives a restart.\n');

await mongoose.disconnect();
