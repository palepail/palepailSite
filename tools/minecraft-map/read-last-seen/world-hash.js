#!/usr/bin/env node
// Prints a fingerprint of the blocks and biomes in a Bedrock world, so the publish script can
// skip the conversion and render when nothing on the map changed (e.g. nobody played).
//
// Usage: node world-hash.js <world db folder>
//
// Only terrain records count: sub-chunks (blocks) and biome/height data. Entities, players and
// other bookkeeping change while the server runs without changing what the map shows.
const crypto = require('crypto');
const { LevelDB } = require('leveldb-zlib');

// Chunk record tags: 0x2b Data3D (biomes), 0x2d Data2D, 0x2e Data2DLegacy, 0x2f SubChunk,
// 0x30 LegacyTerrain.
const TERRAIN_TAGS = new Set([0x2b, 0x2d, 0x2e, 0x2f, 0x30]);

/** Chunk keys are x, z (int32), an optional dimension (int32), the tag, and for sub-chunks a y. */
function isTerrainKey(key) {
  switch (key.length) {
    case 9:
    case 13:
      return TERRAIN_TAGS.has(key[key.length - 1]);
    case 10:
    case 14:
      return key[key.length - 2] === 0x2f;
    default:
      return false;
  }
}

async function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: node world-hash.js <world db folder>');
    process.exit(2);
  }
  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();
  const hash = crypto.createHash('sha1');
  let records = 0;
  try {
    for await (const [key, value] of db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })) {
      if (!isTerrainKey(key)) continue;
      hash.update(key).update(value);
      records++;
    }
  } finally {
    await db.close();
  }
  console.log(`${hash.digest('hex')} ${records}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
