/* 魔鱼世界 · 截图用的表达式（供 tools/probe.mjs 当表达式用）

   用法：node tools/probe.mjs <url> tools/shot-pair.js shot-pair.png

   专门拍"一个位置旁边站着两个人"这张图，一次看清一级 / 二级两块的分工：
     一级区（中栏「地图点位状态」）：两个人各一行（名字 + 态度）+ 各一个说话按钮，
                                     正在说话的那个按钮**高亮**，另一个照旧列着
     二级区（右栏「二级操作」）：抬头「正在跟神秘人说话」+ 台词 + 选项 + 结束对话

   路线：(4,3) → 左 (3,3) → 上 (3,2) → 上 (3,1) → 右 (4,1)。
   这时神秘人在正下方 (4,2)。

   素材里现在没有能让人同时站在两人旁边的 NPC（神秘人在 (4,2)、商人在 (2,4)，
   隔了四格），所以这里临时给商人补一个位置 (5,1) 把场景造出来 ——
   只影响这一张截图，不动素材文件。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.main.submit('left');   /* (4,3) → (3,3) */
  G.main.submit('up');     /* (3,3) → (3,2) */
  G.main.submit('up');     /* (3,2) → (3,1) */
  G.main.submit('right');  /* (3,1) → (4,1)  ← 神秘人在下边，商人在右边 */

  G.data.npc('npc_merchant').at.push({ room: 'room_hall', x: 5, y: 1 });
  G.ui.refresh();

  /* 点一级区那个按钮，走玩家那条路 */
  const btn = document.querySelector('#tile button[data-arg="npc_mystery"]');
  if (btn) btn.click();

  await wait(700);   /* 等自动存档和状态面板刷新完 */
  return '界面已就绪：角色站在 room_hall 的 (4,1)，旁边同时有神秘人与商人';
})()
