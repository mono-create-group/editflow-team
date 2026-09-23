const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
function extract(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  if (!match) throw new Error(`Missing ${name}`);
  const rest = source.slice(match.index);
  const next = /\n(?:async )?function [\w$]+\(/.exec(rest);
  return rest.slice(0, next ? next.index : undefined);
}
module.exports = {source, extract};
