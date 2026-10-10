// Records each player's last known position in a world dynamic property, saved with the world.
// tools/minecraft-map/read-last-seen reads these from the world files when the map is published.
// Uses only the stable @minecraft/server API, so the world needs no experiments.
import { system, world } from '@minecraft/server';

// Property names are `pp_lastseen:<player id>`; values are JSON starting with {"pp_lastseen":1,
// which is what the reader looks for.
const PREFIX = 'pp_lastseen:';
const SAVE_EVERY_TICKS = 20 * 60; // once a minute while online

function snapshot(player) {
  const { x, y, z } = player.location;
  return {
    key: PREFIX + player.id,
    value: JSON.stringify({
      pp_lastseen: 1,
      name: player.name,
      dimension: player.dimension.id.replace('minecraft:', '').replace('the_end', 'end'),
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
      // Changes on every save, so the publish script can tell the player was online since its last
      // run. The publish script time-stamps players itself: Bedrock's script engine may not have a
      // real clock (Date.now() can return 0).
      tick: system.currentTick,
      lastSeen: Date.now(),
    }),
  };
}

function save({ key, value }) {
  try {
    world.setDynamicProperty(key, value);
  } catch (error) {
    console.warn(`[last-seen] could not save ${key}: ${error}`);
  }
}

function saveAll() {
  for (const player of world.getAllPlayers()) {
    save(snapshot(player));
  }
}

system.runInterval(saveAll, SAVE_EVERY_TICKS);

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) save(snapshot(player));
});

// The player is still readable before they leave, but before-events can't write, so save on the
// next tick.
world.beforeEvents.playerLeave.subscribe(({ player }) => {
  const entry = snapshot(player);
  system.run(() => save(entry));
});
