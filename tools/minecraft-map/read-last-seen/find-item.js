#!/usr/bin/env node
// Finds an item in every player's saved inventory, including players who are offline.
//
// Usage: node find-item.js <Bedrock world db folder> <item> [--containers]
//   <item>        e.g. enchanted_golden_apple or minecraft:diamond
//   --containers  also searches chests, barrels, shulker boxes and other block containers, plus
//                 entities (minecarts, donkeys, item frames, dropped items...)
//
// Bedrock saves each player under a "player_server_<id>" key: their inventory, ender chest,
// armour and offhand. Items inside shulker boxes and bundles are counted too. Player names aren't
// in that data; they come from the "Palepail Last Seen" pack, so players it hasn't recorded are
// shown by their position instead.
//
// Run it on the publish snapshot (C:\minecraft-map\snapshot\db) while the server runs, or on the
// live world's db with the server stopped. It shows the world as it was last saved.
const { LevelDB } = require('leveldb-zlib');
const nbt = require('prismarine-nbt');

// Older names some worlds still have saved.
const ALIASES = {
  'minecraft:enchanted_golden_apple': ['minecraft:appleenchanted'],
  'minecraft:golden_apple': ['minecraft:appleenchanted_golden'],
};
const DIMENSIONS = ['overworld', 'nether', 'end'];
const BLOCK_ENTITY_TAG = 0x31;
const LIST_LABELS = {
  Inventory: 'inventory',
  EnderChestInventory: 'ender chest',
  Armor: 'armour',
  Offhand: 'offhand',
  Mainhand: 'main hand',
  ChestItems: 'chest',
  Items: 'contents',
  Item: 'item',
};

/** Parses one or more little-endian NBT compounds stored back to back. */
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

/** prismarine-nbt longs are [high, low] int32 pairs. */
function longToString(value) {
  if (!Array.isArray(value)) return String(value);
  return BigInt.asIntN(64, (BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)).toString();
}

/**
 * Counts matching items anywhere under `node`. Returns a map of where they are, such as
 * "inventory" or "ender chest > shulker box", to how many.
 */
function countItems(node, names, where = [], found = new Map()) {
  if (Array.isArray(node)) {
    for (const child of node) countItems(child, names, where, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;

  const isItem = typeof node.Name === 'string' && typeof node.Count === 'number';
  if (isItem && names.has(node.Name)) {
    const label = where.join(' > ') || 'item';
    found.set(label, (found.get(label) ?? 0) + node.Count);
  }
  for (const [key, child] of Object.entries(node)) {
    if (!child || typeof child !== 'object') continue;
    let next = where;
    if (isItem) next = [...where, node.Name.replace('minecraft:', '').replace(/_/g, ' ')];
    else if (LIST_LABELS[key] && where.length === 0) next = [LIST_LABELS[key]];
    countItems(child, names, next, found);
  }
  return found;
}

function describe(found) {
  let total = 0;
  const parts = [];
  for (const [where, count] of found) {
    total += count;
    parts.push(`${count} in ${where}`);
  }
  return { total, text: parts.join(', ') };
}

function position(pos, dimension) {
  if (!Array.isArray(pos)) return dimension ?? 'unknown position';
  const [x, y, z] = pos.map(Math.floor);
  return `${dimension ? dimension + ' ' : ''}${x}, ${y}, ${z}`;
}

/** Player id -> name, from the Palepail Last Seen pack's records. */
function namesFromPack(buffer) {
  const names = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('pp_lastseen:') && typeof value === 'string') {
        try {
          names.set(key.slice('pp_lastseen:'.length), JSON.parse(value).name);
        } catch {
          // Not one of ours.
        }
      } else {
        visit(value);
      }
    }
  };
  try {
    parseAll(buffer).forEach(visit);
  } catch {
    // Unreadable; players are listed without names.
  }
  return names;
}

async function main() {
  const args = process.argv.slice(2);
  const withContainers = args.includes('--containers');
  const [dbPath, itemArg] = args.filter((a) => !a.startsWith('--'));
  if (!dbPath || !itemArg) {
    console.error('Usage: node find-item.js <world db folder> <item> [--containers]');
    console.error('  e.g. node find-item.js "C:\\minecraft-map\\snapshot\\db" enchanted_golden_apple');
    process.exit(2);
  }
  const item = (itemArg.includes(':') ? itemArg : `minecraft:${itemArg}`).toLowerCase();
  const names = new Set([item, ...(ALIASES[item] ?? [])]);

  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();
  try {
    const dynamicProperties = await db.get('DynamicProperties');
    const playerNames = dynamicProperties ? namesFromPack(dynamicProperties) : new Map();

    const players = [];
    const containers = [];
    let playersChecked = 0;
    let containersChecked = 0;
    let unreadable = 0;

    for await (const [key, value] of db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })) {
      const text = key.toString('latin1');
      const isPlayer = text.startsWith('player_server_') || text === '~local_player';
      const isEntity = withContainers && text.startsWith('actorprefix');
      const isBlockEntity =
        withContainers && (key.length === 9 || key.length === 13) && key[key.length - 1] === BLOCK_ENTITY_TAG;
      if (!isPlayer && !isEntity && !isBlockEntity) continue;

      let roots;
      try {
        roots = parseAll(value);
      } catch {
        unreadable++;
        continue;
      }

      if (isPlayer) {
        playersChecked++;
        const data = roots[0] ?? {};
        const id = data.UniqueID !== undefined ? longToString(data.UniqueID) : null;
        const { total, text: where } = describe(countItems(data, names));
        if (total) {
          players.push({
            who: (id && playerNames.get(id)) ?? `Unknown player (id ${id ?? text})`,
            at: position(data.Pos, DIMENSIONS[data.DimensionId]),
            total,
            where,
          });
        }
        continue;
      }

      const dimension = isBlockEntity && key.length === 13 ? DIMENSIONS[key.readInt32LE(8)] : 'overworld';
      for (const data of roots) {
        containersChecked++;
        const { total, text: where } = describe(countItems(data, names));
        if (!total) continue;
        const kind = String(data.id ?? data.identifier ?? 'container').replace('minecraft:', '');
        const at = isBlockEntity
          ? position([data.x, data.y, data.z], dimension)
          : position(data.Pos, null); // entities don't record their dimension
        containers.push({ who: kind, at, total, where });
      }
    }

    const print = (rows) => {
      for (const row of rows.sort((a, b) => b.total - a.total)) {
        console.log(`  ${row.who} at ${row.at}: ${row.total} (${row.where})`);
      }
    };
    const sum = (rows) => rows.reduce((n, row) => n + row.total, 0);

    console.log(`Searching for ${[...names].join(' / ')}`);
    console.log(`\nPlayers (${playersChecked} checked): ${players.length ? sum(players) : 'none'}`);
    print(players);
    if (withContainers) {
      console.log(`\nContainers and entities (${containersChecked} checked): ${containers.length ? sum(containers) : 'none'}`);
      print(containers);
    }
    if (unreadable) console.log(`\n${unreadable} record(s) couldn't be read and were skipped.`);
    if (playersChecked && players.some((p) => p.who.startsWith('Unknown'))) {
      console.log('\nUnknown players have no record from the Last Seen pack yet; use their position to tell who they are.');
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
