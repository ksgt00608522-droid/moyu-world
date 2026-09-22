/* 魔鱼世界 · 截图用的表达式（弹框：状态详情）
   用法：node tools/probe.mjs <url> tools/shot-buff.js shot-buff.png

   摆一个"状态详情开着"的场面，一眼能看出这几件事有没有画对：
     - 标题是**状态自己的名字**，右边带「正面 / 负面」小标签
     - 四块内容齐全：描述 / 剩余量 / 影响 / 计时
     - 「影响」那一块把 mods 和 tick 都写出来了（中毒只有 tick）
     - 弹框后面压着遮罩，底下的界面还在（不是整页跳走）

   数值都是直接改运行时数据，不写存档、不动素材。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  const p = G.state.player();
  p.hp = 20;
  G.statuses.add('st_poison');   /* 有 tick：每走一格生命 -2 */
  G.statuses.add('st_focus');    /* 有 mods：智力 +2 */
  G.main.submit('look');
  G.ui.refresh();

  /* 点左栏「状态」块里那个状态名 —— 跟玩家操作一样 */
  const btns = document.querySelectorAll('#buffs dd.buff button[data-cmd="buff"]');
  for (let i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute('data-arg') === 'st_poison') { btns[i].click(); break; }
  }

  await wait(700);   /* 等自动存档和面板刷新完 */
  return '界面已就绪：中毒的状态详情开着';
})()
