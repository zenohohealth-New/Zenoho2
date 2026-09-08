/**
 * Load app/.env into process.env so `npm run check:env` applies the same rule
 * locally that `eas-build-post-install` applies in the cloud (D-037).
 * Expo does this itself at runtime; plain node does not.
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', '.env');

if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}
