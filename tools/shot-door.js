/* 魔鱼世界 · 截图用的表达式（供 tools/probe.mjs 当表达式用）

   用法：node tools/probe.mjs <url> tools/shot-door.js shot.png

   跟 tools/shot.js 的区别：那个把角色停在空地上，这个停在门格上。
   门格上点位状态会多出「通往」和「进入这扇门」按钮，
   改门相关的界面时，两种状态都要看一眼才算数。

   出生点是大厅 (4,3)，上面的门在 (4,0)。

   **注意 (4,2) 站着神秘人 —— NPC 挡路，不能再一路往上走了。**
   得绕过去：(4,3) → 左 (3,3) → 上×3 (3,1) → 右 (4,1) → 上 (4,0)。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.main.submit('left');   /* (4,3) → (3,3) */
  G.main.submit('up');     /* (3,3) → (3,2) */
  G.main.submit('up');     /* (3,2) → (3,1) */
  G.main.submit('right');  /* (3,1) → (4,1) */
  G.main.submit('up');     /* (4,1) → (4,0)，上面那扇门 */

  await wait(700);   /* 等自动存档和状态面板刷新完 */
  return '界面已就绪：角色站在 room_hall 的 (4,0) 门格上';
})()
