/* 魔鱼世界 · 截图用的表达式（供 tools/probe.mjs 当表达式用）

   用法：node tools/probe.mjs <url> tools/shot.js shot.png

   在页面里建个角色、走两步，把界面摆成一个"活着"的样子，再截图。
   用途只有一个：肉眼确认界面有没有画歪。冒烟测试查不出布局问题。

   出生点 (4,3) 正上方 (4,2) 站着神秘人 —— **NPC 挡路**，
   所以绕一下走到 (4,1)：(4,3) → 左 (3,3) → 上×3 (3,1) → 右 (4,1)。 */

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
  G.main.submit('look');

  await wait(700);   /* 等自动存档和状态面板刷新完 */
  return '界面已就绪：角色在 room_hall 的 (4,1)，上面的门就在正上方';
})()
