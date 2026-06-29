const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const outputFile = path.join(docsDir, 'generated-docs.md');

function scanDir(dir, ext) {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    if (fs.statSync(fullPath).isDirectory()) {
      entries.push(...scanDir(fullPath, ext));
    } else if (fullPath.endsWith(ext)) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function extractComments(content) {
  const matches = [...content.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  return matches.map(m => m[1].trim()).join('\n\n');
}

function buildSection(title, items) {
  if (!items.length) return '';
  return `## ${title}\n\n${items.join('\n\n')}\n\n`;
}

const phpFiles = scanDir(path.join(root, 'backend', 'app'), '.php');
const tsxFiles = scanDir(path.join(root, 'frontend', 'pages'), '.tsx');
const sections = [];

const phpDocs = phpFiles.map(file => {
  const content = fs.readFileSync(file, 'utf8');
  const comments = extractComments(content);
  return comments ? `### ${path.relative(root, file)}\n\n${comments}` : null;
}).filter(Boolean);

const tsxDocs = tsxFiles.map(file => {
  const content = fs.readFileSync(file, 'utf8');
  const comments = extractComments(content);
  return comments ? `### ${path.relative(root, file)}\n\n${comments}` : null;
}).filter(Boolean);

let output = '# Generated Documentation\n\n';
output += buildSection('Backend sources', phpDocs);
output += buildSection('Frontend sources', tsxDocs);
output += 'Run `node scripts/generate-docs.js` after project changes to refresh this document.\n';

fs.writeFileSync(outputFile, output, 'utf8');
console.log(`Generated docs: ${outputFile}`);
