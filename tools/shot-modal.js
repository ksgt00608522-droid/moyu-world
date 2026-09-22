/* 魔鱼世界 · 截图用的表达式（弹框：法术列表）
   用法：node tools/probe.mjs <url> tools/shot-modal.js shot-modal.png

   摆一个"身上挂着状态、法术列表开着"的场面，一眼能看出这几件事有没有画对：
     - 左栏属性排成 **2 行 3 列**，每格上面总值、下面括号明细（四项四色）
     - 生命掉到 30% 以下时每格的**总值**变 warn 色，明细不变色
     - 状态名是**可点的按钮**（点开弹框看效果）
     - 操作区「行动」组里是**一个固定的「释放法术」**，不再按技能数长按钮
     - 弹框：遮罩 + 居中方框，每条法术带名字 / 描述 / 释放按钮

   数值都是直接改运行时数据，不写存档、不动素材。 */

(async () => {
  const G = window.G;
  if (!G || !G.main) return '游戏没起来';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.getElementById('create-name').value = '摸鱼者';
  document.getElementById('create-go').click();

  const p = G.state.player();
  p.hp = 20;                     /* ≤30% → 属性被削 ×0.6，总值变 warn */
  G.statuses.add('st_poison');   /* 负面：每走一步掉血 */
  G.statuses.add('st_bless');    /* 正面：幸运 +2 */
  G.statuses.add('st_focus');    /* 正面：智力 +2（主动技能挂的） */
  G.main.submit('look');
  G.ui.refresh();

  /* 点操作区那个「释放法术」—— 走的是玩家真会走的那条路 */
  document.querySelector('#actions button[data-cmd="cast"]').click();

  await wait(700);   /* 等自动存档和面板刷新完 */
  return '界面已就绪：法术列表开着，身上三个状态，生命 20% 属性被削';
})()
