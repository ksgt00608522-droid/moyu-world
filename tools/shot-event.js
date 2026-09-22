/* 魔鱼世界 · 截图用的表达式（供 tools/probe.mjs 当表达式用）

   用法：node tools/probe.mjs <url> tools/shot-event.js shot-event.png

   专门给事件点拍的：让角色站在泉水上，好一次看到三样东西 ——
     1. 地图上**互动型**事件点画着自己的字（泉 / 钱）
     2. 地图上**触发型**事件点还只是一个空框（地砖、石龛）
     3. 点位状态里那一块「地上」+ 互动按钮

   路线：(4,3) → 左×3 (1,3) → 上 (1,2)。
   不直着往上走 —— (4,2) 站着神秘人，会被挡下来。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  G.main.submit('left');   /* (4,3) → (3,3) */
  G.main.submit('left');   /* (3,3) → (2,3) */
  G.main.submit('left');   /* (2,3) → (1,3) */
  G.main.submit('up');     /* (1,3) → (1,2)  ← 泉水 */

  await wait(700);   /* 等自动存档和状态面板刷新完 */
  return '界面已就绪：角色站在 room_hall 的 (1,2) —— 泉水上面';
})()
