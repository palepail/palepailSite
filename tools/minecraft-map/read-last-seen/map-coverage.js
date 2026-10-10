#!/usr/bin/env node
// Compares which chunks exist in a Bedrock world with which made it into the Java world that
// Chunker produced, to find where gaps in the map come from.
//
// Usage: node map-coverage.js <bedrock world db folder> [<java world folder>]
//
// For each dimension it prints the number of generated chunks in the Bedrock world, how many of
// those exist in the Java world (and their "Status" — BlueMap skips chunks whose status is
// "empty"), and the areas with the most missing chunks, in block coordinates.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { LevelDB } = require('leveldb-zlib');

const DIMENSIONS = [
  { id: 0, name: 'overworld', folders: ['dimensions/minecraft/overworld/region', 'region'] },
  { id: 1, name: 'nether', folders: ['dimensions/minecraft/the_nether/region', 'DIM-1/region'] },
  { id: 2, name: 'end', folders: ['dimensions/minecraft/the_end/region', 'DIM1/region'] },
];
// Bedrock chunk record tags that exist once per generated chunk: ChunkVersion and its legacy form.
const VERSION_TAGS = new Set([0x2c, 0x76]);

const chunkId = (x, z) => `${x},${z}`;

/** Generated chunks per Bedrock dimension id, from the keys of the world's LevelDB. */
async function readBedrockChunks(dbPath) {
  const chunks = new Map(DIMENSIONS.map((d) => [d.id, new Set()]));
  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();
  try {
    for await (const [key] of db.getIterator({ keys: true, values: false, keyAsBuffer: true })) {
      // Chunk keys: x(int32) z(int32) [dimension(int32)] tag(byte) [subchunk(byte)]
      let dimension;
      if (key.length === 9) dimension = 0;
      else if (key.length === 13) dimension = key.readInt32LE(8);
      else continue;
      if (!VERSION_TAGS.has(key[key.length - 1]) || !chunks.has(dimension)) continue;
      chunks.get(dimension).add(chunkId(key.readInt32LE(0), key.readInt32LE(4)));
    }
  } finally {
    await db.close();
  }
  return chunks;
}

/** Chunks present in a Java dimension's region files, with their Status. */
async function readJavaChunks(regionDir) {
  const chunks = new Map();
  if (!regionDir) return chunks;
  for (const file of fs.readdirSync(regionDir)) {
    const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(file);
    if (!match) continue;
    const data = fs.readFileSync(path.join(regionDir, file));
    if (data.length < 8192) continue;
    for (let i = 0; i < 1024; i++) {
      const location = data.readUInt32BE(i * 4);
      if (location === 0) continue;
      const x = Number(match[1]) * 32 + (i % 32);
      const z = Number(match[2]) * 32 + Math.floor(i / 32);
      chunks.set(chunkId(x, z), await readStatus(data, (location >>> 8) * 4096));
    }
  }
  return chunks;
}

async function readStatus(data, offset) {
  try {
    const length = data.readUInt32BE(offset);
    const compression = data[offset + 4];
    let payload = data.subarray(offset + 5, offset + 4 + length);
    if (compression === 2) payload = zlib.inflateSync(payload);
    else if (compression === 1) payload = zlib.gunzipSync(payload);
    else if (compression !== 3) return `unreadable (compression ${compression})`;
    const { parsed } = await nbt.parse(payload, 'big');
    const status = parsed.value.Status?.value ?? parsed.value.Level?.value?.Status?.value;
    return status ?? '(no status)';
  } catch (error) {
    return `unreadable (${error.message})`;
  }
}

/** Groups chunk ids into 32x32-chunk regions and returns the regions with the most of them. */
function biggestAreas(chunkIds, limit = 8) {
  const regions = new Map();
  for (const id of chunkIds) {
    const [x, z] = id.split(',').map(Number);
    const key = chunkId(Math.floor(x / 32), Math.floor(z / 32));
    regions.set(key, (regions.get(key) ?? 0) + 1);
  }
  return [...regions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => {
      const [rx, rz] = key.split(',').map(Number);
      return `    ${String(count).padStart(5)} chunks around block X ${rx * 512}..${rx * 512 + 511}, Z ${rz * 512}..${rz * 512 + 511}`;
    });
}

async function main() {
  const [dbPath, javaWorld] = process.argv.slice(2);
  if (!dbPath) {
    console.error('Usage: node map-coverage.js <bedrock world db folder> [<java world folder>]');
    process.exit(2);
  }

  const bedrock = await readBedrockChunks(dbPath);
  for (const dimension of DIMENSIONS) {
    const bedrockChunks = bedrock.get(dimension.id);
    const regionDir = javaWorld
      && dimension.folders.map((f) => path.join(javaWorld, f)).find((dir) => fs.existsSync(dir));
    const javaChunks = await readJavaChunks(regionDir);
    if (bedrockChunks.size === 0 && javaChunks.size === 0) continue;

    console.log(`\n${dimension.name}: ${bedrockChunks.size} chunks in the Bedrock world`);
    if (!javaWorld) continue;

    const missing = [...bedrockChunks].filter((id) => !javaChunks.has(id));
    const statuses = new Map();
    for (const status of javaChunks.values()) statuses.set(status, (statuses.get(status) ?? 0) + 1);
    console.log(`  ${javaChunks.size} chunks in the Java world; ${missing.length} Bedrock chunks missing from it`);
    for (const [status, count] of [...statuses.entries()].sort((a, b) => b[1] - a[1])) {
      const note = /(^|:)empty$/.test(status) ? '  <- BlueMap skips these' : '';
      console.log(`    status ${status}: ${count}${note}`);
    }
    if (missing.length) {
      console.log('  Largest areas of missing chunks:');
      for (const line of biggestAreas(missing)) console.log(line);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
