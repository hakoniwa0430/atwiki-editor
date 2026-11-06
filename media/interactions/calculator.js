'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AtWikiFeatures ||= {}).calculator = factory();
})(globalThis, function () {
  function calculate(text) {
    const tokens = String(text).match(/(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/%()]/g) || [];
    if (tokens.join('') !== String(text).replace(/\s/g, '') || tokens.length > 1000)
      throw Error('数値と + - * / % ( ) を入力してください');
    let i = 0;
    function value(depth = 0) {
      if (depth > 50) throw Error('括弧が深すぎます');
      let t = tokens[i++];
      if (t === '+') return value(depth + 1);
      if (t === '-') return -value(depth + 1);
      if (t === '(') {
        const n = sum(depth + 1);
        if (tokens[i++] !== ')') throw Error('括弧が閉じていません');
        return n;
      }
      if (t === undefined || !/^\d|^\./.test(t)) throw Error('式が不正です');
      return +t;
    }
    function product(d) {
      let n = value(d);
      while (['*', '/', '%'].includes(tokens[i])) {
        const op = tokens[i++],
          r = value(d);
        n = op === '*' ? n * r : op === '/' ? n / r : n % r;
      }
      return n;
    }
    function sum(d = 0) {
      let n = product(d);
      while (['+', '-'].includes(tokens[i])) {
        const op = tokens[i++],
          r = product(d);
        n = op === '+' ? n + r : n - r;
      }
      return n;
    }
    const result = sum();
    if (i !== tokens.length || !Number.isFinite(result)) throw Error('計算できません');
    return result;
  }
  function click(el) {
    if (el.hasAttribute('data-calculate')) {
      const calc = el.closest('.calculator');
      try {
        calc.querySelector('output').textContent = String(
          calculate(calc.querySelector('input').value),
        );
      } catch (e) {
        calc.querySelector('output').textContent = e.message;
      }
    }
  }

  return { calculate, click };
});
