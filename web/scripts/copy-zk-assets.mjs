/**
 * Copies the compiled ZK artifacts (prover/verifier keys, binary ZKIR) into
 * web/public so FetchZkConfigProvider can serve them from the origin in both
 * dev and build (Vite includes public/ in dist automatically):
 *   <origin>/keys/<circuit>.prover|.verifier
 *   <origin>/zkir/<circuit>.bzkir
 * Cross-platform replacement for the `cp -r` step in the official examples.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const managed = path.resolve(here, '..', '..', 'contracts', 'managed', 'evidence');
const publicDir = path.resolve(here, '..', 'public');

if (!fs.existsSync(managed)) {
  console.error(`Missing compiled contract at ${managed}. Run: npm run compile:evidence (repo root).`);
  process.exit(1);
}

fs.cpSync(path.join(managed, 'keys'), path.join(publicDir, 'keys'), { recursive: true });
fs.cpSync(path.join(managed, 'zkir'), path.join(publicDir, 'zkir'), { recursive: true });
console.log('ZK assets copied into web/public/keys and web/public/zkir.');
