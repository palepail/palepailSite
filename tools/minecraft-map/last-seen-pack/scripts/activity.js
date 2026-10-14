// Logs who puts items into and takes items out of containers (chests, barrels, shulker boxes,
// hoppers, furnaces...), and who breaks or blows up a container and what was in it.
//
// The stable Script API has no "container changed" event, so when a player opens a container the
// script snapshots its contents, re-checks them every half second while the player stays nearby,
// and logs the difference. A hopper feeding a chest that someone has open is credited to them; if
// several players have the same container open, the entry names all of them.
//
// Each entry goes to the content log as "[activity] ..." (with the server's real time) and is
// saved in the world as JSON lines in `pp_log:<page>` dynamic properties, which
// tools/minecraft-map/read-last-seen/read-activity-log.js prints.
import { system, world } from '@minecraft/server';

const CHECK_EVERY_TICKS = 10;
const MAX_DISTANCE = 8; // blocks; further away than this, the player has closed the container
const MAX_OPEN_TICKS = 20 * 60 * 10; // stop watching after 10 minutes
const PAGE_LIMIT = 30000; // characters; dynamic property strings max out at 32767
const MAX_PAGES = 100; // oldest pages are deleted beyond this (~3 MB)
const INDEX_KEY = 'pp_log_index';

const shortName = (id) => id.replace('minecraft:', '');
const dimensionName = (id) => shortName(id).replace('the_end', 'end');

/** Item ID -> total count in the block's container, or undefined if it isn't a container. */
function contents(block) {
  let container;
  try {
    container = block?.getComponent('minecraft:inventory')?.container;
  } catch {
    return undefined;
  }
  if (!container) return undefined;
  const counts = {};
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item) counts[item.typeId] = (counts[item.typeId] ?? 0) + item.amount;
  }
  return counts;
}

/** Items in `after` but not `before` (put) and the other way round (took). */
function difference(before, after) {
  const put = {};
  const took = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = (after[id] ?? 0) - (before[id] ?? 0);
    if (change > 0) put[id] = change;
    else if (change < 0) took[id] = -change;
  }
  return { put, took };
}

const isEmpty = (items) => Object.keys(items).length === 0;
const describeItems = (items) =>
  Object.entries(items)
    .map(([id, count]) => `${count} ${shortName(id)}`)
    .join(', ');

// --- Saving -------------------------------------------------------------------------------------

function readIndex() {
  try {
    const value = world.getDynamicProperty(INDEX_KEY);
    if (typeof value === 'string') return JSON.parse(value);
  } catch {
    // Start a new log.
  }
  return { first: 0, last: 0 };
}

function append(line) {
  const index = readIndex();
  const key = `pp_log:${index.last}`;
  const page = world.getDynamicProperty(key);
  const text = typeof page === 'string' ? page : '';
  if (text && text.length + line.length + 1 > PAGE_LIMIT) {
    index.last++;
    world.setDynamicProperty(`pp_log:${index.last}`, line);
    while (index.last - index.first >= MAX_PAGES) {
      world.setDynamicProperty(`pp_log:${index.first}`, undefined);
      index.first++;
    }
    world.setDynamicProperty(INDEX_KEY, JSON.stringify(index));
  } else {
    world.setDynamicProperty(key, text ? `${text}\n${line}` : line);
    if (!text) world.setDynamicProperty(INDEX_KEY, JSON.stringify(index));
  }
}

/** Records one entry. `players` is a list of names; `items` maps item IDs to counts. */
function log(action, players, block, items) {
  const entry = {
    pp_log: 1,
    // The script engine's clock may be missing (0); the content log line has the real time.
    time: Date.now(),
    day: world.getDay(),
    tick: world.getAbsoluteTime(),
    action,
    players,
    block: shortName(block.typeId),
    dimension: dimensionName(block.dimension),
    x: block.x,
    y: block.y,
    z: block.z,
    items,
  };
  const who = players.join(' or ');
  const where = `${entry.block} at ${entry.dimension} ${entry.x} ${entry.y} ${entry.z}`;
  const what = describeItems(items) || 'nothing';
  const message = {
    took: `${who} took ${what} from ${where}`,
    put: `${who} put ${what} into ${where}`,
    broke: `${who} broke ${where} holding ${what}`,
    exploded: `${where} was blown up by ${who}, holding ${what}`,
  }[action];
  console.warn(`[activity] ${message}`);
  try {
    append(JSON.stringify(entry));
  } catch (error) {
    console.warn(`[activity] could not save: ${error}`);
  }
}

// --- Watching open containers -------------------------------------------------------------------

/** Container key "dim x y z" -> { block info, snapshot, viewers: Map<player id, name>, opened } */
const open = new Map();

const blockKey = (dimension, { x, y, z }) => `${dimension} ${x} ${y} ${z}`;

/** A plain copy of what log() needs, since Block objects go stale. */
function blockInfo(block) {
  return { typeId: block.typeId, dimension: block.dimension.id, x: block.x, y: block.y, z: block.z };
}

function check(watched, current) {
  if (current === undefined) return;
  const { put, took } = difference(watched.snapshot, current);
  const names = [...watched.viewers.values()];
  if (!isEmpty(took)) log('took', names, watched.block, took);
  if (!isEmpty(put)) log('put', names, watched.block, put);
  watched.snapshot = current;
}

function currentContents(watched) {
  try {
    const { dimension, x, y, z } = watched.block;
    return contents(world.getDimension(dimension).getBlock({ x, y, z }));
  } catch {
    return undefined; // chunk unloaded
  }
}

function stopWatching(playerId) {
  for (const [key, watched] of open) {
    if (watched.viewers.delete(playerId) && watched.viewers.size === 0) open.delete(key);
  }
}

world.afterEvents.playerInteractWithBlock.subscribe(({ player, block, isFirstEvent }) => {
  if (!isFirstEvent) return;
  const snapshot = contents(block);
  if (snapshot === undefined) return;
  const key = blockKey(block.dimension.id, block);
  // A player can only have one container open at a time.
  for (const [otherKey, watched] of open) {
    if (otherKey !== key && watched.viewers.has(player.id)) {
      check(watched, currentContents(watched));
    }
  }
  stopWatching(player.id);
  let watched = open.get(key);
  if (!watched) {
    watched = { block: blockInfo(block), snapshot, viewers: new Map() };
    open.set(key, watched);
  }
  watched.viewers.set(player.id, player.name);
  watched.opened = system.currentTick;
});

system.runInterval(() => {
  if (open.size === 0) return;
  const players = new Map(world.getAllPlayers().map((p) => [p.id, p]));
  for (const [key, watched] of open) {
    check(watched, currentContents(watched));
    const { block } = watched;
    for (const id of [...watched.viewers.keys()]) {
      const player = players.get(id);
      const away =
        !player ||
        player.dimension.id !== block.dimension ||
        Math.hypot(player.location.x - block.x, player.location.y - block.y, player.location.z - block.z) >
          MAX_DISTANCE;
      if (away) watched.viewers.delete(id);
    }
    if (watched.viewers.size === 0 || system.currentTick - watched.opened > MAX_OPEN_TICKS) open.delete(key);
  }
}, CHECK_EVERY_TICKS);

// --- Breaking and explosions --------------------------------------------------------------------

// Before-events can read the container but can't save, so record on the next tick.
world.beforeEvents.playerBreakBlock.subscribe(({ player, block }) => {
  const items = contents(block);
  if (items === undefined) return;
  const info = blockInfo(block);
  const name = player.name;
  system.run(() => {
    const key = blockKey(info.dimension, info);
    const watched = open.get(key);
    if (watched) {
      // Changes made just before breaking it.
      const { put, took } = difference(watched.snapshot, items);
      const names = [...watched.viewers.values()];
      if (!isEmpty(took)) log('took', names, info, took);
      if (!isEmpty(put)) log('put', names, info, put);
      open.delete(key);
    }
    log('broke', [name], info, items);
  });
});

world.beforeEvents.explosion.subscribe((event) => {
  const destroyed = [];
  for (const block of event.getImpactedBlocks()) {
    const items = contents(block);
    if (items !== undefined) destroyed.push([blockInfo(block), items]);
  }
  if (destroyed.length === 0) return;
  let cause = 'Explosion';
  try {
    const source = event.source;
    if (source) cause = source.typeId === 'minecraft:player' ? source.name : `${shortName(source.typeId)} explosion`;
  } catch {
    // Source already gone.
  }
  system.run(() => {
    for (const [info, items] of destroyed) {
      open.delete(blockKey(info.dimension, info));
      log('exploded', [cause], info, items);
    }
  });
});

console.warn('[activity] container log loaded');
