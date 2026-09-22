/* 魔鱼世界 · 截图用的表达式（供 tools/probe.mjs 当表达式用）

   用法：node tools/probe.mjs <url> tools/shot-npc.js shot-npc.png

   跟另外两个的分工：
     shot.js       角色停在空地上
     shot-door.js  角色停在门格上（点位状态多「通往」和进入按钮）
     shot-npc.js   角色停在 NPC **旁边**并开口说话（点位状态换成「对话」）

   出生点是大厅 (4,3)，神秘人站在 (4,2)。

   **NPC 现在挡路**，所以走不到它那一格上 —— 只能走到旁边再跟它说话。
   路线：(4,3) → 左 (3,3) → 上 (3,2)，这时神秘人在正右方。
   这一张图专门看「对话」面板：台词 + 一排选项（随便聊聊 / 接受任务 / 结束对话）。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.main.submit('left');   /* (4,3) → (3,3) */
  G.main.submit('up');     /* (3,3) → (3,2)，神秘人就在右边 (4,2) */

  /* 点面板上的说话按钮，走玩家那条路 */
  const btn = document.querySelector('#tile button[data-arg="npc_mystery"]');
  if (btn) btn.click();

  await wait(700);   /* 等自动存档和状态面板刷新完 */
  return '界面已就绪：角色站在 room_hall 的 (3,2)，正在跟神秘人对话';
})()
