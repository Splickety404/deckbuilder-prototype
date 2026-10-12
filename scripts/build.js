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
//
// Page markup that only the private build needs is wrapped in marker lines in index.html:
//     <!--PRIVATE-BEGIN-->  …  <!--PRIVATE-END-->
// The private build just drops the two marker lines; the public build drops everything between them.
//
// `--public` builds the version without anything private: files named *-private.js /
// *-private.css are left out, output goes to dist/public/ instead of the repo root, and a
// LEAK CHECK fails the build if any private vocabulary (a game's own card types, Google/Drive
// plumbing, API services…) is still in what would ship. It lists each hit by file so the
// remaining work is a to-do list. Use `--public --report` to see hits without failing.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const checkOnly = process.argv.includes('--check');
const publicBuild = process.argv.includes('--public');
const reportOnly = process.argv.includes('--report');

// Words that must never appear in the public build. Matched case-insensitively against
// every file that would ship, so each hit points at code still to be separated out.
const LEAK_PATTERNS = [
  /overlord/i, /champion/i, /stronghold/i, /resistance/i, /domination/i, /scheme/i, /\baspects?\b/i,
  /\bleaders?\b/i, /\bquest\b/i, /echo of omens/i, /hellbreak/i, /'[OCZQ] - /,
  /google/i, /script\.google/i, /\bably\b/i, /\bdrive\b/i, /idtoken/i,
];

function filesIn(dir, ext){
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(ext))
    .filter(f => !(publicBuild && f.includes('-private.'))).sort()
    .map(f => ({ name: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}
const joinFiles = files => files.map(f => f.text).join('');

// Counts private-vocabulary hits per file, as [{file, count, sample}].
function leakHits(files){
  const hits = [];
  for(const f of files){
    let count = 0, sample = new Set();
    for(const line of f.text.split('\n')){
      for(const re of LEAK_PATTERNS){
        const m = line.match(re);
        if(m){ count++; if(sample.size < 3) sample.add(m[0].toLowerCase()); break; }
      }
    }
    if(count) hits.push({ file: f.name, count, sample: [...sample].join(', ') });
  }
  return hits;
}

function stripPrivateMarkup(text){
  const block = /^[ \t]*<!--PRIVATE-BEGIN-->[ \t]*\n([\s\S]*?)^[ \t]*<!--PRIVATE-END-->[ \t]*\n/gm;
  return publicBuild ? text.replace(block, '') : text.replace(block, (m, inner) => inner);
}

let failed = false;
const apps = fs.readdirSync(srcDir).filter(d => fs.existsSync(path.join(srcDir, d, 'index.html')));
for(const app of apps){
  const dir = path.join(srcDir, app);
  const cssFiles = filesIn(path.join(dir, 'styles'), '.css');
  const jsFiles = filesIn(path.join(dir, 'js'), '.js');
  const css = joinFiles(cssFiles);
  const js = joinFiles(jsFiles);
  try{ new vm.Script(js, { filename: `${app} (joined script)` }); }
  catch(e){ console.error(`✗ ${app}: JavaScript syntax error — ${e.message}`); failed = true; continue; }
  const html = stripPrivateMarkup(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))
    .replace('<!--STYLES-->\n', () => `<style>\n${css}</style>\n`)
    .replace('<!--SCRIPTS-->\n', () => `<script>\n${js}</script>\n`);
  if(publicBuild){
    const hits = leakHits([...jsFiles, ...cssFiles, { name: 'index.html', text: stripPrivateMarkup(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')) }]);
    if(hits.length){
      const total = hits.reduce((n, h) => n + h.count, 0);
      console.error(`${reportOnly ? '•' : '✗'} ${app}: ${total} private-vocabulary line(s) would ship in the public build:`);
      hits.sort((a, b) => b.count - a.count).forEach(h => console.error(`    ${String(h.count).padStart(4)}  ${h.file}  (${h.sample})`));
      if(!reportOnly){ failed = true; continue; }
    }
  }
  if(!checkOnly){
    const outDir = publicBuild ? path.join(root, 'dist', 'public') : root;
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${app}.html`), html);
  }
  console.log(`✓ ${app}${checkOnly ? ' (syntax ok)' : ` → ${publicBuild ? 'dist/public/' : ''}${app}.html`}`);
}
process.exit(failed ? 1 : 0);
