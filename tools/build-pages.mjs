import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  current: { type: 'string' }, demo: { type: 'string' }, output: { type: 'string' },
} });
if (!values.current || !values.demo || !values.output) {
  throw new Error('Usage: node tools/build-pages.mjs --current <repo> --demo <repo> --output <new-directory>');
}

const output = path.resolve(values.output);
await mkdir(output);

async function copyOrdinaryFile(source, destination) {
  if (!(await lstat(source)).isFile()) throw new Error(`Expected an ordinary file: ${source}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyFlatDirectory(source, destination, extension = '') {
  if (!(await lstat(source)).isDirectory()) throw new Error(`Expected an ordinary directory: ${source}`);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) throw new Error(`Unexpected static asset: ${entry.name}`);
    await copyOrdinaryFile(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Missing or duplicate HTML marker: ${before}`);
  return text.replace(before, after);
}

async function buildVariant(repository, directory, demo) {
  const root = path.resolve(repository);
  const app = path.join(root, 'examples/hds-simulator');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid source revision');
  const sourceUrl = `https://github.com/ODevStudio/hds-simulator/tree/${revision}`;
  for (const file of ['dist/renderer.mjs', 'dist/renderer.wasm',
    'dist/renderer-meta.json', 'assets/hds-scale.png', 'assets/lucide-LICENSE']) {
    await copyOrdinaryFile(path.join(app, file), path.join(directory, file));
  }
  await copyFlatDirectory(path.join(app, 'src'), path.join(directory, 'src'), '.mjs');
  await copyFlatDirectory(path.join(root, 'licenses'), path.join(directory, 'licenses'));
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await copyOrdinaryFile(path.join(root, file), path.join(directory, file));
  }

  const label = demo ? 'Menu demo' : 'Current';
  const navigation = `<nav class="deployment-nav chrome" aria-label="Simulator versions">` +
    `<a href="${demo ? '../' : './'}"${demo ? '' : ' aria-current="page"'}>Current</a>` +
    `<a href="${demo ? './' : './demo/'}"${demo ? ' aria-current="page"' : ''}>Menu demo</a>` +
    `<a class="source-link" href="${sourceUrl}">Source</a>` +
    `<a href="https://github.com/ODevStudio/hds-simulator/blob/${revision}/THIRD_PARTY_NOTICES.md">Notices</a></nav>`;
  const original = await readFile(path.join(app, 'index.html'), 'utf8');
  if (!original.includes('<meta name="hds-control-api" content="">')) throw new Error('Static API must remain disabled');
  const titled = replaceOnce(original, '<title>HDS Browser Simulator</title>', `<title>HDS Simulator - ${label}</title>`);
  const html = replaceOnce(titled, '  <div class="workspace">', `  ${navigation}\n  <div class="workspace">`);
  await writeFile(path.join(directory, 'index.html'), html);
  const css = await readFile(path.join(app, 'styles.css'), 'utf8');
  await writeFile(path.join(directory, 'styles.css'), css + `
.deployment-nav { display: flex; align-items: center; gap: 18px; min-height: 36px; padding: 6px 18px; border-bottom: 1px solid var(--line); background: #fff; font-size: 12px; }
.deployment-nav a { color: var(--muted); text-decoration: none; padding: 3px 0; }
.deployment-nav a[aria-current="page"] { color: var(--accent); font-weight: 700; text-decoration: underline; text-underline-offset: 4px; }
.deployment-nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.deployment-nav .source-link { margin-left: auto; }
.workspace { min-height: calc(100vh - 112px); }
@media (min-width: 1100px) {
  .controls { max-height: calc(100vh - 112px); }
  .simulator { height: calc(100vh - 112px); }
}
@media (max-width: 700px) { .workspace { min-height: calc(100vh - 102px); } }
`);
  await writeFile(path.join(directory, 'build-info.json'), JSON.stringify({ variant: label, revision, sourceUrl }, null, 2) + '\n');
}

await buildVariant(values.current, output, false);
await buildVariant(values.demo, path.join(output, 'demo'), true);
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Static current and menu-demo simulators prepared in ${output}`);
