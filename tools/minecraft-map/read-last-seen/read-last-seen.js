#!/usr/bin/env node
// Prints the players recorded by the "Palepail Last Seen" behavior pack as a JSON array:
//   [{ "name", "dimension", "x", "y", "z", "tick", "lastSeen" (ms since epoch, may be 0) }, ...]
//
// Usage: node read-last-seen.js <path to a Bedrock world's db folder> [--keys]
//   --keys  lists the database's named (non-chunk) keys and whether each holds pack data, to
//           check whether anything was recorded.
//
// The pack stores each player as a world dynamic property whose value is JSON starting with
// {"pp_lastseen":1, — so rather than decoding Bedrock's NBT layout, this looks for that marker in
// the stored bytes. World dynamic properties live under the "DynamicProperties" key; if nothing is
// found there, every non-chunk key is scanned as a fallback.
const { LevelDB } = require('leveldb-zlib');

const MARKER = Buffer.from('{"pp_lastseen":1,');

/** Returns the end index (exclusive) of the JSON object starting at `start`, or -1. */
function findObjectEnd(buffer, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < buffer.length; i++) {
    const c = buffer[i];
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x7b) {
      depth++;
    } else if (c === 0x7d && --depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

function collect(buffer, players) {
  for (let at = buffer.indexOf(MARKER); at !== -1; at = buffer.indexOf(MARKER, at + 1)) {
    const end = findObjectEnd(buffer, at);
    if (end === -1) continue;
    try {
      const entry = JSON.parse(buffer.subarray(at, end).toString('utf8'));
      const known = players.get(entry.name);
      if (typeof entry.name === 'string' && (!known || entry.lastSeen >= known.lastSeen)) {
        players.set(entry.name, {
          name: entry.name,
          dimension: entry.dimension,
          x: entry.x,
          y: entry.y,
          z: entry.z,
          tick: entry.tick ?? null,
          lastSeen: entry.lastSeen,
        });
      }
    } catch {
      // Not valid JSON after all; ignore.
    }
  }
}

/** Chunk keys are short binary coordinates; named records (like DynamicProperties) are text. */
function isTextKey(key) {
  return key.length > 0 && key.every((b) => b >= 0x20 && b < 0x7f);
}

async function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: node read-last-seen.js <world db folder>');
    process.exit(2);
  }

  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();
  try {
    if (process.argv.includes('--keys')) {
      for await (const [key, value] of db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })) {
        if (!isTextKey(key)) continue;
        const records = value.toString('latin1').split(MARKER.toString('latin1')).length - 1;
        console.log(`${key.toString('latin1')}  ${value.length} bytes${records ? `  <- ${records} last-seen record(s)` : ''}`);
      }
      return;
    }

    const players = new Map();
    const dynamicProperties = await db.get('DynamicProperties');
    if (dynamicProperties) collect(dynamicProperties, players);

    if (players.size === 0) {
      for await (const [key, value] of db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })) {
        if (isTextKey(key)) collect(value, players);
      }
    }

    const list = [...players.values()].sort((a, b) => b.lastSeen - a.lastSeen);
    process.stdout.write(JSON.stringify(list));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
