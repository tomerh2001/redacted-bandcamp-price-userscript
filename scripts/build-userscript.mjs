import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const outputDir = path.join(rootDir, 'dist');

await mkdir(outputDir, { recursive: true });

const userscriptHeader = `// ==UserScript==
// @name         RED Bandcamp Price Userscript
// @namespace    https://github.com/tomerh2001/redacted-bandcamp-price-userscript
// @version      ${packageJson.version}
// @description  Annotate RED and OPS request-page Bandcamp links with availability and price details.
// @author       ${packageJson.author}
// @match        https://redacted.sh/requests.php?action=view*
// @match        https://orpheus.network/requests.php?action=view*
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @homepageURL  https://github.com/tomerh2001/redacted-bandcamp-price-userscript
// @supportURL   https://github.com/tomerh2001/redacted-bandcamp-price-userscript/issues
// @downloadURL  https://raw.githubusercontent.com/tomerh2001/redacted-bandcamp-price-userscript/main/dist/redacted-bandcamp-price.user.js
// @updateURL    https://raw.githubusercontent.com/tomerh2001/redacted-bandcamp-price-userscript/main/dist/redacted-bandcamp-price.user.js
// ==/UserScript==`;

await build({
  entryPoints: [path.join(rootDir, 'src', 'userscript.js')],
  outfile: path.join(outputDir, 'redacted-bandcamp-price.user.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  banner: {
    js: userscriptHeader,
  },
});
