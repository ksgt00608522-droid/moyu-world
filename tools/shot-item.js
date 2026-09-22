/* 魔鱼世界 · 截图用的表达式（物品详情弹框）
   用法：node tools/probe.mjs <url> tools/shot-item.js shot-item.png

   清心草是可堆叠 + 能用的那一类，详情框里应当有：
   分类小标签（消耗品）、描述、数量「持有 3 个」、「使用」按钮。 */
(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.items.give('itm_purse', 1);
  G.items.give('itm_note', 1);
  G.items.give('itm_herb', 3);

  G.main.exec('bag', ['itm_herb']);
  await wait(700);
  return '物品详情弹框已打开：清心草 ×3';
})()
