#!/usr/bin/env node
// Prints the container log recorded by the "Palepail Last Seen" pack: who put items into or took
// them out of chests and other containers, and who broke or blew one up.
//
// Usage: node read-activity-log.js <Bedrock world db folder> [filters] [--json]
//   --player <name>    only entries involving this player
//   --item <item>      only entries with this item, e.g. enchanted_golden_apple
//   --near <x,z[,r]>   only containers within r blocks (default 10) of x,z
//   --action <action>  took, put, broke or exploded
//   --json             print the matching entries as JSON instead
//
// The pack keeps the latest ~3 MB of entries. Run it on the publish snapshot
// (C:\minecraft-map\snapshot\db) while the server runs, or on the live world's db with the server
// stopped; it shows what had been saved by then.
const { LevelDB } = require('leveldb-zlib');
const nbt = require('prismarine-nbt');

function parseArgs(argv) {
  const options = { json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg.startsWith('--')) options[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { dbPath: positional[0], options };
}

/** Every `pp_log:<page>` dynamic property, oldest page first. */
function logPages(buffer) {
  const pages = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const match = /^pp_log:(\d+)$/.exec(key);
      if (match && typeof value === 'string') pages.push([Number(match[1]), value]);
      else visit(value);
    }
  };
  for (let offset = 0; offset < buffer.length; ) {
    const { data, metadata } = nbt.protos.little.parsePacketBuffer('nbt', buffer, offset);
    visit(nbt.simplify(data));
    if (!metadata.size) break;
    offset += metadata.size;
  }
  return pages.sort((a, b) => a[0] - b[0]).map(([, text]) => text);
}

const shortName = (id) => id.replace('minecraft:', '');

function format(entry) {
  const when =
    entry.time > 1e12
      ? new Date(entry.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : `day ${entry.day}`;
  const who = entry.players.join(' or ');
  const where = `${entry.block} at ${entry.dimension} ${entry.x} ${entry.y} ${entry.z}`;
  const what =
    Object.entries(entry.items)
      .map(([id, count]) => `${count} ${shortName(id)}`)
      .join(', ') || 'nothing';
  const message = {
    took: `${who} took ${what} from ${where}`,
    put: `${who} put ${what} into ${where}`,
    broke: `${who} broke ${where} holding ${what}`,
    exploded: `${where} was blown up by ${who}, holding ${what}`,
  }[entry.action];
  return `${when}  ${message ?? JSON.stringify(entry)}`;
}

function matcher(options) {
  const player = options.player?.toLowerCase();
  const item = options.item && (options.item.includes(':') ? options.item : `minecraft:${options.item}`).toLowerCase();
  const near = options.near?.split(',').map(Number);
  return (entry) => {
    if (player && !entry.players.some((name) => name.toLowerCase() === player)) return false;
    if (item && !(item in entry.items)) return false;
    if (options.action && entry.action !== options.action) return false;
    if (near) {
      const [x, z, radius = 10] = near;
      if (Math.hypot(entry.x - x, entry.z - z) > radius) return false;
    }
    return true;
  };
}

async function main() {
  const { dbPath, options } = parseArgs(process.argv.slice(2));
  if (!dbPath) {
    console.error('Usage: node read-activity-log.js <world db folder> [--player name] [--item id] [--near x,z[,r]] [--action took|put|broke|exploded] [--json]');
    process.exit(2);
  }

  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();
  let pages;
  try {
    const dynamicProperties = await db.get('DynamicProperties');
    pages = dynamicProperties ? logPages(dynamicProperties) : [];
  } finally {
    await db.close();
  }

  const entries = [];
  for (const page of pages) {
    for (const line of page.split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (entry.pp_log === 1) entries.push(entry);
      } catch {
        // Skip a damaged line.
      }
    }
  }
  if (entries.length === 0) {
    console.log('No container activity recorded yet. Is the Last Seen pack (1.1.0 or newer) loaded?');
    return;
  }

  const matching = entries.filter(matcher(options));
  if (options.json) {
    process.stdout.write(JSON.stringify(matching, null, 2) + '\n');
    return;
  }
  for (const entry of matching) console.log(format(entry));
  console.log(`\n${matching.length} of ${entries.length} entries (oldest: ${format(entries[0]).split('  ')[0]})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
