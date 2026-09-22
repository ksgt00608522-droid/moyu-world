/* 魔鱼世界 · 种子随机
   全局：G.rng

   规则：游戏里所有随机都必须走这里，禁止直接调用 Math.random()。
   否则存档无法复现，出 bug 时查不出来。

   cursor 就是 mulberry32 的完整内部状态（一个 uint32）。
   存档时把 cursor 一起存下来，读档时直接恢复，不需要重放。 */

var G = window.G || (window.G = {});

G.rng = (function () {

  var seed = 1;      /* 原始种子，只用于显示与重开同一局 */
  var cursor = 1;    /* 当前内部状态，恢复随机流用这个 */
  var step = 0;      /* 已推进步数，排查问题用 */

  function u32(n) {
    n = Math.floor(Number(n)) >>> 0;
    return n === 0 ? 1 : n;
  }

  function setSeed(n) {
    seed = u32(n);
    cursor = seed;
    step = 0;
  }

  function next() {
    cursor = (cursor + 0x6D2B79F5) >>> 0;
    var t = cursor;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    step++;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* 闭区间 [min, max] 的整数 */
  function int(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    if (max < min) { var t = min; min = max; max = t; }
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick(list) {
    return list[int(0, list.length - 1)];
  }

  function chance(p) {
    return next() < p;
  }

  function snapshot() {
    return { seed: seed, cursor: cursor, step: step };
  }

  function restore(s) {
    if (!s) return;
    seed = u32(s.seed);
    cursor = u32(s.cursor != null ? s.cursor : s.seed);
    step = Number(s.step) || 0;
  }

  /* 生成新种子。用 crypto 而不是 Math.random，保持全项目零 Math.random。 */
  function newSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return u32(a[0]);
    }
    return u32(Date.now());
  }

  return {
    setSeed: setSeed,
    next: next,
    int: int,
    pick: pick,
    chance: chance,
    snapshot: snapshot,
    restore: restore,
    newSeed: newSeed
  };

})();
