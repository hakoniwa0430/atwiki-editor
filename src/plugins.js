'use strict';
const groups = [
  require('./plugins/external'),
  require('./plugins/decoration'),
  require('./plugins/embedding'),
  require('./plugins/links'),
  require('./plugins/images'),
  require('./plugins/widgets'),
  require('./plugins/dates'),
  require('./plugins/navigation'),
  require('./plugins/layout'),
  require('./plugins/scripts'),
  { names: require('./page-plugins').NAMES, plugin: require('./page-plugins').pagePlugin },
];
const handlers = new Map();
for (const group of groups) {
  for (const name of group.names) {
    if (handlers.has(name)) throw new Error(`Duplicate plugin: ${name}`);
    handlers.set(name, group.plugin);
  }
}
const LOCAL_NAMES = [...handlers.keys(), ...Object.values(require('./plugin-structure')).flat()];
function plugin(p, ctx, depth = 0, line = 0) {
  return handlers.get(p.name)?.(p, ctx, depth, line) ?? null;
}
module.exports = { plugin, LOCAL_NAMES, formatDate: require('./plugins/dates').formatDate };
