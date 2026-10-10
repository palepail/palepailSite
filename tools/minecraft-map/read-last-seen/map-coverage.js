#!/usr/bin/env node
// Compares which chunks exist in a Bedrock world with which made it into the Java world that
// Chunker produced, to find where gaps in the map come from.
//
// Usage: node map-coverage.js <bedrock world db folder> [<java world folder>] [<BlueMap maps folder>]
//   e.g. node map-coverage.js "C:\minecraft-map\snapshot\db" "C:\minecraft-map\java-world" ^
//                              "C:\minecraft-map\bluemap\site\public\maps"
//
// For each dimension it prints the number of generated chunks in the Bedrock world, how many of
// those exist in the Java world (and their "Status" — BlueMap skips chunks whose status is
// "empty"), how many have a rendered BlueMap tile, and the areas with the most missing chunks, in
// block coordinates. With a Java world it also writes coverage-<dimension>.png to the current
// folder, one pixel per chunk (north is up): green = rendered, orange = in the Java world but not
// rendered, red = in the Bedrock world but missing from the Java world, blue = Java only.
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
// BlueMap hires tiles are 32x32 blocks, offset by 2 blocks (the map's hires "translate").
const HIRES_TILE = 32;
const HIRES_OFFSET = 2;

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

/** Hires tiles BlueMap rendered for a map: tiles/0/x1/2/z-3.prbm(.gz) is tile x=12, z=-3. */
function readRenderedTiles(mapDir) {
  const tiles = new Set();
  const root = mapDir && path.join(mapDir, 'tiles', '0');
  if (!root || !fs.existsSync(root)) return null;
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix + entry.name);
      else if (/\.prbm(\.gz)?$/.test(entry.name)) {
        const match = /^x(-?\d+)z(-?\d+)$/.exec(prefix + entry.name.replace(/\.prbm(\.gz)?$/, ''));
        if (match) tiles.add(chunkId(Number(match[1]), Number(match[2])));
      }
    }
  };
  walk(root, '');
  return tiles;
}

/** The hires tile containing the middle of a chunk. */
function tileOfChunk(id) {
  const [x, z] = id.split(',').map(Number);
  const tile = (block) => Math.floor((block - HIRES_OFFSET) / HIRES_TILE);
  return chunkId(tile(x * 16 + 8), tile(z * 16 + 8));
}

/** Writes an RGB PNG with one square per chunk; `colorOf(id)` returns [r, g, b] or null. */
function writeCoveragePng(file, chunkIds, colorOf) {
  const coords = [...chunkIds].map((id) => id.split(',').map(Number));
  if (coords.length === 0) return;
  const xs = coords.map((c) => c[0]);
  const zs = coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const chunksWide = Math.max(...xs) - minX + 1;
  const chunksHigh = Math.max(...zs) - minZ + 1;
  // Up to 8 pixels per chunk, keeping the image under ~2000 pixels across.
  const scale = Math.max(1, Math.min(8, Math.floor(2000 / Math.max(chunksWide, chunksHigh))));
  const width = chunksWide * scale;
  const height = chunksHigh * scale;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height, 0x20); // dark grey background
  for (let row = 0; row < height; row++) raw[row * stride] = 0; // filter: none
  for (const [x, z] of coords) {
    const color = colorOf(chunkId(x, z));
    if (!color) continue;
    for (let dz = 0; dz < scale; dz++) {
      for (let dx = 0; dx < scale; dx++) {
        const at = ((z - minZ) * scale + dz) * stride + 1 + ((x - minX) * scale + dx) * 3;
        raw[at] = color[0];
        raw[at + 1] = color[1];
        raw[at + 2] = color[2];
      }
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return `chunk X ${minX}..${minX + chunksWide - 1}, Z ${minZ}..${minZ + chunksHigh - 1}` +
    ` (block X ${minX * 16}, Z ${minZ * 16} at the top left; ${scale} px per chunk)`;
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
  const [dbPath, javaWorld, blueMapMaps] = process.argv.slice(2);
  if (!dbPath) {
    console.error('Usage: node map-coverage.js <bedrock world db folder> [<java world folder>] [<BlueMap maps folder>]');
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

    const tiles = readRenderedTiles(blueMapMaps && path.join(blueMapMaps, dimension.name));
    const unrendered = tiles ? [...javaChunks.keys()].filter((id) => !tiles.has(tileOfChunk(id))) : [];
    if (tiles) {
      console.log(`  ${tiles.size} BlueMap tiles rendered; ${unrendered.length} Java chunks have no tile`);
      if (unrendered.length) {
        console.log('  Largest areas of unrendered chunks:');
        for (const line of biggestAreas(unrendered)) console.log(line);
      }
    } else if (blueMapMaps) {
      console.log(`  No BlueMap tiles found for ${dimension.name}`);
    }

    const unrenderedSet = new Set(unrendered);
    const file = `coverage-${dimension.name}.png`;
    const extent = writeCoveragePng(file, new Set([...bedrockChunks, ...javaChunks.keys()]), (id) => {
      if (!javaChunks.has(id)) return [220, 50, 50]; // Bedrock only: lost in conversion
      if (!bedrockChunks.has(id)) return [70, 110, 220]; // Java only (Chunker border chunks)
      if (tiles && unrenderedSet.has(id)) return [240, 150, 30]; // not rendered
      return [60, 190, 80];
    });
    if (extent) console.log(`  Wrote ${file}: ${extent}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
