#!/usr/bin/env node
// Deletes chunks nobody has built in or used, so the game generates them again from the seed with
// the current version's terrain and biomes. Works directly on the Bedrock world: no conversion.
//
// Usage: node prune-chunks.js [world folder] [options]
//   world folder      defaults to E:\Games\Minecraft Bedrock Server\worlds\Bedrock level
//   --dimension <d>   overworld (default), nether, end or all
//   --buffer <n>      also keep chunks within n chunks of anything kept (default 4)
//   --keep <x,z,r>    also keep everything within r blocks of x,z (overworld; repeatable).
//                     Use <dimension>:<x>,<z>,<r> for another dimension, e.g. nether:0,0,200
//   --stamps <file>   the map publish's chunk-stamps.json (default C:\minecraft-map\chunk-stamps.json)
//   --markers <file>  map markers to keep around (default ..\markers.json)
//   --apply           actually delete. Without it, nothing is changed: it only reports and writes
//                     prune-<dimension>.png (green: used, light green: kept nearby, red: delete)
//   --no-backup       with --apply, skip the backup copy of the db folder
//
// A chunk is kept when there's evidence a player used it:
//   - it has a block entity a player made or touched: chests, furnaces, signs, beds, hoppers...
//     Loot chests nobody has opened yet, spawners, bee nests and other naturally generated ones
//     don't count. Villages have beds and furnaces, so they're kept too;
//   - the map publish saw it change since it started tracking (chunk-stamps.json);
//   - it's near a player's saved position, the world spawn, a map marker or a --keep area;
//   - it's within --buffer chunks of any of the above.
// Builds that left no block entity (a dirt hut, a tunnel, a farm with no chests) are only kept if
// they're near something else. Check the preview and add --keep areas before applying.
//
// --apply needs the server stopped: the running server locks the world.
const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const { LevelDB } = require('leveldb-zlib');
const { openWorld, resolveDbPath, DEFAULT_WORLD } = require('./open-world');
const { writeCoveragePng } = require('./map-coverage');

const DIMENSIONS = ['overworld', 'nether', 'end'];
const REGION_FOLDERS = {
  'dimensions/minecraft/overworld/region': 0,
  region: 0,
  'dimensions/minecraft/the_nether/region': 1,
  'DIM-1/region': 1,
  'dimensions/minecraft/the_end/region': 2,
  'DIM1/region': 2,
};
// Block entities that generate naturally (with no player involved).
const NATURAL_BLOCK_ENTITIES = new Set([
  'MobSpawner', 'TrialSpawner', 'Vault', 'Beehive', 'BrushableBlock', 'SculkSensor',
  'CalibratedSculkSensor', 'SculkCatalyst', 'SculkShrieker', 'EndGateway', 'EndPortal',
  'DecoratedPot', 'Bell', 'FlowerPot', 'Cauldron', 'PistonArm', 'MovingBlock', 'Dispenser',
  'CreakingHeart',
]);
const SPAWN_RADIUS_CHUNKS = 8;
const PLAYER_RADIUS_CHUNKS = 4;
const MARKER_RADIUS_BLOCKS = 64;
const VERSION_TAGS = new Set([0x2c, 0x76]); // one per generated chunk
const BLOCK_ENTITY_TAG = 0x31;
const BATCH_SIZE = 5000;

// --- Arguments -----------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    dimension: 'overworld',
    buffer: 4,
    keep: [],
    stamps: 'C:\\minecraft-map\\chunk-stamps.json',
    markers: path.join(__dirname, '..', 'markers.json'),
    apply: false,
    backup: true,
  };
  let world;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--no-backup') options.backup = false;
    else if (arg === '--dimension') options.dimension = argv[++i];
    else if (arg === '--buffer') options.buffer = Number(argv[++i]);
    else if (arg === '--keep') options.keep.push(argv[++i]);
    else if (arg === '--stamps') options.stamps = argv[++i];
    else if (arg === '--markers') options.markers = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else world = arg;
  }
  if (!['overworld', 'nether', 'end', 'all'].includes(options.dimension)) {
    throw new Error('--dimension must be overworld, nether, end or all');
  }
  if (!Number.isInteger(options.buffer) || options.buffer < 0) throw new Error('--buffer must be 0 or more');
  options.keep = options.keep.map((spec) => {
    const match = /^(?:(overworld|nether|end):)?(-?\d+),(-?\d+),(\d+)$/.exec(spec);
    if (!match) throw new Error(`--keep ${spec}: expected x,z,radius or dimension:x,z,radius`);
    return { dimension: DIMENSIONS.indexOf(match[1] ?? 'overworld'), x: +match[2], z: +match[3], r: +match[4] };
  });
  return { world: world ?? DEFAULT_WORLD, options };
}

// --- Helpers -------------------------------------------------------------------------------------

const id = (x, z) => `${x},${z}`;
const blockToChunk = (b) => Math.floor(b / 16);

/** For a chunk record key: { dimension, x, z, tag }, or null for any other key. */
function chunkKey(key) {
  let dimension = 0;
  let tagAt;
  switch (key.length) {
    case 9: case 10: tagAt = 8; break;
    case 13: case 14: tagAt = 12; dimension = key.readInt32LE(8); break;
    default: return null;
  }
  const tag = key[tagAt];
  if (!((tag >= 0x2b && tag <= 0x3f) || tag === 0x76)) return null;
  if (key.length - tagAt === 2 && tag !== 0x2f) return null; // only sub-chunks have a y byte
  if (dimension < 0 || dimension > 2) return null;
  if (key.every((b) => b >= 0x20 && b < 0x7f)) return null; // a named record, not a chunk
  return { dimension, x: key.readInt32LE(0), z: key.readInt32LE(4), tag };
}

/** For an entity index key ("digp" + x + z [+ dimension]): { dimension, x, z }, or null. */
function entityIndexKey(key) {
  if (key.length !== 12 && key.length !== 16) return null;
  if (key.toString('latin1', 0, 4) !== 'digp') return null;
  return { dimension: key.length === 16 ? key.readInt32LE(12) : 0, x: key.readInt32LE(4), z: key.readInt32LE(8) };
}

function parseAll(buffer) {
  const roots = [];
  for (let offset = 0; offset < buffer.length; ) {
    const { data, metadata } = nbt.protos.little.parsePacketBuffer('nbt', buffer, offset);
    roots.push(nbt.simplify(data));
    if (!metadata.size) break;
    offset += metadata.size;
  }
  return roots;
}

/** The first block entity in a chunk that shows a player made or used it, or null. */
function playerBlockEntity(value) {
  let entities;
  try {
    entities = parseAll(value);
  } catch {
    return 'unreadable block entity'; // keep it to be safe
  }
  for (const entity of entities) {
    const kind = String(entity.id ?? '');
    if (NATURAL_BLOCK_ENTITIES.has(kind)) continue;
    if (entity.LootTable) continue; // a loot chest nobody has opened
    return kind || 'block entity';
  }
  return null;
}

class ChunkSet {
  constructor() {
    this.chunks = DIMENSIONS.map(() => new Map());
  }
  add(dimension, x, z, reason) {
    const map = this.chunks[dimension];
    if (map && !map.has(id(x, z))) map.set(id(x, z), reason);
  }
  addSquare(dimension, cx, cz, radius, reason) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) this.add(dimension, x, z, reason);
    }
  }
}

function readJson(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Chunks the map publish saw change after its first run, from chunk-stamps.json. */
function changedChunksFromStamps(file, used) {
  const stamps = readJson(file);
  if (!stamps) return 0;
  let baseline = Infinity;
  for (const chunks of Object.values(stamps)) {
    for (const [, stamp] of Object.values(chunks)) baseline = Math.min(baseline, stamp);
  }
  let count = 0;
  for (const [regionKey, chunks] of Object.entries(stamps)) {
    const match = /^(.*)\/r\.(-?\d+)\.(-?\d+)\.mca$/.exec(regionKey);
    const dimension = match && REGION_FOLDERS[match[1]];
    if (dimension === undefined || dimension === null) continue;
    for (const [index, [, stamp]] of Object.entries(chunks)) {
      if (stamp <= baseline) continue;
      used.add(dimension, Number(match[2]) * 32 + (index % 32), Number(match[3]) * 32 + Math.floor(index / 32), 'changed since the map started tracking');
      count++;
    }
  }
  return count;
}

/** The world spawn from level.dat (8-byte header, then little-endian NBT). */
function readSpawn(worldDir) {
  try {
    const data = fs.readFileSync(path.join(worldDir, 'level.dat'));
    const level = parseAll(data.subarray(8))[0];
    if (typeof level.SpawnX === 'number' && typeof level.SpawnZ === 'number') {
      return { x: level.SpawnX, z: level.SpawnZ };
    }
  } catch {
    // Fall back to 0,0.
  }
  return { x: 0, z: 0 };
}

// --- Main ----------------------------------------------------------------------------------------

async function main() {
  const { world, options } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(world);
  const worldDir = path.basename(dbPath) === 'db' ? path.dirname(dbPath) : dbPath;
  const targets = options.dimension === 'all' ? [0, 1, 2] : [DIMENSIONS.indexOf(options.dimension)];

  // Evidence of use ("used"), and other reasons to keep a chunk ("protected").
  const used = new ChunkSet();
  const protectedChunks = new ChunkSet();
  const existing = DIMENSIONS.map(() => new Set());

  const spawn = readSpawn(worldDir);
  protectedChunks.addSquare(0, blockToChunk(spawn.x), blockToChunk(spawn.z), SPAWN_RADIUS_CHUNKS, 'world spawn');

  for (const marker of readJson(options.markers) ?? []) {
    const dimension = DIMENSIONS.indexOf(marker.dimension ?? 'overworld');
    const radius = Math.ceil(MARKER_RADIUS_BLOCKS / 16);
    protectedChunks.addSquare(dimension, blockToChunk(marker.x), blockToChunk(marker.z), radius, `marker "${marker.name}"`);
  }
  for (const keep of options.keep) {
    protectedChunks.addSquare(keep.dimension, blockToChunk(keep.x), blockToChunk(keep.z), Math.ceil(keep.r / 16), '--keep');
  }
  const changed = changedChunksFromStamps(options.stamps, used);

  // Dry runs can read a copy while the server runs; deleting needs the real, unlocked world.
  let db;
  let close;
  if (options.apply) {
    db = new LevelDB(dbPath, { createIfMissing: false });
    try {
      await db.open();
    } catch (error) {
      throw new Error(`Can't open ${dbPath} for writing (${error.message}). Stop the Minecraft server first.`);
    }
    close = () => db.close();
  } else {
    ({ db, close } = await openWorld(world));
  }

  let players = 0;
  try {
    for await (const [key, value] of db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })) {
      const chunk = chunkKey(key);
      if (chunk) {
        if (VERSION_TAGS.has(chunk.tag)) existing[chunk.dimension].add(id(chunk.x, chunk.z));
        if (chunk.tag === BLOCK_ENTITY_TAG) {
          const reason = playerBlockEntity(value);
          if (reason) used.add(chunk.dimension, chunk.x, chunk.z, reason);
        }
        continue;
      }
      const text = key.toString('latin1');
      if (text.startsWith('player_server_') || text === '~local_player') {
        try {
          const player = parseAll(value)[0];
          const [x, , z] = player.Pos ?? [];
          if (typeof x === 'number') {
            protectedChunks.addSquare(player.DimensionId ?? 0, blockToChunk(x), blockToChunk(z), PLAYER_RADIUS_CHUNKS, 'a player is there');
            players++;
          }
        } catch {
          // Skip an unreadable player.
        }
      }
    }

    // Keep everything near a used chunk.
    const keep = new ChunkSet();
    for (let dimension = 0; dimension < 3; dimension++) {
      for (const [chunkId, reason] of protectedChunks.chunks[dimension]) keep.chunks[dimension].set(chunkId, reason);
      for (const chunkId of used.chunks[dimension].keys()) {
        const [x, z] = chunkId.split(',').map(Number);
        keep.addSquare(dimension, x, z, options.buffer, 'near a used chunk');
      }
    }

    console.log(`World: ${worldDir}`);
    console.log(`Spawn ${spawn.x}, ${spawn.z}; ${players} player position(s); ${changed} chunk(s) changed since the map started tracking`);
    const toDelete = DIMENSIONS.map(() => new Set());
    for (const dimension of targets) {
      const all = existing[dimension];
      let usedCount = 0;
      for (const chunkId of all) {
        if (used.chunks[dimension].has(chunkId)) usedCount++;
        else if (!keep.chunks[dimension].has(chunkId)) toDelete[dimension].add(chunkId);
      }
      const name = DIMENSIONS[dimension];
      console.log(`\n${name}: ${all.size} generated chunks`);
      console.log(`  ${usedCount} used, ${all.size - usedCount - toDelete[dimension].size} kept nearby, ${toDelete[dimension].size} to delete (${Math.round((100 * toDelete[dimension].size) / Math.max(1, all.size))}%)`);
      const file = `prune-${name}.png`;
      const extent = writeCoveragePng(file, all, (chunkId) =>
        used.chunks[dimension].has(chunkId) ? [40, 170, 60] : toDelete[dimension].has(chunkId) ? [200, 50, 40] : [150, 220, 150]);
      if (extent) console.log(`  Preview: ${path.resolve(file)}: ${extent}`);
    }

    const total = toDelete.reduce((n, set) => n + set.size, 0);
    if (!options.apply) {
      console.log(`\nDry run: nothing was changed. Check the preview, then run again with --apply (server stopped) to delete ${total} chunk(s).`);
      return;
    }
    if (total === 0) {
      console.log('\nNothing to delete.');
      return;
    }

    if (options.backup) {
      const backup = path.join(worldDir, `db-backup-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`);
      console.log(`\nBacking up the db folder to ${backup}`);
      await close();
      close = async () => {};
      fs.cpSync(dbPath, backup, { recursive: true });
      db = new LevelDB(dbPath, { createIfMissing: false });
      await db.open();
      close = () => db.close();
    }

    console.log(`Deleting ${total} chunk(s)...`);
    // Collect first, then delete, so the scan never sees a half-changed database.
    const keys = [];
    for await (const [key, value] of db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })) {
      const record = chunkKey(key);
      const location = record ?? entityIndexKey(key);
      if (!location || !toDelete[location.dimension]?.has(id(location.x, location.z))) continue;
      if (!record) {
        // The chunk's entities: "digp" lists their ids, each stored under "actorprefix" + id.
        for (let at = 0; at + 8 <= value.length; at += 8) {
          keys.push(Buffer.concat([Buffer.from('actorprefix'), value.subarray(at, at + 8)]));
        }
      }
      keys.push(Buffer.from(key));
    }
    for (let at = 0; at < keys.length; at += BATCH_SIZE) {
      await db.batch(keys.slice(at, at + BATCH_SIZE).map((key) => ({ type: 'del', key })));
    }
    const deletedKeys = keys.length;
    console.log(`Deleted ${total} chunk(s) (${deletedKeys} records). They'll generate again when someone goes there.`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
