/* 魔鱼世界 · 截图用的表达式（笔记本弹框）
   用法：node tools/probe.mjs <url> tools/shot-note.js shot-note.png

   摆一个"笔记本有内容"的场面：
     - 「进行中」一栏：已接的走十步（报进度 0 / 10）
     - 「已完成」一栏：交过两次差的搭把手（写「完成 2 次」）
     - 可重复任务两栏都出现（搭把手正在做第 3 轮时）

   数值都是直接改运行时数据，不写存档、不动素材。 */
(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.items.give('itm_purse', 1);
  G.items.give('itm_note', 1);
  G.items.addMoney('coin', 30);

  G.quests.accept('q_walk10');
  G.quests.accept('q_patrol');
  G.quests.ensure('q_patrol').times = 2;
  G.quests.add('walk', 3);

  G.main.exec('bag', ['use', 'itm_note']);
  await wait(700);
  return '笔记本弹框已打开：进行中 2 条 / 已完成 1 条';
})()
