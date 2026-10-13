#!/usr/bin/env node
// Writes "last modified" timestamps into a Java world's region files so BlueMap re-renders only
// the chunks that changed.
//
// Usage: node stamp-regions.js <java world folder> <state file>
//
// Chunker leaves every chunk's timestamp at 0, and BlueMap skips chunks whose timestamp is older
// than its last render, so after the first render the map would never update. This fingerprints
// each chunk's stored data, compares it with the previous run (kept in <state file>), and stamps
// changed or new chunks with the current time; unchanged chunks keep their previous time.
// Prints one summary line: "<changed> of <total> chunks changed".
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECTOR = 4096;

function regionFiles(worldDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^r\.-?\d+\.-?\d+\.mca$/.test(entry.name) && path.basename(dir) === 'region') {
        files.push(full);
      }
    }
  };
  walk(worldDir);
  return files;
}

function main() {
  const [worldDir, stateFile] = process.argv.slice(2);
  if (!worldDir || !stateFile) {
    console.error('Usage: node stamp-regions.js <java world folder> <state file>');
    process.exit(2);
  }

  const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const next = {};
  const now = Math.floor(Date.now() / 1000);
  let total = 0;
  let changed = 0;

  for (const file of regionFiles(worldDir)) {
    const regionKey = path.relative(worldDir, file).split(path.sep).join('/');
    const data = fs.readFileSync(file);
    if (data.length < 2 * SECTOR) continue;
    const timestamps = Buffer.alloc(SECTOR);
    const known = previous[regionKey] ?? {};
    const seen = {};

    for (let i = 0; i < 1024; i++) {
      const location = data.readUInt32BE(i * 4);
      if (location === 0) continue;
      const offset = (location >>> 8) * SECTOR;
      if (offset + 5 > data.length) continue;
      const length = data.readUInt32BE(offset);
      const hash = crypto
        .createHash('sha1')
        .update(data.subarray(offset, offset + 4 + length))
        .digest('base64')
        .slice(0, 16);
      const before = known[i];
      const stamp = before && before[0] === hash ? before[1] : now;
      if (stamp === now) changed++;
      total++;
      timestamps.writeUInt32BE(stamp, i * 4);
      seen[i] = [hash, stamp];
    }

    const fd = fs.openSync(file, 'r+');
    try {
      fs.writeSync(fd, timestamps, 0, SECTOR, SECTOR);
    } finally {
      fs.closeSync(fd);
    }
    next[regionKey] = seen;
  }

  fs.writeFileSync(stateFile, JSON.stringify(next));
  console.log(`${changed} of ${total} chunks changed`);
}

main();
