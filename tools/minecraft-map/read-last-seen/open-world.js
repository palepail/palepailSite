// Opens a Bedrock world's LevelDB database for reading, even while the server is running.
//
// The running server locks the database, so if it can't be opened directly it is copied (without
// the lock file) to a temporary folder and the copy is read. The copy includes the server's write
// log, so it's as current as the world on disk: usually a few seconds behind the game.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LevelDB } = require('leveldb-zlib');

const DEFAULT_WORLD = 'E:\\Games\\Minecraft Bedrock Server\\worlds\\Bedrock level';

/** Accepts a world folder or its db folder; defaults to the server's world. */
function resolveDbPath(input = DEFAULT_WORLD) {
  const nested = path.join(input, 'db');
  return fs.existsSync(path.join(nested, 'CURRENT')) ? nested : input;
}

/** Returns { db, close() }; close() also removes any temporary copy. */
async function openWorld(input) {
  const dbPath = resolveDbPath(input);
  if (!fs.existsSync(path.join(dbPath, 'CURRENT'))) {
    throw new Error(`No Bedrock world database at ${dbPath}`);
  }

  const direct = new LevelDB(dbPath, { createIfMissing: false });
  try {
    await direct.open();
    return { db: direct, close: () => direct.close() };
  } catch {
    // Locked by the running server; read a copy instead.
  }

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-world-'));
  for (const name of fs.readdirSync(dbPath)) {
    if (name === 'LOCK') continue;
    try {
      fs.copyFileSync(path.join(dbPath, name), path.join(copy, name));
    } catch (error) {
      // The server may delete a file mid-copy after compacting; the rest is still consistent.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  console.error(`(The world is in use by the server; reading a copy of it taken just now.)`);
  const db = new LevelDB(copy, { createIfMissing: false });
  await db.open();
  return {
    db,
    close: async () => {
      await db.close();
      fs.rmSync(copy, { recursive: true, force: true });
    },
  };
}

module.exports = { openWorld, resolveDbPath, DEFAULT_WORLD };
