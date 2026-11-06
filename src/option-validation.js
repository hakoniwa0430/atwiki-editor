'use strict';
const { parameters, lengthValue, colorValue } = require('./syntax');
const schemas = {
  image: 'page width height x y alt title linkpage border percent',
  image2: 'page width height x y alt title linkpage border percent',
  ref: 'page width height x y alt title linkpage border percent',
  slide_img: 'width height auto position',
  img_slide: 'width height auto position',
  memo: 'rows cols',
  memox: 'rows cols',
  div: 'id class width height color bgcolor',
  hr: 'width height color',
  link2: 'title color bgcolor bordercolor target',
  link_atwiki: 'target',
  openclose: 'show',
  openclose2: 'show',
  marquee: 'size loop color bgcolor',
  calendar: 'lang option',
  presen: 'page',
  search: '',
  search2: '',
  search3: '',
  ls: 'sort sort2',
  lsd: 'sort sort2',
  ls2: 'sort sort2',
  ls3: 'sort sort2',
  ls_line: 'sort sep',
  list_by_search: 'target andor ignore ignore_word sort sort2 limit tag tagword errmsg blockquote',
  include_by_search:
    'word target andor ignore ignore_word sort sort2 limit tag tagword linktitle showtitle',
};
function validate(p, warn) {
  const { flags, values: v } = parameters(p.args);
  const supported = (key) => schemas[p.name]?.split(' ').includes(key);
  const bad = (key) => warn(p.name + ' の無効または未対応の指定: ' + key);
  if (Object.hasOwn(schemas, p.name))
    for (const key of Object.keys(v)) if (!schemas[p.name].split(' ').includes(key)) bad(key);
  for (const key of ['width', 'height', 'x', 'y', 'size'])
    if (supported(key) && v[key] !== undefined && (!lengthValue(v[key]) || parseFloat(v[key]) <= 0))
      bad(key);
  for (const key of ['color', 'bgcolor', 'bordercolor'])
    if (supported(key) && v[key] !== undefined && !colorValue(v[key])) bad(key);
  for (const key of ['rows', 'cols', 'limit'])
    if (supported(key) && v[key] !== undefined && (!/^\d+$/.test(v[key]) || +v[key] < 1)) bad(key);
  if (
    v.target &&
    ['link2', 'link_atwiki'].includes(p.name) &&
    !['self', 'blank'].includes(v.target)
  )
    bad('target');
  if (v.andor && !['and', 'or'].includes(v.andor)) bad('andor');
  if (v.sort && !['timestamp', 'timeasc', 'timedesc', 'create', 'pagename'].includes(v.sort))
    bad('sort');
  if (v.sort2 && !['asc', 'desc'].includes(v.sort2)) bad('sort2');
  if (p.name === 'calendar' && v.lang && !['ja', 'en'].includes(v.lang)) bad('lang');
  if (p.name === 'marquee' && v.loop && !/^\d+$/.test(v.loop)) bad('loop');
  if (p.name === 'openclose2' && flags.includes('block')) bad('block');
  if (p.name === 'expand' && !lengthValue(p.args)) bad('width');
  if (p.name === 'underdot')
    for (const f of flags) if (!colorValue(f) && !/^[1-9]px$/.test(f)) bad(f);
  if (p.name === 'presen') {
    if (v.page !== undefined && !v.page) bad('page');
    for (const f of flags) if (!['incremental', 'incrementa'].includes(f)) bad(f);
  }
  if (['slide_img', 'img_slide'].includes(p.name)) {
    if (v.width !== undefined && +v.width < 290) warn(p.name + ': width は290以上');
    if ((v.height !== undefined && +v.height < 200) || (v.width !== undefined && !v.height))
      warn(p.name + ': height は200以上');
    if (v.auto !== undefined && (!/^\d+$/.test(v.auto) || +v.auto < 2 || +v.auto > 10))
      warn(p.name + ': auto は2〜10');
    if (v.position && !['left', 'center', 'right'].includes(v.position)) bad('position');
  }
}
module.exports = { validate };
