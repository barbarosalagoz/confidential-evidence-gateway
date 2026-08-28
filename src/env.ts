/**
 * Loads `.env` into process.env, if present.
 *
 * Imported for its side effect, and imported FIRST by every entry point, so
 * that module-level `process.env` reads (the policy threshold, the private
 * score) see the file's values.
 *
 * `.env` holds the supplier's private compliance score and is git-ignored;
 * `.env.example` documents the variables with no real values. Uses Node's
 * built-in loader — no dotenv dependency.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`⚠ Could not read .env: ${(err as Error).message}`);
  }
}
