import { readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const botRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const positional = process.argv.slice(2).filter(value => value !== '--check');
if (positional.length > 1 || positional.some(value => value.startsWith('--'))) throw Error('LOUNGE_BUNDLE_ARGUMENT_INVALID');
const sourceRoot = await realpath(positional[0] || resolve(botRoot, '../website/Planet Cuhz/Planet Cuhz Website'));
const destination = resolve(botRoot, 'vendor/cuhz-lounge');
const entries = ['services/lounge-host/runtime.mjs', 'services/lounge-stage/renderer.mjs',
  'services/lounge-stage/renderer-model.mjs', 'services/lounge-stage/renderer-feed.mjs',
  'services/lounge-stage/renderer.css', 'src/styles/tokens.css',
  'services/lounge-stage/assets/world.webp', 'services/lounge-stage/assets/host.webp'];
const files = new Map(), external = new Set();
const safe = path => { const rel = relative(sourceRoot, path); if (rel.startsWith('..') || !rel || rel.includes('node_modules') || !(['.mjs', '.css'].includes(extname(path)) || ['services/lounge-stage/assets/world.webp', 'services/lounge-stage/assets/host.webp'].includes(rel.split('\\').join('/')))) throw Error('LOUNGE_BUNDLE_PATH_INVALID'); return rel.split('\\').join('/'); };
async function collect(path) {
  const name = safe(path); if (files.has(name)) return;
  if (await realpath(path) !== path) throw Error('LOUNGE_BUNDLE_SYMLINK_DENIED');
  const bytes = await readFile(path); files.set(name, bytes);
  if (extname(path) !== '.mjs') return;
  const text = bytes.toString('utf8');
  const patterns = [/\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    if (match[1].startsWith('.')) await collect(resolve(dirname(path), match[1]));
    else if (!match[1].startsWith('node:')) external.add(match[1]);
  }
}
for (const entry of entries) await collect(resolve(sourceRoot, entry));
const manifest = { format: 1, entry: 'services/lounge-host/runtime.mjs',
  externalDependencies: [...external].sort(),
  files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) };
if (!manifest.externalDependencies.every(name => ['pg', 'pngjs'].includes(name))) throw Error('LOUNGE_BUNDLE_DEPENDENCY_REVIEW_REQUIRED');
for (const [name, bytes] of files) {
  const target = join(destination, name);
  if (check) { if (!(await readFile(target)).equals(bytes)) throw Error('LOUNGE_BUNDLE_OUT_OF_DATE: ' + name); }
  else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
}
// Refuse stale/unexpected payloads; a bundle must not accidentally accumulate
// extra source or credentials during later updates. No cleanup deletes files.
async function inventory(path, prefix = '') {
  const out = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isSymbolicLink()) throw Error('LOUNGE_BUNDLE_SYMLINK_DENIED');
    if (item.isDirectory()) out.push(...await inventory(join(path, item.name), name + '/'));
    else out.push(name);
  }
  return out;
}
for (const name of await inventory(destination)) if (name !== 'manifest.json' && !files.has(name)) throw Error('LOUNGE_BUNDLE_EXTRA_FILE: ' + name);
const encoded = JSON.stringify(manifest, null, 2) + '\n';
if (check) { if (await readFile(join(destination, 'manifest.json'), 'utf8') !== encoded) throw Error('LOUNGE_BUNDLE_MANIFEST_OUT_OF_DATE'); }
else await writeFile(join(destination, 'manifest.json'), encoded);
console.log(`CUHZ Lounge bundle ${check ? 'verified' : 'written'}: ${files.size} files; external dependencies: ${[...external].sort().join(', ')}`);
