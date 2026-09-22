/* 魔鱼世界 · 截图用的表达式（玩家状态面板）
   用法：node tools/probe.mjs <url> tools/shot-status.js shot-status.png

   摆一个"状态满负荷"的场面，一眼能看出这几件事有没有画对：
     - 生命 / 灵性显示成百分比 + 细进度条（不是光秃秃的数字）
     - 生命掉到 30% 以下时，基础属性**当场被削**（力量 6 → 4）
     - 左栏只有三块：玩家状态 / 状态 / 玩家背包（**没有技能块**）
     - 多个状态**并排成标签**（不是一行一个），装不下自动换行
     - 正面 / 负面状态**配色不同**（buff 绿、debuff 红）

   生命 20（≤30% → 惩罚 ×0.6）：力量 (5 + 铁骨 1) × 0.6 = 3.6 → 4
   灵性 15（≤20%）：自动挂上「灵性枯竭」，一共四个状态

   数值都是直接改运行时数据，不写存档、不动素材。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  const p = G.state.player();
  p.hp = 20;                 /* 掉到 30% 以下，属性当场被削 */
  p.ess = 15;                /* ≤20%，挂上「灵性枯竭」 */
  G.statuses.add('st_poison');   /* 负面：每走一步掉血 */
  G.statuses.add('st_bless');    /* 正面：幸运 +2 */
  G.statuses.add('st_focus');    /* 正面：智力 +2 */
  G.statuses.syncEssence();

  G.main.submit('look');
  G.ui.refresh();

  await wait(700);   /* 等自动存档和面板刷新完 */
  return '界面已就绪：生命 20% / 灵性 15%，身上挂着四个状态（并排成标签）';
})()
