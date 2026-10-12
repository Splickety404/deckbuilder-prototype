#!/usr/bin/env node
// Assembles each app in src/<app>/ into its single self-contained HTML file in the repo root
// (this is what GitHub Pages serves, so the output must stay exactly what the browser needs).
//
//   src/<app>/index.html     page shell; the lines <!--STYLES--> and <!--SCRIPTS--> mark where
//                            the joined styles/scripts go (the marker line itself is replaced)
//   src/<app>/styles/*.css   joined in filename order, wrapped in <style>…</style>
//   src/<app>/js/*.js        joined in filename order, wrapped in <script>…</script>
//
// Files are joined with nothing added between them, so splitting a big file into pieces and
// rebuilding gives back the identical file. The joined script is syntax-checked first.
// `--check` verifies without writing.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const checkOnly = process.argv.includes('--check');

function joinDir(dir, ext){
  if(!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}

let failed = false;
const apps = fs.readdirSync(srcDir).filter(d => fs.existsSync(path.join(srcDir, d, 'index.html')));
for(const app of apps){
  const dir = path.join(srcDir, app);
  const css = joinDir(path.join(dir, 'styles'), '.css');
  const js = joinDir(path.join(dir, 'js'), '.js');
  try{ new vm.Script(js, { filename: `${app} (joined script)` }); }
  catch(e){ console.error(`✗ ${app}: JavaScript syntax error — ${e.message}`); failed = true; continue; }
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
    .replace('<!--STYLES-->\n', () => `<style>\n${css}</style>\n`)
    .replace('<!--SCRIPTS-->\n', () => `<script>\n${js}</script>\n`);
  if(!checkOnly) fs.writeFileSync(path.join(root, `${app}.html`), html);
  console.log(`✓ ${app}${checkOnly ? ' (syntax ok)' : ` → ${app}.html`}`);
}
process.exit(failed ? 1 : 0);
