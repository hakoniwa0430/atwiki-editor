'use strict';

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const colorValue = (value) =>
  /^(?:[a-zA-Z]{1,30}|#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/.test(
    value || '',
  )
    ? value
    : '';
const lengthValue = (value) =>
  /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|em|rem|%|vw|vh)?$/.test(value || '')
    ? /\d$/.test(value)
      ? `${value}px`
      : value
    : '';
function splitTop(text, delimiter = ',') {
  const result = [];
  let start = 0,
    parens = 0,
    braces = 0,
    brackets = 0,
    quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === delimiter) {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '"' && (i === 0 || /[=,(]/.test(text[i - 1]))) {
      quote = c;
      continue;
    }
    if (c === '(') parens++;
    if (c === ')') parens = Math.max(0, parens - 1);
    if (c === '{') braces++;
    if (c === '}') braces = Math.max(0, braces - 1);
    if (c === '[') brackets++;
    if (c === ']') brackets = Math.max(0, brackets - 1);
    if (c === delimiter && !parens && !braces && !brackets) {
      result.push(text.slice(start, i));
      start = i + 1;
    }
  }
  result.push(text.slice(start));
  return result;
}
function parameters(args) {
  const parts = splitTop(args).map((s) => s.trim()),
    values = Object.create(null),
    flags = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0 && !/^(?:https?:\/\/|[&#])/i.test(part))
      values[part.slice(0, eq).trim()] = part
        .slice(eq + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1');
    else if (part) flags.push(part);
  }
  return { parts, values, flags };
}
/** Reads balanced parentheses and repeated brace delimiters without regex backtracking. */
function readPlugin(text, offset = 0) {
  const m = text.slice(offset).match(/^[&#]([a-zA-Z][\w]*)/);
  if (!m) return null;
  let end = offset + m[0].length,
    args = '',
    body = null,
    bodyStart = end;
  if (text[end] === '(') {
    let balance = 1,
      j = end + 1,
      quote = false;
    for (; j < text.length && balance; j++) {
      if (text[j] === '"' && text[j - 1] !== '\\') {
        quote = !quote;
        continue;
      }
      if (quote) continue;
      if (text[j] === '(') balance++;
      if (text[j] === ')') balance--;
    }
    if (balance) return null;
    args = text.slice(end + 1, j - 1);
    end = j;
  }
  if (text[end] === '{') {
    let width = 1;
    while (text[end + width] === '{') width++;
    bodyStart = end + width;
    if (width > 1) {
      let closing = text.indexOf('}'.repeat(width), bodyStart);
      if (closing < 0) return null;
      let run = width;
      while (text[closing + run] === '}') run++;
      closing += run - width;
      body = text.slice(bodyStart, closing);
      end = closing + width;
    } else {
      let balance = 1,
        j = end + 1;
      for (; j < text.length && balance; j++) {
        if (text[j] === '{') balance++;
        if (text[j] === '}') balance--;
      }
      if (balance) return null;
      body = text.slice(end + 1, j - 1);
      end = j;
    }
  }
  if (text[end] === ';') end++;
  return {
    name: m[1].toLowerCase(),
    args,
    body,
    end,
    bodyStart,
    raw: text.slice(offset, end),
    block: text[offset] === '#',
  };
}
const CSS_PROPERTIES = new Set(
  'color background-color font-size font-family font-weight font-style font-variant line-height text-align text-decoration text-decoration-line text-decoration-color text-decoration-style text-indent text-shadow letter-spacing word-spacing white-space overflow-wrap word-break vertical-align width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-width border-style border-color border-radius border-collapse border-spacing display float clear overflow overflow-x overflow-y opacity list-style-type column-count column-gap box-shadow box-sizing'.split(
    ' ',
  ),
);
function safeStyle(input, warn = () => {}) {
  const out = [];
  for (const declaration of String(input || '').split(';')) {
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(':');
    const property = declaration.slice(0, colon).trim().toLowerCase(),
      value = declaration.slice(colon + 1).trim();
    if (
      colon < 1 ||
      !CSS_PROPERTIES.has(property) ||
      !value ||
      /[<>{}\\@]|url\s*\(|expression|javascript|behavior|!important/i.test(value) ||
      !/^[\w\s#.,%()+\-/'"]+$/.test(value)
    ) {
      warn(`CSS指定を除外: ${property || declaration}`);
      continue;
    }
    out.push(`${property}:${value}`);
  }
  return out.length ? out.join(';') + ';' : '';
}
function decoration(input, warn = () => {}) {
  let colors = 0,
    styles = [];
  for (const item of splitTop(input, ':')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (['left', 'right', 'center'].includes(item)) styles.push(`text-align:${item}`);
    else if (['bold', 'b'].includes(item)) styles.push('font-weight:bold');
    else if (['italic', 'i'].includes(item)) styles.push('font-style:italic');
    else if (lengthValue(item)) styles.push(`font-size:${lengthValue(item)}`);
    else if (colorValue(item))
      styles.push(`${colors++ ? 'color' : 'background-color'}:${colorValue(item)}`);
    else warn(`表の装飾指定: ${item}`);
  }
  return styles.length ? styles.join(';') + ';' : '';
}
module.exports = {
  escapeHtml,
  colorValue,
  lengthValue,
  splitTop,
  parameters,
  readPlugin,
  safeStyle,
  decoration,
};
