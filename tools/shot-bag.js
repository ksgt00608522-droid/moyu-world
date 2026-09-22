/* 魔鱼世界 · 截图用的表达式（玩家背包）
   用法：node tools/probe.mjs <url> tools/shot-bag.js shot-bag.png

   摆一个"背包有货"的场面，一眼能看出这几件事有没有画对：
     - 左栏最下面那块是**玩家背包**，标题上没有「预留」小标签
     - 物品**并排成标签**（不是一行一个），可堆叠的带 ×N
     - 标签颜色按分类走（消耗品绿 / 特殊蓝）
     - 三类物品齐了：钱袋（唯一）、笔记本（唯一）、清心草（可堆叠 ×3）

   数值都是直接改运行时数据，不写存档、不动素材。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.items.give('itm_purse', 1);
  G.items.give('itm_note', 1);
  G.items.give('itm_herb', 3);
  G.items.addMoney('coin', 30);

  /* 让笔记本里有东西可看：接一个、交过一个 */
  G.quests.accept('q_walk10');
  G.quests.ensure('q_patrol').times = 2;

  G.statuses.add('st_focus');
  G.main.submit('look');
  G.ui.refresh();

  await wait(700);
  return '界面已就绪：背包三个物品（钱袋 / 笔记本 / 清心草 ×3），钱包 30 金币';
})()
