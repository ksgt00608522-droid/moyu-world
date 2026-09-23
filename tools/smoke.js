/* 魔鱼世界 · 冒烟测试（供 tools/probe.mjs 当表达式用）

   用法：node tools/probe.mjs <url> tools/smoke.js
   它会在页面里真的把游戏跑一遍：创建角色 → 走路 → 撞墙 → 进门 → 回大厅 → 存档往返。
   全部通过返回 0，有失败返回 1。

   这是交付前的最后一道闸。打包产物必须过这一关。 */

(async () => {
  const out = [];
  let failed = 0;
  const T = (name, cond) => {
    if (!cond) failed++;
    out.push((cond ? '  ✓ ' : '  ✗ ') + name);
  };

  const G = window.G;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);

  /* 点面板 / 地图上的按钮。
     找不到元素时**不抛错**，只返回 false —— 让对应的那条断言变红就行。
     不然一处改动就会让整个脚本中途炸掉，后面的检查一条都不跑，
     报出来的错还完全指不到真正的问题（写这一轮时踩过一次）。 */
  const tileBtn = (arg) => document.querySelector('#tile button[data-arg="' + arg + '"]');
  const clickArg = (arg) => { const b = tileBtn(arg); if (b) b.click(); return !!b; };
  const clickCmd = (cmd) => {
    const b = document.querySelector('#tile button[data-cmd="' + cmd + '"]');
    if (b) b.click();
    return !!b;
  };
  /* 只看不点。断言"按钮在不在"时**不能用 clickCmd** —— 它会真的点下去，
     把一次互动提前消耗掉，后面那几条断言就全跟着错（写这一轮时踩过一次）。 */
  const hasCmd = (cmd) => !!document.querySelector('#tile button[data-cmd="' + cmd + '"]');

  /* 二级操作（右栏那块）里的按钮。对话选项全在那儿 ——
     一级区那些「跟某某说话」按钮**也带 data-cmd="talk"**，
     所以查对话选项必须限定 #secondary，不能图省事查 #tile。 */
  const secBtn = (arg) => document.querySelector('#secondary button[data-arg="' + arg + '"]');
  const clickSec = (arg) => { const b = secBtn(arg); if (b) b.click(); return !!b; };

  /* 取元素的 class 字符串，元素不在时返回空串。
     **别写成 `(el || {}).className.indexOf(...)`** —— 元素不存在时
     `{}.className` 是 undefined，`.indexOf` 直接抛错，把后面几十条检查
     一起带走（反向验证时逮住的：那条破坏本来该变红几条，结果只报了个抛错）。 */
  const clsOf = (el) => (el && el.className) || '';

  /* 读 :root 上的 CSS 变量，以及把 #rrggbb 转成浏览器给的 rgb(...) 写法 ——
     用来比对"算出来的颜色"是不是真的等于主题里那个变量。
     只看类名在不在是验不出"颜色被写死成别的值"的。 */
  const cssVar = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name);
  const rgbOf = (hex) => {
    const h = String(hex).trim().replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
  };
  /* 一段文字真实占多宽。用 Range 量**内容**的宽度，
     不量盒子 —— 盒子会被父级拉满，量出来永远"装得下"。 */
  const textWidth = (node) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    return r.getBoundingClientRect().width;
  };

  const clickMove = (dir) => {
    const c = document.querySelector('#map [data-move="' + dir + '"]');
    if (c) c.click();
    return !!c;
  };

  out.push('模块');
  T('G 命名空间存在', !!G);
  T('rng / rules / data / state / save / quests / talk / events / ui / world / main 都在',
    !!(G && G.rng && G.rules && G.data && G.state && G.save && G.quests &&
       G.talk && G.events && G.ui && G.world && G.main));
  if (!G || !G.main) return out.join('\n');

  /* ---------- 创建角色页 ---------- */

  out.push('创建角色页');
  T('首次打开显示创建页', $('create-screen').hidden === false);
  T('创建页显示时游戏主界面是藏起来的', $('app').hidden === true);

  $('create-name').value = '';
  $('create-go').click();
  T('空名字被拦下', G.state.data === null && $('create-error').textContent.length > 0);

  $('create-name').value = '这个名字实在是太长了根本放不下';
  $('create-go').click();
  T('超长名字被拦下', G.state.data === null);

  $('create-name').value = '摸鱼测试号';
  $('create-go').click();
  T('正常名字能创建成功', !!G.state.data && G.state.player().name === '摸鱼测试号');
  T('创建后创建页隐藏', $('create-screen').hidden === true);
  T('创建后进入游戏主界面', $('app').hidden === false);
  T('落在 room_hall', G.state.data.world.roomId === 'room_hall');
  T('坐标等于 spawn (4,3)', G.state.data.world.x === 4 && G.state.data.world.y === 3);

  await wait(500);
  T('自动存档写进了本地存储', !!G.save.readLocal());

  /* ---------- 渲染 ---------- */

  out.push('界面渲染');
  const mapEl = $('map');
  const mapRows = mapEl.querySelectorAll('.row');
  const rowText = (i) => (mapRows[i] ? mapRows[i].textContent : '');
  T('地图渲染出 7 行', mapRows.length === 7);
  T('地图每行 9 个字符', Array.prototype.every.call(mapRows, (r) => r.textContent.length === 9));
  T('玩家那一格画的是名字的第一个字', rowText(3)[4] === '摸');
  T('不再用通用的 @ 表示玩家', rowText(3)[4] !== '@');
  T('上下两扇门画成「门」字', rowText(0)[4] === '门' && rowText(6)[4] === '门');
  T('左右两扇门画成「门」字', rowText(3)[0] === '门' && rowText(3)[8] === '门');
  T('门上不再画 + 号', rowText(0)[4] !== '+' && rowText(3)[0] !== '+');
  T('墙画成 #', rowText(0)[0] === '#' && rowText(6)[8] === '#');
  T('空地是空白，不是点', rowText(1)[1] === ' ' && rowText(2)[6] === ' ');

  /* 格子得是真正方形：量每个格子实际渲染出来的外框。
     不能拿 lineHeight 跟字宽比 —— 那样量到的是"字符盒"的比例，
     等宽字形本身高瘦，怎么比都不是正方形，第一版就写错在这里。
     实现上每个格子是 inline-block，宽高都由 --cell 决定。 */
  const cells = mapEl.querySelectorAll('span');
  T('地图格子数 = 7 行 × 9 列', cells.length === 63);

  const c0 = cells[0].getBoundingClientRect();
  const c1 = cells[1].getBoundingClientRect();
  T('格子宽高相等（正方形）', Math.abs(c0.width - c0.height) < 0.5);
  T('格子尺寸像样（边长 >= 12px）', c0.width >= 12);
  T('同行格子严格并排，不重叠不留缝',
    Math.abs((c1.left - c0.left) - c0.width) < 0.5);
  const r0 = mapRows[0].getBoundingClientRect();
  const r1 = mapRows[1].getBoundingClientRect();
  T('行间距等于格子高（不会拉成长方形）',
    Math.abs((r1.top - r0.top) - c0.height) < 0.5);

  /* 字形得装得进格子，否则墙会挤成一团、看起来像虚线。
     注意字号是加在格子上（--fs），不是加在 #map 上。 */
  const cellCs = getComputedStyle(cells[0]);
  const probe = document.createElement('span');
  probe.textContent = '0000000000';
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;letter-spacing:0;' +
                        'display:inline-block;font-family:' + cellCs.fontFamily + ';font-size:' + cellCs.fontSize;
  document.body.appendChild(probe);
  const adv = probe.getBoundingClientRect().width / 10;
  document.body.removeChild(probe);
  T('格子里装得下字形（格子宽 >= 字宽）', c0.width + 0.5 >= adv);

  /* 格子要按面板大小自适应，不能永远一个尺寸 ——
     否则面板再大，地图也只是缩在正中间一小块。 */
  const gridBox = mapEl.querySelector('.grid').getBoundingClientRect();
  const mapBox = mapEl.getBoundingClientRect();
  T('地图按面板大小放大，至少铺满一个方向',
    c0.width >= 56 || gridBox.width >= mapBox.width - 24 || gridBox.height >= mapBox.height - 24);

  /* 墙必须填满整格：背景色铺到边上，视觉上才是连续的墙 */
  const wallCs = getComputedStyle(cells[0]);
  T('墙格有背景色填充', wallCs.backgroundColor !== 'rgba(0, 0, 0, 0)' && wallCs.backgroundColor !== 'transparent');
  T('墙不画 # 字形，只用背景铺满（相邻墙格连成一片）', wallCs.color === 'rgba(0, 0, 0, 0)');
  T('空地的字是透明的（不画点）', getComputedStyle(mapEl.querySelector('.floor')).color === 'rgba(0, 0, 0, 0)');
  T('地图放得下时不出滚动条',
    mapEl.scrollHeight <= mapEl.clientHeight + 1 && mapEl.scrollWidth <= mapEl.clientWidth + 1);

  /* 玩家标记得跟别的东西分得开：名字首字 + 一圈框 + 底色 */
  const meCell = mapRows[3].children[4];
  const meCs = getComputedStyle(meCell);
  T('玩家格带 me 类', meCell.classList.contains('me'));
  T('玩家格有一圈框（inset 阴影画的，不占布局）',
    meCs.boxShadow && meCs.boxShadow !== 'none' && meCs.boxShadow.indexOf('inset') >= 0);
  T('玩家格有底色，跟空地分得开', meCs.backgroundColor !== 'rgba(0, 0, 0, 0)');
  T('玩家格的字缩过，不会顶到框上', parseFloat(meCs.fontSize) < c0.width);
  T('玩家格不参与"点相邻格子走路"（自己的格子不是目标）',
    !meCell.hasAttribute('data-move'));

  /* 门只是换了个字形，门本身还是原来那扇门：
     判定一律走 doorAt，跟画什么字没有关系。 */
  const doorCell = mapRows[0].children[4];
  const doorCs = getComputedStyle(doorCell);
  T('门格带 door 类', doorCell.classList.contains('door'));
  T('门格还留着原来的橙色底块（本体没动）', doorCs.backgroundColor !== 'rgba(0, 0, 0, 0)');
  T('门格的字缩过，满宽的汉字不贴边', parseFloat(doorCs.fontSize) < c0.width);
  T('门格照样被 doorAt 认出来（跟字形无关）', (() => {
    const d = G.data.doorAt(G.state.room(), 4, 0);
    return !!d && d.to === 'room_up';
  })());
  T('素材 tiles 里本来就没有 + 号（+ 从来只是画出来的）',
    G.state.room().tiles.join('').indexOf('+') < 0);

  /* 换个名字，首字跟着变 —— 用同一个格子重渲染一次即可 */
  const keepName = G.state.player().name;
  G.state.player().name = '鱼干';
  G.ui.renderMap();
  T('改名后地图上的标记跟着变成新名字的首字',
    document.querySelectorAll('#map .row')[3].children[4].textContent === '鱼');
  G.state.player().name = keepName;
  G.ui.renderMap();
  T('改回来又变回去',
    document.querySelectorAll('#map .row')[3].children[4].textContent === '摸');

  const statusText = $('status').textContent;
  T('玩家状态面板显示了角色名', statusText.indexOf('摸鱼测试号') >= 0);
  T('玩家状态面板不再重复显示坐标（已挪去点位状态）', statusText.indexOf('(4,3)') < 0);

  /* 没有等级、没有经验、没有金币、没有法力 ——
     见 docs/设定/04-数值与成长.md 的「已废弃」。 */
  T('面板上不再有等级', statusText.indexOf('等级') < 0);
  T('面板上不再有经验', statusText.indexOf('经验') < 0);
  T('面板上不再有金币', statusText.indexOf('金币') < 0);
  T('面板上不再有法力', statusText.indexOf('法力') < 0);
  T('面板上不再有旧的攻防速',
    statusText.indexOf('攻击') < 0 && statusText.indexOf('防御') < 0 && statusText.indexOf('速度') < 0);

  /* 六项基础属性：显示的是**最终值** */
  T('面板列出六项基础属性',
    ['力量', '智力', '精神', '灵巧', '幸运', '感知'].every((n) => statusText.indexOf(n) >= 0));

  /* 生命与灵性：百分比 + 细进度条 */
  T('面板列出生命与灵性', statusText.indexOf('生命') >= 0 && statusText.indexOf('灵性') >= 0);
  T('生命显示成百分比', statusText.indexOf('100%') >= 0);
  T('生命那一行有进度条', !!document.querySelector('#status dd.meter.hp .bar i'));
  T('灵性那一行有进度条', !!document.querySelector('#status dd.meter.ess .bar i'));

  /* 神性参与判定但不显示 */
  T('神性不上面板', statusText.indexOf('神性') < 0);

  /* ---------- 属性明细（2 行 3 列 + 括号四色） ----------

     六项属性排 2 行 3 列，每格两行：上面总值，下面括号明细。
     括号里固定四项 —— 基础 + 被动 + 状态 + 装备，各一种颜色。
     显示的是**惩罚后的实际贡献**，所以四项相加 ≈ 总值。
     见 docs/设定/04-数值与成长.md 的「面板怎么显示属性」。 */

  const attrCells = [...document.querySelectorAll('#status .attr')];
  T('六项属性排成 6 格', attrCells.length === 6);
  T('每格都有总值和括号明细',
    attrCells.every((c) => !!c.querySelector('.attr-total') && !!c.querySelector('.attr-parts')));
  T('明细固定四项（基础 + 被动 + 状态 + 装备）',
    attrCells.every((c) => c.querySelectorAll('.attr-parts .p').length === 4));
  T('四项的顺序固定：基础 / 被动 / 状态 / 装备',
    attrCells.every((c) => {
      const want = ['p-base', 'p-passive', 'p-status', 'p-gear'];
      const ps = c.querySelectorAll('.attr-parts .p');
      /* 每一项都先判空再 .classList —— 少一项时 [i] 是 undefined，
         直接 .classList 会抛错把后面几十条检查一起带走（反向验证时逮住的）。 */
      return want.every((k, i) => !!ps[i] && ps[i].classList.contains(k));
    }));

  /* 布局：真的是 2 行 3 列，不是 6 行 1 列（排成 6 行就白改了） */
  T('属性排成 2 行', (() => {
    const tops = new Set(attrCells.map((c) => Math.round(c.getBoundingClientRect().top)));
    return tops.size === 2;
  })());
  T('属性排成 3 列', (() => {
    const first = attrCells[0].getBoundingClientRect().top;
    return attrCells.filter((c) =>
      Math.abs(c.getBoundingClientRect().top - first) < 1).length === 3;
  })());
  T('属性块横跨整行（不挤在标签那一列里）', (() => {
    const box = document.querySelector('#status dd.attrs');
    if (!box) return false;
    return Math.abs(box.getBoundingClientRect().width -
                    $('status').getBoundingClientRect().width) < 26;
  })());

  /* 四色：真的不同色，而且真的来自主题变量（不是写死的十六进制） */
  T('四项颜色互不相同', (() => {
    const cols = [...attrCells[0].querySelectorAll('.attr-parts .p')]
      .map((p) => getComputedStyle(p).color);
    return cols.length === 4 && new Set(cols).size === 4;
  })());
  T('四项的颜色来自主题变量（基础=--fg-dim，被动=--accent，状态=--info，装备=--gear）',
    (() => {
      const ps = [...attrCells[0].querySelectorAll('.attr-parts .p')];
      const want = ['--fg-dim', '--accent', '--info', '--gear'];
      /* 先卡个数再逐项比 —— 少一项的话 every 只跑 3 遍，会"全部通过"，
         那这条就白写了（反向验证时逮住的）。 */
      return ps.length === want.length &&
        ps.every((p, i) => getComputedStyle(p).color === rgbOf(cssVar(want[i])));
    })());

  /* 括号里的数：四项相加 ≈ 上面的总值（这就是"惩罚后的实际贡献"的意思） */
  T('明细四项相加 ≈ 总值（玩家能自己核对）', attrCells.every((c) => {
    const sum = [...c.querySelectorAll('.attr-parts .p')]
      .reduce((a, p) => a + Number(p.textContent), 0);
    return Math.abs(sum - Number(c.querySelector('.attr-total').textContent)) <= 1;
  }));

  /* 明细装不装得下：这一栏窄，三个格子并排，文字超了就会横向溢出格子 */
  T('属性明细装得下，不会横向溢出格子', attrCells.every((c) =>
    textWidth(c.querySelector('.attr-parts')) <= c.getBoundingClientRect().width + 1));

  /* 括号明细跟 attrParts() 算出来的是同一份数，不是各算各的 */
  T('面板上的明细跟 rules.attrParts() 对得上', (() => {
    const parts = G.rules.attrParts();
    return G.rules.attrs.every((a, i) => {
      const ps = [...attrCells[i].querySelectorAll('.attr-parts .p')]
        .map((p) => Number(p.textContent));
      const want = ['base', 'passive', 'status', 'gear'].map((k) => parts[a.key][k]);
      return ps.length === want.length &&
        ps.every((v, j) => Math.abs(v - want[j]) < 0.05);
    });
  })());

  const tileText = $('tile').textContent;
  T('点位状态显示了房间名与坐标', tileText.indexOf('大厅') >= 0 && tileText.indexOf('(4,3)') >= 0);
  T('点位状态说明脚下是空地', tileText.indexOf('脚下') >= 0 && tileText.indexOf('空地') >= 0);
  T('点位状态不再列"可走"（跟地图重复）', tileText.indexOf('可走') < 0);
  T('点位状态不再列"本室出口"（开发信息，玩家用不上）', tileText.indexOf('本室出口') < 0);
  T('站在空地上时，点位状态里没有进入按钮',
    !document.querySelector('#tile button[data-cmd="enter"]'));
  T('站在空地上时，点位状态里也不该有"通往"', tileText.indexOf('通往') < 0);

  /* 出生点 (4,3) 紧挨着神秘人 (4,2)。NPC 挡路之后人只可能在旁边，
     所以这一块叫「旁边的人」，不是「脚下的人」。 */
  T('站在人旁边时，点位状态多出一块「旁边的人」', tileText.indexOf('旁边的人') >= 0);
  T('没有「脚下的人」这一块了（NPC 挡路，站不上去了）', tileText.indexOf('脚下的人') < 0);
  T('出生点是五行：区域 / 房间 / 坐标 / 脚下 / 旁边的人',
    $('tile').querySelectorAll('dt').length === 5);

  /* ---------- 玩家状态：数值 ---------- */

  out.push('玩家状态');
  T('属性表是六项', G.rules.attrs.length === 6);
  T('属性表的 key 是 str/int/spr/dex/luk/per',
    G.rules.attrs.map((a) => a.key).join(',') === 'str,int,spr,dex,luk,per');
  T('基础属性初始值都是 5', G.rules.ATTR_BASE === 5);
  T('六项基础属性都是 5',
    ['str', 'int', 'spr', 'dex', 'luk', 'per'].every((k) => G.state.player().base[k] === 5));
  T('生命初始满值', G.state.player().hp === 100 && G.state.player().hpMax === 100);
  T('灵性初始满值', G.state.player().ess === 100 && G.state.player().essMax === 100);
  T('神性基础是 0', G.state.player()[G.rules.DIV_KEY] === 0);

  /* 被动技能「铁骨」给力量 +1 —— 这是"修正项 → 最终属性"这条链的证明 */
  T('新建角色带着被动技能', G.skills.has('skl_ironbone'));
  T('被动技能的加成算进了最终属性（力量 5 + 1 = 6）', G.rules.attr('str') === 6);
  T('没有被动加成的属性还是 5', G.rules.attr('int') === 5);
  T('基础值没被被动技能改掉（还是 5）', G.state.player().base.str === 5);

  /* 生命惩罚：两档，取最严重的一档，按比例判 */
  T('满血不惩罚', G.rules.hpPenalty(100, 100) === 1);
  T('生命 61% 还不罚', G.rules.hpPenalty(61, 100) === 1);
  T('生命 60% 刚好进第一档（含边界）', G.rules.hpPenalty(60, 100) === 0.8);
  T('生命 31% 只罚第一档', G.rules.hpPenalty(31, 100) === 0.8);
  T('生命 30% 刚好进第二档（含边界）', G.rules.hpPenalty(30, 100) === 0.6);
  T('两档取最严重的一个，不叠加（10% 也只算 0.6）', G.rules.hpPenalty(10, 100) === 0.6);
  T('惩罚按比例算，不是绝对值（上限 200 时 100 算半血）',
    G.rules.hpPenalty(100, 200) === 0.8);

  /* 惩罚是**派生值**：改生命，属性跟着变；改回去，属性也回去。
     基础值从头到尾没被动过。 */
  const p0 = G.state.player();
  const keepHp0 = p0.hp;

  p0.hp = 50;
  G.ui.renderStatus();
  T('生命掉到 60% 以下，力量从 6 降到 5', G.rules.attr('str') === 5);
  /* 面板重画之后旧的 NodeList 就失效了，所以每次都重新查一遍 */
  const attrCell = (i) => document.querySelectorAll('#status .attr')[i];
  /* 取某一项明细的文字。**两级都要判空** —— 少一项时 querySelector 返回 null，
     直接 .textContent 会抛错把后面几十条检查一起带走（反向验证时逮住的）。 */
  const attrPart = (i, k) => {
    const c = attrCell(i);
    const p = c && c.querySelector('.attr-parts .p-' + k);
    return p ? p.textContent : '';
  };
  T('被惩罚时每一格属性都标了 warn（面板上看得见）',
    document.querySelectorAll('#status .attr.warn').length === 6);
  T('warn 落在**总值**上，而且真的是 --warn 那个色（不是别的颜色）',
    (() => {
      const t = document.querySelector('#status .attr.warn .attr-total');
      return !!t && getComputedStyle(t).color === rgbOf(cssVar('--warn'));
    })());
  T('括号明细不跟着变色（它本来就是彩色的，再染一遍就看不出四段了）',
    (() => {
      const ps = [...document.querySelectorAll('#status .attr.warn .attr-parts .p')];
      return ps.length > 0 &&
        ps.every((p) => getComputedStyle(p).color !== rgbOf(cssVar('--warn')));
    })());
  T('惩罚削的是「基础」和「被动」那两项（力量 5×0.8=4，被动 1×0.8=0.8）',
    attrPart(0, 'base') === '4' && attrPart(0, 'passive') === '0.8');
  T('惩罚不碰「状态」「装备」两项（它们加在惩罚之后）',
    attrPart(0, 'status') === '0' && attrPart(0, 'gear') === '0');

  p0.hp = 20;
  G.ui.renderStatus();
  T('生命掉到 30% 以下，力量降到 4', G.rules.attr('str') === 4);
  T('第二档惩罚更重（力量 5×0.6=3，被动 1×0.6=0.6）',
    attrPart(0, 'base') === '3' && attrPart(0, 'passive') === '0.6');

  p0.hp = keepHp0;
  G.ui.renderStatus();
  T('生命回到 60% 以上，力量自动变回 6', G.rules.attr('str') === 6);
  T('基础值一直是 5，惩罚不写回', p0.base.str === 5);
  T('满血时面板上没有 warn', !document.querySelector('#status .attr.warn'));
  T('满血时明细回到 5 / 1 / 0 / 0', attrPart(0, 'base') === '5' && attrPart(0, 'passive') === '1');

  /* 惩罚只削"角色固有"那一段（基础属性 + 被动技能）；
     主动技能和状态施加在惩罚**之后**，不吃削减。
     用智力试：基础 5、没有被动，5 × 0.6 = 3，再加状态的 +2 = 5。
     要是状态也被削，就是 (5 + 2) × 0.6 = 4.2 → 4 —— 两者分得开。 */
  G.statuses.add('st_focus');      /* 智力 +2 */
  p0.hp = 20;
  T('状态加在惩罚之后，不吃削减（5 × 0.6 + 2 = 5，不是 (5 + 2) × 0.6 = 4）',
    G.rules.attr('int') === 5);
  T('同一时刻，固有那一段确实被削了（力量 6 × 0.6 → 4）', G.rules.attr('str') === 4);
  p0.hp = 100;
  G.statuses.remove('st_focus');
  T('收尾：智力回到 5、力量回到 6',
    G.rules.attr('int') === 5 && G.rules.attr('str') === 6);

  /* ---------- 技能与状态 ---------- */

  out.push('技能与状态');
  T('技能表非空', G.data.skills.length > 0);
  T('技能 id 都带 skl_ 前缀', G.data.skills.every((s) => s.id.indexOf('skl_') === 0));
  T('技能都有 desc', G.data.skills.every((s) => typeof s.desc === 'string' && s.desc.length > 0));
  T('kind 只有 passive / active',
    G.data.skills.every((s) => s.kind === 'passive' || s.kind === 'active'));
  T('主动技能都指向一个真实状态',
    G.data.skills.filter((s) => s.kind === 'active').every((s) => !!G.data.status(s.applies)));
  T('被动技能都带 mods',
    G.data.skills.filter((s) => s.kind === 'passive')
      .every((s) => Array.isArray(s.mods) && s.mods.length > 0));
  T('修正项只写 add 或 pct',
    G.data.skills.every((s) => (s.mods || []).every((m) => m.add != null || m.pct != null)));

  T('状态表非空', G.data.statuses.length > 0);
  T('状态 id 都带 st_ 前缀', G.data.statuses.every((s) => s.id.indexOf('st_') === 0));
  T('状态都有 desc', G.data.statuses.every((s) => typeof s.desc === 'string' && s.desc.length > 0));
  T('kind 只有 buff / debuff',
    G.data.statuses.every((s) => s.kind === 'buff' || s.kind === 'debuff'));
  T('状态都有计时方式',
    G.data.statuses.every((s) => ['step', 'time', 'manual', 'threshold'].indexOf(s.unit) >= 0));
  T('tick 只允许改 hp / ess',
    G.data.statuses.every((s) => !s.tick || s.tick.key === 'hp' || s.tick.key === 'ess'));

  /* **左栏没有「技能」块** —— 技能换了入口：主动走操作区「行动 → 释放法术」，
     主动 + 被动总览走「其他 → 技艺」（下面接着验这两条）。
     这里是**反向断言**：防止哪天又被加回来。 */
  T('左栏没有「技能」块（连壳都没有）', !$('skills') && !$('skill-panel'));

  /* 操作区里**没有**「技能」组（已废弃）。
     原来那组按"拥有几个主动技能"现生成按钮，技能一多就把操作区撑长。
     现在改成「行动」组里一个固定的「释放法术」按钮，点开弹列表 ——
     见 docs/设定/06-物品与技能.md 的「怎么释放」。 */
  const castBtn = () => document.querySelector('#actions button[data-cmd="cast"]');
  T('操作区有一个「释放法术」按钮', !!castBtn() && castBtn().textContent === '释放法术');
  T('它**不带参数**（点它是开列表，不是放某一个）',
    !!castBtn() && castBtn().getAttribute('data-arg') === null);
  T('操作区里没有「技能」这一组', $('actions').textContent.indexOf('技能') < 0);
  T('操作区里有「技艺」按钮', !!document.querySelector('#actions button[data-cmd="arts"]'));

  /* 走一遍「释放法术 → 列表 → 释放」整条链，顺带把弹框本身验了 */
  T('用之前身上没状态', G.statuses.defs().length === 0);
  T('用之前智力是 5', G.rules.attr('int') === 5);
  T('弹框一开始是关着的', !G.ui.modalOpen());

  if (castBtn()) castBtn().click();
  T('点「释放法术」弹出法术列表', G.ui.modalOpen() && $('modal').hidden === false);
  T('列表里列出了主动法术', $('modal').textContent.indexOf('凝神') >= 0);
  T('列表里带了法术描述', $('modal').textContent.indexOf('屏息凝神') >= 0);
  T('列表里没有被动技能（它没有"用一下"这个动作）',
    $('modal').textContent.indexOf('铁骨') < 0);

  const releaseBtn = document.querySelector('#modal button[data-cmd="cast"]');
  T('每条法术配了一个「释放」按钮', !!releaseBtn);
  T('释放按钮带着技能 id（点了才知道放哪个）',
    !!releaseBtn && releaseBtn.getAttribute('data-arg') === 'skl_focus');

  if (releaseBtn) releaseBtn.click();
  T('点「释放」之后弹框自己关掉', !G.ui.modalOpen());
  T('法术真的放出去了（状态挂上）', G.statuses.has('st_focus'));
  T('状态挂上后智力变成 7（5 + 2）', G.rules.attr('int') === 7);
  T('面板上列出了状态名', $('buffs').textContent.indexOf('凝神') >= 0);
  T('正面状态带 good 类', !!document.querySelector('#buffs dd.good'));
  T('状态名是个按钮（点开看效果）',
    !!document.querySelector('#buffs dd.buff button[data-cmd="buff"]'));

  /* 状态按**走的步数**计时。
     下面这几处都先查一次 find() 再取值 —— 状态没挂上的时候 find 返回 null，
     直接 `.left` 会抛错把后面几十条检查一起带走（反向验证时逮住的：
     破坏「操作区只给主动技能配按钮」那条本该变红，结果只报了个抛错）。 */
  const focus0 = G.statuses.find('st_focus');
  const left0 = focus0 ? focus0.left : -1;
  T('刚挂上时剩余量等于素材里的 turns', left0 === 5);
  G.world.move(-1, 0);
  const focus1 = G.statuses.find('st_focus');
  T('走一步，剩余量减 1', !!focus1 && focus1.left === left0 - 1);

  const focus2 = G.statuses.find('st_focus');
  if (focus2) focus2.left = 1;
  G.world.move(1, 0);
  T('剩余量走完，状态自动消失', !G.statuses.has('st_focus'));
  T('状态消失后智力回到 5', G.rules.attr('int') === 5);
  T('状态没了，面板回到空闲提示', $('buffs').textContent.indexOf('没什么特别') >= 0);

  /* 中毒：每走一步掉生命（tick）—— 状态是唯一能自动改生命 / 灵性的东西 */
  G.statuses.add('st_poison');
  const hp1 = G.state.player().hp;
  G.world.move(-1, 0);
  T('中毒每走一步掉 2 点生命', G.state.player().hp === hp1 - 2);
  T('负面状态带 bad 类', !!document.querySelector('#buffs dd.bad'));
  T('掉血写进了记事', $('log').textContent.indexOf('中毒') >= 0);

  /* 生命被扣到 60% 以下时属性当场被削 —— tick 和惩罚的联动 */
  const p1 = G.state.player();
  const hpSave = p1.hp;
  p1.hp = 40;
  G.ui.refresh();
  T('中毒掉到 60% 以下，属性当场被削', G.rules.attr('str') === 5);
  p1.hp = hpSave;
  G.ui.refresh();

  /* 灵性阈值：≤20% 挂枯竭、0% 换成耗尽、回来就摘掉 */
  const p2 = G.state.player();
  p2.ess = 20;
  G.statuses.syncEssence();
  T('灵性 20% 挂上「灵性枯竭」', G.statuses.has('st_drained'));

  p2.ess = 0;
  G.statuses.syncEssence();
  T('灵性 0% 换成「灵性耗尽」',
    G.statuses.has('st_exhausted') && !G.statuses.has('st_drained'));

  p2.ess = 100;
  G.statuses.syncEssence();
  T('灵性回到 20% 以上，两个状态都摘掉',
    !G.statuses.has('st_drained') && !G.statuses.has('st_exhausted'));

  /* 收尾：把测试挂上的东西和挪动过的位置都还原，别影响后面的检查 */
  G.statuses.remove('st_poison');
  p2.hp = 100;
  p2.ess = 100;
  G.statuses.syncEssence();
  G.state.data.world.x = 4;
  G.state.data.world.y = 3;
  G.ui.refresh();
  T('收尾之后身上没有状态了', G.statuses.defs().length === 0);
  T('收尾之后回到出生点 (4,3)',
    G.state.data.world.x === 4 && G.state.data.world.y === 3);

  /* ---------- 技能与状态的边角 ----------

     这一节专门盯**从没被执行过的分支**。加完合成公式之后才发现：
     现有素材一个 `pct` 都没写，所以公式里那两个 `(1 + Σ百分比 ÷ 100)` 因子
     **一次都没算过** —— 写了等于没写。这几条把它们真的走一遍。

     改的都是**运行时数据**（把素材对象的 mods 临时换掉），验完立刻还原，
     不动 `data/` 下的文件。 */

  out.push('技能与状态的边角');

  /* (1) 被动技能那一段的百分比因子：(5 + 1) × (1 + 50/100) = 9 */
  const ironbone = G.data.skill('skl_ironbone');
  const ironboneMods = ironbone.mods;
  ironbone.mods = [{ attr: 'str', add: 1 }, { attr: 'str', pct: 50 }];
  T('被动技能的百分比修正真的参与计算（(5+1) × 1.5 = 9）', G.rules.attr('str') === 9);
  ironbone.mods = ironboneMods;
  T('还原之后力量回到 6（5 + 铁骨的 1）', G.rules.attr('str') === 6);

  /* (2) 状态那一段的百分比因子，顺带验"多个百分比**先相加**再乘"：
      幸运基础 5、没有被动加成。
        相加：(5 × 1 + 0) × (1 + (50 + 50)/100) = 10
        逐个相乘：5 × 1.5 × 1.5 = 11.25 → 11       两者分得开 */
  G.statuses.add('st_bless');
  const bless = G.data.status('st_bless');
  const blessMods = bless.mods;
  bless.mods = [{ attr: 'luk', pct: 50 }, { attr: 'luk', pct: 50 }];
  T('状态上的百分比修正真的参与计算', G.rules.attr('luk') === 10);
  T('同一属性的多个百分比是**相加**（10），不是逐个相乘（11）',
    G.rules.attr('luk') !== 11);

  /* (3) 加值和百分比落在同一个属性上：**先加值、再乘百分比**。
      (5 + 5) × 2 = 20；反过来先乘后加是 5 × 2 + 5 = 15，两者分得开。 */
  bless.mods = [{ attr: 'luk', add: 5 }, { attr: 'luk', pct: 100 }];
  T('先加值再乘百分比：(5 + 5) × 2 = 20（反过来是 15）', G.rules.attr('luk') === 20);
  bless.mods = blessMods;
  G.statuses.remove('st_bless');
  T('还原之后幸运回到 5、状态也摘干净了',
    G.rules.attr('luk') === 5 && !G.statuses.has('st_bless'));

  /* (4) 同一个主动技能用第二次是**续期**，不是又叠一层。
      （`skill.refresh` 这条文案以前从没被触发过。） */
  const use1 = G.skills.use('skl_focus');
  T('用一次「凝神」成功', use1.ok === true && use1.refreshed === false);
  const focusRec = G.statuses.find('st_focus');
  focusRec.left = 2;
  const use2 = G.skills.use('skl_focus');
  T('再用一次是"续期"（refreshed = true）',
    use2.ok === true && use2.refreshed === true);
  T('续期把剩余量重新拉满，不是叠成两份',
    G.statuses.find('st_focus').left === 5 && G.statuses.defs().length === 1);
  T('续期不会把智力叠成 9（还是 +2）', G.rules.attr('int') === 7);

  /* (5) 用不了的三种情况各说各的话。**都说"没有这个技能"是错的** ——
         玩家会以为自己没学到，而不是"这个用不了"。 */
  G.main.submit('cast 不存在的技能');
  T('打一个不存在的技能：说"没有这个指令"',
    $('log').textContent.indexOf('没有这个指令') >= 0);

  G.main.submit('cast 铁骨');
  T('用被动技能：说清它是被动的，不是"没有"',
    $('log').textContent.indexOf('是被动技能，不用手动用') >= 0);

  /* 素材写错（applies 指向一个不存在的状态）时的兜底文案 */
  const focus = G.data.skill('skl_focus');
  const focusApplies = focus.applies;
  focus.applies = 'st_nope';
  G.main.submit('cast 凝神');
  T('主动技能指向的状态不存在时，说"现在用不了"',
    $('log').textContent.indexOf('现在用不了') >= 0);
  focus.applies = focusApplies;
  /* 这里断言**字面量**而不是 focusApplies —— 拿变量跟自己比是恒真的，
     等于没验。写死 'st_focus' 才真的钉住"素材里 applies 指向哪个状态"。 */
  T('素材还原了（applies 指回真状态 st_focus）', focus.applies === 'st_focus');

  G.statuses.remove('st_focus');
  T('收尾：状态摘干净', G.statuses.defs().length === 0);

  /* (6) 学技能。现在还没有获取途径（掉落 / 任务 / 学习都没做），
         接口先摆着 —— 但接口本身要能用。 */
  T('学一个不存在的技能会被拒绝', G.skills.learn('skl_nope') === false);
  T('学一个已经有的技能不会重复加', G.skills.learn('skl_focus') === false);
  T('技能条数没变', G.state.player().skills.length === 2);

  /* ---------- 区域 ---------- */

  /* 区域是房间的分组（data/areas.js）。素材一个区域一个文件，
     房间必须填 area，否则 validate.mjs 直接报错。这里从运行时再兜一道。 */
  out.push('区域');
  T('区域表非空', Array.isArray(G.data.areas) && G.data.areas.length > 0);
  T('房间表里每个房间都填了 area',
    G.data.rooms.every((r) => typeof r.area === 'string' && r.area.length > 0));
  T('每个房间的 area 都能在区域表里找到',
    G.data.rooms.every((r) => !!G.data.area(r.area)));
  T('区域表里每个区域的中心房间都属于这个区域',
    G.data.areas.every((a) => {
      const c = G.data.room(a.center);
      return !!c && c.area === a.id;
    }));
  T('区域表里每个区域至少有一个房间',
    G.data.areas.every((a) => G.data.rooms.some((r) => r.area === a.id)));
  T('areaOf() 能由房间查到区域', (() => {
    const a = G.data.areaOf(G.state.room());
    return !!a && a.id === G.state.room().area;
  })());
  T('点位状态显示所属区域名', tileText.indexOf('区域') >= 0 && tileText.indexOf('大厅区域') >= 0);

  /* ---------- NPC ---------- */

  /* NPC 素材在 data/npcs.js（类型表 / 态度阶段表 / NPC 本体三块）。
     玩家出生在 (4,3)：神秘人在正上方 (4,2)，商人在 (2,4)，
     而且商人还出现在杂物间 (2,3) —— 同一个人出现在两个房间。 */
  out.push('NPC');

  T('NPC 表非空', Array.isArray(G.data.npcs) && G.data.npcs.length > 0);
  T('NPC 类型表非空', Array.isArray(G.data.npcTypes) && G.data.npcTypes.length > 0);
  T('态度阶段表非空', Array.isArray(G.data.attitudeStages) && G.data.attitudeStages.length > 0);

  const mystery = G.data.npc('npc_mystery');
  const merchant = G.data.npc('npc_merchant');
  T('能按 id 查到神秘人', !!mystery && mystery.name === '神秘人');
  T('能按 id 查到商人', !!merchant && merchant.name === '商人');
  T('图标字跟名字是分开定义的（名字两个格子放不下）',
    !!mystery && mystery.glyph === '秘' && mystery.glyph !== mystery.name);
  T('每个 NPC 的类型都能在类型表里查到',
    G.data.npcs.every((n) => !!G.data.npcType(n.type)));
  T('每个 NPC 都至少有一个出现位置',
    G.data.npcs.every((n) => Array.isArray(n.at) && n.at.length > 0));
  T('每个 NPC 的每个位置都指得回一个真实房间',
    G.data.npcs.every((n) => n.at.every((p) => !!G.data.room(p.room))));
  T('一个人可以出现在多个房间（商人有两个位置）',
    !!merchant && merchant.at.length === 2);

  /* 普通对话：每个 NPC 一组自己的台词。
     任务对话不在这里 —— 那是任务自己的 offer / turnin。 */
  T('每个 NPC 都带一组普通对话台词',
    G.data.npcs.every((n) => Array.isArray(n.talk) && n.talk.length > 0));
  T('台词都是非空字符串',
    G.data.npcs.every((n) => n.talk.every((s) => typeof s === 'string' && s.length > 0)));
  T('NPC 身上不再挂任务字段（改成任务自己声明 giver）',
    G.data.npcs.every((n) => n.quest == null));

  /* 地图上那一格：画的是 glyph，不是 name */
  const npcCell = document.querySelectorAll('#map .row')[2].children[4];
  T('地图上 NPC 那一格画的是图标字，不是名字',
    npcCell.textContent === '秘' && npcCell.textContent !== '神秘人');
  T('NPC 格带 npc 类（跟墙 / 门 / 空地分开）', npcCell.classList.contains('npc'));
  T('第二个人也画出来了（商人在 (2,4)）',
    document.querySelectorAll('#map .row')[4].children[2].textContent === '商');

  const mysteryType = G.data.npcType(mystery.type);
  T('NPC 的颜色来自类型表，写成了格子上的 --npc-color',
    npcCell.style.getPropertyValue('--npc-color').trim() === mysteryType.color);
  T('这个颜色真的用上了（地图上那个字就是紫色的）',
    getComputedStyle(npcCell).color === 'rgb(195, 155, 255)');

  /* 边框：跟玩家格一个做法，用 inset 阴影画，不占布局 */
  const npcCs = getComputedStyle(npcCell);
  T('NPC 格有一圈边框', !!npcCs.boxShadow && npcCs.boxShadow.indexOf('inset') >= 0);
  T('边框用的是这个 NPC 的类型色', npcCs.boxShadow.indexOf('195, 155, 255') >= 0);
  T('NPC 的框跟玩家的绿框不是一个颜色，分得开',
    npcCs.boxShadow !== getComputedStyle(document.querySelectorAll('#map .row')[3].children[4]).boxShadow);

  /* 角标：身上有"现在就能做的动作"（可接 / 可交）才亮 */
  T('神秘人现在有可接的任务，所以亮着角标', npcCell.classList.contains('has-quest'));
  const badge = getComputedStyle(npcCell, '::after');
  T('角标是真的画出来了（有 content 有宽高，不是只挂了个空类名）',
    badge.content !== 'none' && parseFloat(badge.width) > 0 && parseFloat(badge.height) > 0);

  /* NPC 挡路 */
  T('NPC 参与可走判定：它站的那一格走不上去',
    G.data.walkable(G.state.room(), 4, 2) === false);
  T('商人那一格也走不上去', G.data.walkable(G.state.room(), 2, 4) === false);
  T('没站人的空地照样能走', G.data.walkable(G.state.room(), 3, 3) === true);
  T('npcsAt() 能按坐标查到站在这里的人',
    G.data.npcsAt(G.state.room(), 4, 2) === mystery);
  T('玩家脚下那一格（出生点）没有人', G.data.npcsAt(G.state.room(), 4, 3) === null);

  /* 相邻的人：NPC 挡路之后，能对话的只可能是四邻 */
  const near = G.data.npcsNear(G.state.room(), 4, 3);
  T('npcsNear() 报出四邻站着的人', near.length === 1 && near[0].id === 'npc_mystery');
  T('不相邻的人不在这个列表里', G.data.npcsNear(G.state.room(), 1, 1).length === 0);
  T('npcsIn() 报出这一屋有谁（同一个人出现多处只算一次）',
    G.data.npcsIn(G.state.room()).length === 2);
  T('进房间时会提一句屋里有人',
    $('log').textContent.indexOf('这里有人：神秘人、商人') >= 0);

  /* 态度 0–100 按门槛切阶段，映射函数在 js/rules.js */
  const stages = G.data.attitudeStages;
  T('态度 0 落在第一档', G.rules.attitudeStage(0).name === stages[0].name);
  T('态度 39 还在「冷淡」（门槛 40 是含下界的）',
    G.rules.attitudeStage(39).name === '冷淡');
  T('态度 40 进「中立」', G.rules.attitudeStage(40).name === '中立');
  T('态度 100 落在最后一档',
    G.rules.attitudeStage(100).name === stages[stages.length - 1].name);
  T('超出 0–100 的分数会被夹住，不会返回空阶段',
    G.rules.attitudeStage(-5).name === stages[0].name &&
    G.rules.attitudeStage(999).name === stages[stages.length - 1].name);
  T('每个 NPC 的态度都能映射到一个阶段（没有兜底空值）',
    G.data.npcs.every((n) => !!G.rules.attitudeStage(n.attitude).name));

  T('顶栏右侧显示存档绑定状态', $('topbar-save').textContent.indexOf('未绑定') >= 0);

  const actionText = $('actions').textContent;
  T('操作区有分组标题', actionText.indexOf('移动') >= 0 && actionText.indexOf('存档') >= 0);

  /* 按钮数直接跟指令表对账，比写死一个数字靠谱。
     **操作区的内容现在跟角色完全无关** —— 技能那组已废弃（见 GROUPS 上面那段），
     所以这里是严格相等，不用再单独加"主动技能数"。 */
  const btnCmds = G.main.cmds.filter((c) => c.btn);
  T('操作区按钮数 = 指令表里带 btn 的条数',
    document.querySelectorAll('#actions button[data-cmd]').length === btnCmds.length);
  T('操作区按钮不少于 11 个', btnCmds.length >= 11);
  T('重开不出现在操作区里（防手滑）', btnCmds.every((c) => c.name !== 'reset'));
  T('进入不出现在操作区里（它绑在门上）', btnCmds.every((c) => c.name !== 'enter'));
  T('对话也不出现在操作区里（它绑在人身上）', btnCmds.every((c) => c.name !== 'talk'));
  T('看状态详情也不出现在操作区里（它绑在状态上）', btnCmds.every((c) => c.name !== 'buff'));
  T('操作区里没有任何带技能 id 的按钮（技能组不会再长回来）',
    !document.querySelector('#actions button[data-arg^="skl_"]'));

  /* ---------- 布局 ---------- */

  /* 布局错了逻辑照样全绿，所以这里量的是真实外框，不是"元素存不存在"。
     第一版骨架就因为状态面板被裁而全程绿灯，截图才发现。 */
  out.push('布局');

  const rect = (id) => $(id).getBoundingClientRect();
  const appRect = rect('app');
  T('主界面占满整个窗口宽度（去掉宽度上限）',
    Math.abs(appRect.width - document.documentElement.clientWidth) < 1);
  T('没有横向滚动条', document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

  T('左栏 / 中栏 / 右栏都在', !!$('rail-left') && !!$('center') && !!$('rail-right'));
  T('左栏分三块：玩家状态 / 状态 / 玩家背包',
    !!$('status-panel') && !!$('buff-panel') && !!$('bag-panel'));
  T('右栏分二级操作与操作区两块', !!$('secondary-panel') && !!$('action-panel'));
  T('中栏有地图、点位状态、记事、输入行',
    !!$('map-panel') && !!$('tile-panel') && !!$('log-panel') && !!$('input-bar'));

  const rl = rect('rail-left'), ct = rect('center'), rr = rect('rail-right');
  T('三栏从左到右依次排开，互不重叠',
    rl.right <= ct.left + 0.5 && ct.right <= rr.left + 0.5);
  T('中栏是三者里最宽的', ct.width > rl.width && ct.width > rr.width);
  T('三栏等高、底部对齐',
    Math.abs(rl.bottom - ct.bottom) < 1 && Math.abs(ct.bottom - rr.bottom) < 1);

  const mapR = rect('map-panel'), tileR = rect('tile-panel'), logR = rect('log-panel');
  T('地图与点位状态并排，地图在左', Math.abs(mapR.top - tileR.top) < 1 && mapR.right <= tileR.left + 0.5);
  T('记事横跨地图与点位状态两块',
    Math.abs(logR.width - (mapR.width + tileR.width + 8)) < 1);
  T('记事在地图下方', logR.top >= mapR.bottom - 0.5);

  const inputR = rect('input-bar');
  T('输入行在记事下方', inputR.top >= logR.bottom - 0.5);
  T('输入行只在中栏里，不占满全宽', inputR.right <= tileR.right + 1 && inputR.width < appRect.width);

  const topbarR = rect('topbar');
  T('顶栏占满全宽', Math.abs(topbarR.width - appRect.width + 16) < 1);
  T('顶栏在三栏上方', topbarR.bottom <= rl.top + 0.5);

  const leftStatus = rect('status-panel'), leftBuff = rect('buff-panel'), leftBag = rect('bag-panel');
  T('左栏从上到下：玩家状态 / 状态 / 背包',
    leftBuff.top >= leftStatus.bottom - 0.5 && leftBag.top >= leftBuff.bottom - 0.5);

  /* 左栏三块的高度关系：**状态按内容高度、背包吃剩余空间**。
     静态量一次不够 —— 得**真的把状态挂多几个**看两块怎么变，
     否则窗口一高这条断言就恒真了（跟"选项滚到底"那条一个道理：
     前提要显式摆出来，别假设它成立）。

     状态表里一共 5 个，全挂上，量完立刻还原（不动 data/）。 */
  const pBuf = G.state.player();
  const stSaved = JSON.parse(JSON.stringify(pBuf.statuses || []));
  const buffH0 = leftBuff.height, bagH0 = leftBag.height;

  G.data.statuses.forEach((s) => G.statuses.add(s.id));
  G.ui.refresh();
  const buffH1 = rect('buff-panel').height, bagH1 = rect('bag-panel').height;

  T('状态挂多了，状态块跟着长高（说明它是按内容高度）', buffH1 > buffH0 + 1);
  T('状态挂多了，背包块变矮（说明余量真的给了背包）', bagH1 < bagH0 - 1);
  T('左栏总高没变，三块没把左栏顶出去', Math.abs(rect('rail-left').height - rl.height) < 1);
  T('状态挂多了也不出横向滚动条',
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

  /* 光看"挂多了会变高"还不够 —— `minmax(0, auto)` 的行在 grid 里
     默认也会被 `align-content: stretch` 拉开，所以"背包块变矮"这条
     区分不了 `1fr` 和 `auto`（反向验证时逮住的：把背包改成 auto 它照样绿）。
     真正的判据是**状态面板里一点多余空白都没有**：面板高度 = 内容高度。
     量的是"内容底边"跟"面板内边距以内的底边"差多少，所以 CSS 里
     padding / border 改数值也不会让这条失效。 */
  const bpCS = getComputedStyle($('buff-panel'));
  const innerBottom = rect('buff-panel').bottom -
                      parseFloat(bpCS.paddingBottom) - parseFloat(bpCS.borderBottomWidth);
  T('状态面板里没有多余空白（余量没给状态块）',
    Math.abs(rect('buffs').bottom - innerBottom) < 1.5);

  /* 状态是**并排的标签**，不是一行一个：
     至少两个状态在同一行（top 相同），而且每个标签都比容器窄、
     宽度基本等于自己那点文字。 */
  const stBtns = Array.prototype.slice.call(
    document.querySelectorAll('#buffs dd.buff button'));
  const buffsW = rect('buffs').width;
  T('状态名都画成了按钮', stBtns.length === G.data.statuses.length);
  T('两个状态排在同一行（并排，不是一行一个）',
    stBtns.length >= 2 &&
    Math.abs(stBtns[0].getBoundingClientRect().top -
             stBtns[1].getBoundingClientRect().top) < 1);
  /* 量的是**标签（dd）**不是按钮：按钮上的 `width: 100%` 在
     "宽度由内容决定的 flex item"里是空操作（反向验证时逮住的：
     加回 `width: 100%` 它照样绿），能拉满的只有 dd 那一层。 */
  T('单个状态的标签按自己文字占宽，不铺满整行',
    stBtns.length >= 2 &&
    stBtns.every((b) => {
      const tagW = b.parentNode.getBoundingClientRect().width;
      return tagW < buffsW - 1 && tagW <= textWidth(b) + 20;
    }));

  pBuf.statuses = stSaved;
  G.ui.refresh();
  T('量完还原：状态块回到原来的高度', Math.abs(rect('buff-panel').height - buffH0) < 1);
  T('量完还原：挂着的状态回到原来那几个',
    G.statuses.owned().length === stSaved.length);

  /* 右栏：上面二级操作、下面操作区。
     二级操作的内容会随情况变长（对话选项一多就长），所以是它吃剩余空间，
     操作区按内容高度。**别断言"二级操作一定比操作区高"** ——
     窄窗口下操作区那五组按钮本来就要 340px，比剩余空间还多，
     这条断言在 1100×700 下必挂（第一版就是这么写的）。
     要验的是"谁吃剩余"，所以量的是**操作区有没有被拉满**：
     它按内容高度的话，内部就不会出现滚动。 */
  const rightTop = rect('secondary-panel'), rightBot = rect('action-panel');
  T('右栏上下分块，操作区在二级操作下面', rightBot.top >= rightTop.bottom - 0.5);
  T('二级操作贴着右栏顶部', Math.abs(rightTop.top - rr.top) < 1);
  T('操作区贴着右栏底部', Math.abs(rightBot.bottom - rr.bottom) < 1);
  T('两块把右栏分完，中间只留一个间距',
    Math.abs((rightBot.top - rightTop.bottom) - 8) < 1.5);
  /* 怎么验"是二级操作吃了剩余空间"：量操作区**有没有被拉伸**。
     不能拿 scrollHeight 跟 clientHeight 比 —— scrollHeight 永远 ≥ clientHeight，
     那样写出来是条恒真的空断言（第一版就是这么写的，改坏之后照样绿）。
     要量的是**里面那几组按钮实际占多高**：按内容高度的话
     clientHeight 跟它只差不到 1px；被 1fr 拉满的话会差出三百多像素。 */
  const actsBox = $('actions');
  const actsKids = actsBox.children;
  const actsContent = actsKids.length
    ? actsKids[actsKids.length - 1].getBoundingClientRect().bottom -
      actsKids[0].getBoundingClientRect().top
    : 0;
  T('操作区按内容高度、没被拉伸（多出来的空间全归二级操作）',
    actsBox.clientHeight - actsContent < 30);
  /* 150 是个下限：1100×700 下二级操作实测 ~292px，
     而"缩成内容高度"的话只剩 ~86px（一个标题加内边距加一句提示）。 */
  T('二级操作按剩余空间撑开，不是缩成一小条', rightTop.height > 150);

  /* 左栏现在**一块虚线占位都没有了** —— 背包那一块从占位框换成了真容器
     （dl#bag，里面装可点的物品标签）。留一条反向断言盯着，别哪天又冒出个占位。 */
  T('左栏没有虚线占位了（背包是真容器，不是占位框）',
    !$('bag').classList.contains('placeholder') && $('bag').tagName === 'DL');
  T('二级操作也不是占位面板（它有自己的内容）',
    !$('secondary').classList.contains('placeholder'));

  /* ---------- 移动 ---------- */

  out.push('移动');

  /* 出生点正上方就是神秘人 —— 现在 NPC 挡路，这一步走不动。
     这是"NPC 不可通行"最直接的一条证据。 */
  G.main.submit('up');
  T('往 NPC 那一格走，走不动（NPC 是障碍物）',
    G.state.data.world.x === 4 && G.state.data.world.y === 3);
  T('撞上人时说清楚是谁挡着（不能说成"墙"）',
    $('log').textContent.indexOf('神秘人挡在前面，过不去') >= 0);

  /* 绕过去：(4,3) → 左 → 上×3 → 右 → 上，走到上面的门 (4,0) */
  G.main.submit('left');
  T('向左走一步到 (3,3)', G.state.data.world.x === 3 && G.state.data.world.y === 3);
  T('走一步后点位状态的坐标跟着变', $('tile').textContent.indexOf('(3,3)') >= 0);
  T('走开之后旁边就没人了', $('tile').textContent.indexOf('旁边的人') < 0);
  T('旁边没人时点位状态回到四行：区域 / 房间 / 坐标 / 脚下',
    $('tile').querySelectorAll('dt').length === 4);

  G.main.submit('up');
  G.main.submit('up');
  G.main.submit('up');
  T('绕过 NPC 走到 (3,1)', G.state.data.world.x === 3 && G.state.data.world.y === 1);
  G.main.submit('right');
  T('向右走到 (4,1)', G.state.data.world.x === 4 && G.state.data.world.y === 1);
  G.main.submit('up');
  T('走到上面的门 (4,0)', G.state.data.world.x === 4 && G.state.data.world.y === 0);
  T('站到门上后，点位状态说脚下是门', $('tile').textContent.indexOf('一扇门') >= 0);
  T('点位状态给出门通往哪里', $('tile').textContent.indexOf('回廊') >= 0);
  T('站在门上时是五行：区域 / 房间 / 坐标 / 脚下 / 通往',
    $('tile').querySelectorAll('dt').length === 5);
  T('站在门上时也不再出现"可走"和"本室出口"',
    $('tile').textContent.indexOf('可走') < 0 &&
    $('tile').textContent.indexOf('本室出口') < 0);

  const before = G.state.data.world.y;
  G.main.submit('up');
  T('撞墙走不动，坐标没变', G.state.data.world.y === before);

  /* 别名要在走得动的位置上测。(4,0) 左边就是墙，在那里测会误判成失败。 */
  G.main.submit('down');
  T('向下走一步回到 (4,1)', G.state.data.world.y === 1);
  G.main.submit('左');
  T('中文别名「左」也能走', G.state.data.world.x === 3);
  G.main.submit('right');
  T('right 走回 (4,1)', G.state.data.world.x === 4);
  G.main.submit('w');
  T('WASD 别名 w 也能走', G.state.data.world.y === 0);

  /* ---------- 任务 ---------- */

  /* 任务定义在 data/quests.js，进度模块是 js/quests.js。
     这一轮改成**接取制**：没接的任务不推进进度，交完才算完。

     任务表本身只做数据检查（定义、引用完整性、任务链门禁）—— 那些跟站在哪
     没关系，放这里一次说完；玩家真正看得见的那条路（说话、接、走、交）
     放在后面「对话」那一节，走一遍完整的。 */
  out.push('任务');

  const q10 = G.data.quest('q_walk10');
  const q20 = G.data.quest('q_walk20');
  const q30 = G.data.quest('q_walk30');
  const qPatrol = G.data.quest('q_patrol');

  T('任务表里能按 id 查到「走十步」',
    !!q10 && q10.goal.type === 'walk' && q10.goal.count === 10);
  T('任务自己声明发布者（giver），不写在 NPC 身上',
    !!q10 && q10.giver === 'npc_mystery');
  T('任务可以限定只在某个房间出现（room）', !!q10 && q10.room === 'room_hall');
  T('任务链靠 requires 串起来',
    !!q20 && q20.requires === 'q_walk10' && !!q30 && q30.requires === 'q_walk20');
  T('可重复任务标了 repeatable',
    !!qPatrol && qPatrol.repeatable === true && q10.repeatable !== true);

  T('每个任务的 giver 都指向真实 NPC',
    G.data.quests.every((q) => !!G.data.npc(q.giver)));
  T('每个任务的 room 都指向真实房间',
    G.data.quests.every((q) => !q.room || !!G.data.room(q.room)));
  T('每个任务的 requires 都指向真实任务',
    G.data.quests.every((q) => !q.requires || !!G.data.quest(q.requires)));
  T('发布任务的 NPC 真的会出现在那个房间（不然任务挂不出来）',
    G.data.quests.every((q) => !q.room ||
      G.data.npcsIn(G.data.room(q.room)).some((n) => n.id === q.giver)));

  /* 任务与 NPC 非绑定：挂在谁身上、在哪个房间挂出来，都由任务自己说了算。
     商人在两个房间都有位置，而「搭把手」写了 room: room_right ——
     所以他在大厅里根本不拿出这个任务。 */
  const hall = G.state.room();
  const rightRoom = G.data.room('room_right');
  const idsOf = (list) => list.map((q) => q.id);
  T('同一个 NPC 换个房间就不拿出这个任务（room 限定）',
    idsOf(G.quests.ofNpc(merchant, hall)).indexOf('q_patrol') < 0);
  T('回到那个房间，任务才挂出来',
    idsOf(G.quests.ofNpc(merchant, rightRoom)).indexOf('q_patrol') >= 0);
  T('神秘人在大厅里拿出来的只有第一个（后两个被前置挡着）',
    idsOf(G.quests.ofNpc(mystery, hall)).join(',') === 'q_walk10');

  /* 未接收不可执行 */
  T('还没接过的时候，任务状态是「可接」',
    G.quests.state('q_walk10') === G.quests.AVAILABLE);
  T('没记录过的任务进度是 0', G.quests.progress('q_walk10') === 0);
  T('没接过的任务不算完成', G.quests.isDone('q_walk10') === false);
  T('没接过的任务也不算「可以交差」', G.quests.isReady('q_walk10') === false);
  /* deliver() 返回 { ok, events } 而不是 boolean（要带奖励那一行回来），
     所以判的是 .ok —— 见 js/quests.js 的 deliver()。 */
  T('没接过的任务，交付也没得交', G.quests.deliver('q_walk10').ok === false);

  G.main.submit('down');
  T('从 (4,0) 走到 (4,1)', G.state.data.world.x === 4 && G.state.data.world.y === 1);
  T('没接的任务，走一步也不推进（未接收不可执行）', G.quests.progress('q_walk10') === 0);

  /* ---------- 对话 ---------- */

  /* 任务通过跟人说话来接。对话是一排选项：普通对话一项，**每个任务一项** ——
     同一个 NPC 身上可以同时挂着普通对话、可接的任务、能交的任务。

     **一级 / 二级两块分工**（这一轮刚改的）：
       一级区 = 中栏「地图点位状态」：旁边的人（名字 + 态度）+「跟某某说话」按钮；
       二级区 = 右栏「二级操作」：台词 + 任务进度 + 对话选项。
     所以查"有没有这个选项"要查 #secondary，查"旁边站着谁"要查 #tile。

     这一节走的是玩家真正走的那条路：点面板上的按钮，而不是直接调 G.talk。 */
  out.push('对话');

  const npcCellNow = () => document.querySelectorAll('#map .row')[2].children[4];
  const dtTexts = () => Array.prototype.map.call(
    $('tile').querySelectorAll('dt'), (d) => d.textContent);
  const secTexts = () => Array.prototype.map.call(
    $('secondary').querySelectorAll('dt'), (d) => d.textContent);
  /* 对话选项（闲聊 / 接受 / 交付 / 结束）全在二级操作里 */
  const talkArgs = () => Array.prototype.map.call(
    $('secondary').querySelectorAll('button[data-cmd="talk"]'),
    (b) => b.getAttribute('data-arg'));
  /* 一级区里的「跟某某说话」按钮，一人一个 */
  const tileTalkArgs = () => Array.prototype.map.call(
    $('tile').querySelectorAll('button[data-cmd="talk"]'),
    (b) => b.getAttribute('data-arg'));
  const logCount = (needle) => Array.prototype.filter.call(
    $('log').querySelectorAll('p'), (p) => p.textContent.indexOf(needle) >= 0).length;

  /* 还没开口：一级区列人（名字 + 态度 + 说话按钮），二级区闲着 */
  T('旁边有人时，一级区画出一个说话按钮', !!tileBtn('npc_mystery'));
  T('按钮上写着跟谁说话', (tileBtn('npc_mystery') || {}).textContent === '跟神秘人说话');
  T('旁边只有一个人时，一级区只有一个说话按钮', tileTalkArgs().length === 1);
  T('一级区里那个人带着名字', $('tile').textContent.indexOf('神秘人') >= 0);
  T('一级区里那个人带着态度', $('tile').textContent.indexOf('中立 50') >= 0);
  T('还没开口时二级区里没有对话选项', talkArgs().length === 0);
  T('还没开口时二级区是一句灰提示',
    $('secondary').textContent.indexOf('站在人旁边') >= 0);
  T('二级区闲着时带 idle 类（提示要居中）', $('secondary').classList.contains('idle'));

  T('点得到「跟神秘人说话」按钮', clickArg('npc_mystery'));
  T('点说话按钮真的开始对话了',
    !!G.talk.current() && G.talk.current().id === 'npc_mystery');
  T('他说的那句进了记事', $('log').textContent.indexOf('神秘人：「') >= 0);
  T('台词是从他自己的普通台词里挑的', mystery.talk.indexOf(G.talk.line()) >= 0);
  T('开口后一级区**仍然**列着旁边的人（不再被对话面板整块顶掉）',
    dtTexts().indexOf('旁边的人') >= 0);
  T('正在说话的那个人的按钮带高亮',
    clsOf(tileBtn('npc_mystery')).indexOf('cur') >= 0);
  T('二级区不再是空闲态', !$('secondary').classList.contains('idle'));
  T('二级区抬头写着在跟谁说话',
    secTexts().join('').indexOf('正在跟神秘人说话') >= 0);
  T('二级区里直接摆着他刚说的那一句',
    $('secondary').textContent.indexOf('「' + G.talk.line() + '」') >= 0);
  T('二级区里给了「随便聊聊」', talkArgs().indexOf('chat') >= 0);
  T('可接的任务变成一个「接受」选项', talkArgs().indexOf('accept q_walk10') >= 0);
  T('还有一项是「结束对话」', talkArgs().indexOf('bye') >= 0);
  T('还没达成的任务不出现「交付」选项',
    !talkArgs().some((a) => a.indexOf('deliver') === 0));

  /* 选项多了面板会滚动 —— 这是设计内的（#secondary 本来就 overflow-y: auto）。
     要保证的不是"永远不滚动"，而是两件事：
       1. 所有选项装在同一个容器里，滚一下能一起看到，不会散落各处；
       2. 滚到底就能完整看到最后一个选项，不会被永久裁掉。

     **第 2 条得先把"装不下"这个前提造出来。** 宽窗口下二级操作有 390px 高，
     三个选项怎么都装得下，不造前提这条断言就是恒真的，等于没验。
     所以这里临时把面板压矮（90px），量完立刻还回去 ——
     面板多高本来就是窗口给的，压矮不影响任何别的检查。

     顺带一个坑：容差必须留到 2px。scrollHeight 是**取整**的，
     内容真实高度 193.5、clientHeight 190 时 scrollTop 最多只能到 3，
     最后那 0.5px 永远滚不出来 —— 那是取整残差，不是"被裁掉"。
     差半个像素和差半个按钮是两码事，断言要盯住后者。
     （1100×700 下就因为这 0.03px 偶发假红过。） */
  T('所有选项装在同一个容器里（一个选项一个 dd 会撑爆面板）',
    (() => {
      const box = $('secondary').querySelector('dd.acts');
      return !!box && box.querySelectorAll('button').length === talkArgs().length;
    })());

  const secEl = $('secondary');
  const savedMax = secEl.style.maxHeight;
  secEl.style.maxHeight = '90px';
  T('面板装不下时真的会滚动（这条不是恒真）',
    secEl.scrollHeight > secEl.clientHeight);
  secEl.scrollTop = secEl.scrollHeight;

  /* 量的是"最后一个选项露出来多少"，不是"它的底边跟容器底边差几个像素" ——
     后者会被上面说的取整残差坑到。 */
  const secBox = secEl.getBoundingClientRect();
  const byeEl = secBtn('bye');
  const byeBox = byeEl ? byeEl.getBoundingClientRect() : null;
  const shown = byeBox
    ? Math.min(secBox.bottom, byeBox.bottom) - Math.max(secBox.top, byeBox.top)
    : -1;
  T('滚到底就能完整看到最后一个选项（不会被永久裁掉）',
    !!byeBox && shown >= byeBox.height - 2);
  T('滚到底时最后一个选项也没跑到面板顶上头去',
    !!byeBox && byeBox.top >= secBox.top - 2);

  secEl.style.maxHeight = savedMax;
  T('面板高度还回去了（没把后面的检查带偏）', secEl.style.maxHeight === savedMax);

  const chatBefore = logCount('神秘人：「');
  T('点得到「随便聊聊」', clickSec('chat'));
  T('「随便聊聊」又说了一句', logCount('神秘人：「') === chatBefore + 1);
  T('换台词不会把人换掉（还在跟同一个人说话）',
    !!G.talk.current() && G.talk.current().id === 'npc_mystery');
  T('换来的还是他自己的台词', mystery.talk.indexOf(G.talk.line()) >= 0);

  /* 走开就自动结束，不用等玩家按「结束对话」 */
  G.main.submit('left');
  T('走到 (3,1)', G.state.data.world.x === 3 && G.state.data.world.y === 1);
  T('人走开了，对话自动结束（不用按结束对话）', G.talk.current() === null);
  T('走开后二级区收起来了', secTexts().indexOf('正在跟神秘人说话') < 0);
  T('走开后二级区回到空闲提示',
    $('secondary').classList.contains('idle') && talkArgs().length === 0);
  T('走开后旁边没人，一级区的说话按钮也不见了', tileTalkArgs().length === 0);
  T('这一趟没接任务，所以还是没推进', G.quests.progress('q_walk10') === 0);
  G.main.submit('right');
  T('走回 (4,1)', G.state.data.world.x === 4 && G.state.data.world.y === 1);

  /* 接受：点面板上的按钮，走真实路径 */
  clickArg('npc_mystery');   /* 重新开口 */
  T('重新开口', !!G.talk.current());
  T('点得到「接受：走十步」', clickSec('accept q_walk10'));
  T('点「接受」真的把任务接下了', G.quests.state('q_walk10') === G.quests.ACTIVE);
  T('接的时候进度从 0 开始', G.quests.progress('q_walk10') === 0);
  T('记事里说了接下任务', $('log').textContent.indexOf('接下任务：走十步') >= 0);
  T('说话的人改口说任务自己的 offer', G.talk.line() === q10.offer);
  T('接完以后二级区报出任务进度', $('secondary').textContent.indexOf('走十步 0 / 10') >= 0);
  T('一级区里不再重复报任务进度（进度只在二级区看）',
    $('tile').textContent.indexOf('走十步') < 0);
  T('接完以后不再给「接受」选项', talkArgs().indexOf('accept q_walk10') < 0);
  T('还没达成，所以也不给「交付」选项',
    !talkArgs().some((a) => a.indexOf('deliver') === 0));

  /* 接了才推进 */
  G.main.submit('left');
  T('接了之后走一步就推进了', G.quests.progress('q_walk10') === 1);
  G.main.submit('right');
  T('再走一步继续推进', G.quests.progress('q_walk10') === 2);

  /* 摆到"还差一步"，再用真走路跨过去 ——
     顺手把"达成时当场报一声"那条路也验了（直接调 add 是不会打日志的）。 */
  G.quests.ensure('q_walk10').progress = 9;
  T('摆好场景：还差一步时不算达成', G.quests.isReady('q_walk10') === false);
  G.main.submit('left');
  T('最后一步走完，目标达成', G.quests.isReady('q_walk10') === true);
  T('进度停在目标值上，不会出现 11 / 10', G.quests.progress('q_walk10') === 10);
  T('达成不等于完成，还得去交差', G.quests.isDone('q_walk10') === false);
  T('达成时当场在记事里说了一声',
    $('log').textContent.indexOf('任务目标达成：走十步') >= 0);
  T('达成后角标还亮着（有东西可以交）', npcCellNow().classList.contains('has-quest'));
  G.main.submit('right');
  T('达成之后再走也不重复报', logCount('任务目标达成：走十步') === 1);

  /* 交付 + 任务链门禁 */
  clickArg('npc_mystery');
  T('达成之后二级区里写着可以交差了',
    $('secondary').textContent.indexOf('走十步 可以交差了') >= 0);
  T('选项里冒出「交付：走十步」', talkArgs().indexOf('deliver q_walk10') >= 0);
  T('前置还没交，下一个任务根本不在选项里（任务链）',
    talkArgs().indexOf('accept q_walk20') < 0);
  T('点得到「交付：走十步」', clickSec('deliver q_walk10'));
  T('点交付真的交了', G.quests.isDone('q_walk10') === true);
  T('记下了交付次数', G.quests.times('q_walk10') === 1);
  T('记事里说了交付任务', $('log').textContent.indexOf('交付任务：走十步') >= 0);
  T('交完以后二级区里写着已完成', $('secondary').textContent.indexOf('走十步 已完成') >= 0);
  T('交完第一个，第二个才冒出来（任务链）',
    talkArgs().indexOf('accept q_walk20') >= 0);
  T('第二个冒出来了，第三个还没有（隔着一层）',
    talkArgs().indexOf('accept q_walk30') < 0);

  /* 角标的语义是"这人现在有活给你"。神秘人交完第一个还有第二个可接，所以还亮着；
     把**他身上的任务全都**摆成已交付，才是真的没活了。

     注意要连 q_spring / q_drink 一起摆 —— 它们接在 q_walk30 后面，
     只把前三个设成 done 的话，那两个会解锁变成"可接"，角标照样亮着。 */
  const questsBackup = JSON.parse(JSON.stringify(G.state.data.quests));
  ['q_walk10', 'q_walk20', 'q_walk30', 'q_spring', 'q_drink'].forEach((id) => {
    G.state.data.quests[id] = { state: 'done', progress: 1, times: 1 };
  });
  G.ui.refresh();
  T('身上的活都干完了，角标就收起来了', !npcCellNow().classList.contains('has-quest'));
  T('角标消失是真的消失（::after 不再画东西）',
    getComputedStyle(npcCellNow(), '::after').content === 'none');
  G.state.data.quests = questsBackup;
  G.ui.refresh();
  T('还原之后角标又亮了（第二个任务还等着接）',
    npcCellNow().classList.contains('has-quest'));
  T('NPC 的字一直没变，变的只是角标',
    npcCellNow().textContent === '秘' && npcCellNow().classList.contains('npc'));

  /* ---------- 一个位置旁边站着两个人 ----------

     这是"一级区只列人、二级区放选项"这个设计真正要解决的场景：
     旁边有两个人时，一级区并列两个「说话」按钮，点另一个就直接切过去，
     不用先按「结束对话」。

     素材里现在没有隔一格对望、能让玩家同时站在两人旁边的 NPC
     （神秘人在 (4,2)、商人在 (2,4)，隔了四格），所以这里临时给商人
     加一个位置把场景造出来，验完立刻撤掉 —— 不动素材本身。 */
  out.push('旁边两个人');

  const merchantAt = G.data.npc('npc_merchant').at;
  merchantAt.push({ room: 'room_hall', x: 5, y: 1 });
  G.ui.refresh();
  T('旁边站着两个人时，一级区并列两个说话按钮',
    !!tileBtn('npc_mystery') && !!tileBtn('npc_merchant'));
  T('两个按钮各说各的人名',
    (tileBtn('npc_mystery') || {}).textContent === '跟神秘人说话' &&
    (tileBtn('npc_merchant') || {}).textContent === '跟商人说话');

  clickArg('npc_mystery');
  T('先跟神秘人说话', (G.talk.current() || {}).id === 'npc_mystery');
  T('说话时一级区**仍然**列着两个人（不再被对话面板整块顶掉）',
    !!tileBtn('npc_mystery') && !!tileBtn('npc_merchant'));
  T('正在说话的那个按钮带高亮',
    clsOf(tileBtn('npc_mystery')).indexOf('cur') >= 0);
  T('没在说话的那个不亮',
    clsOf(tileBtn('npc_merchant')).indexOf('cur') < 0);
  T('二级区在跟神秘人说话',
    $('secondary').textContent.indexOf('正在跟神秘人说话') >= 0);

  T('点另一个人的按钮就直接切过去（不用先结束对话）', clickArg('npc_merchant'));
  T('真的换成商人了', (G.talk.current() || {}).id === 'npc_merchant');
  T('高亮跟着挪到商人身上',
    clsOf(tileBtn('npc_merchant')).indexOf('cur') >= 0 &&
    clsOf(tileBtn('npc_mystery')).indexOf('cur') < 0);
  T('商人的台词来自他自己那一组', merchant.talk.indexOf(G.talk.line()) >= 0);
  T('二级区的抬头也跟着换了',
    $('secondary').textContent.indexOf('正在跟商人说话') >= 0);

  /* 撤掉临时位置，别影响后面几节 */
  merchantAt.pop();
  G.ui.refresh();
  T('撤掉之后旁边只剩神秘人', !!tileBtn('npc_mystery') && !tileBtn('npc_merchant'));
  T('人不在了，对话也跟着断', G.talk.current() === null);

  /* 可重复任务 + 同一个 NPC 换个房间。
     从 (4,1) 走到右边的木门 (8,3)，进杂物间找商人。 */
  G.main.submit('right');
  G.main.submit('right');
  G.main.submit('right');
  T('走到 (7,1)', G.state.data.world.x === 7 && G.state.data.world.y === 1);
  G.main.submit('down');
  G.main.submit('down');
  T('走到 (7,3)', G.state.data.world.x === 7 && G.state.data.world.y === 3);
  G.main.submit('right');
  T('走到右边的木门 (8,3)', G.state.data.world.x === 8 && G.state.data.world.y === 3);
  T('点得到「进入这扇门」', clickCmd('enter'));
  T('进了杂物间', G.state.data.world.roomId === 'room_right');
  T('落点是 (1,3)', G.state.data.world.x === 1 && G.state.data.world.y === 3);
  T('旁边站着商人（同一个人，换了个房间）', !!tileBtn('npc_merchant'));

  clickArg('npc_merchant');
  T('商人说的话来自他自己的台词表（每个 NPC 有各自的普通对话）',
    merchant.talk.indexOf(G.talk.line()) >= 0 && mystery.talk.indexOf(G.talk.line()) < 0);
  T('换了这个房间他才拿出「搭把手」', talkArgs().indexOf('accept q_patrol') >= 0);
  T('点得到「接受：搭把手」', clickSec('accept q_patrol'));
  T('接下了可重复任务', G.quests.state('q_patrol') === G.quests.ACTIVE);

  G.quests.ensure('q_patrol').progress = 4;
  G.main.submit('up');
  T('在杂物间里走一步也算数', G.quests.isReady('q_patrol') === true);
  G.main.submit('down');
  T('回到商人旁边 (1,3)', G.state.data.world.x === 1 && G.state.data.world.y === 3);

  clickArg('npc_merchant');
  T('可重复任务达成后同样出现「交付」',
    talkArgs().indexOf('deliver q_patrol') >= 0);
  T('点得到「交付：搭把手」', clickSec('deliver q_patrol'));
  T('交完之后立刻回到「可接」（可重复）',
    G.quests.state('q_patrol') === G.quests.AVAILABLE);
  T('进度清零，下一次从零开始', G.quests.progress('q_patrol') === 0);
  T('完成次数记在存档里', G.quests.times('q_patrol') === 1);
  T('记事里说明了还能再接一次', $('log').textContent.indexOf('还能再接一次') >= 0);
  T('选项里马上又出现「接受：搭把手」', talkArgs().indexOf('accept q_patrol') >= 0);
  clickSec('accept q_patrol');
  T('第二次也接得上', G.quests.state('q_patrol') === G.quests.ACTIVE);
  T('第二次接还是从 0 开始', G.quests.progress('q_patrol') === 0);
  T('次数不会被接取重置', G.quests.times('q_patrol') === 1);
  T('点得到「结束对话」', clickSec('bye'));
  T('点「结束对话」结束对话', G.talk.current() === null);
  T('结束后二级区回到空闲提示', $('secondary').classList.contains('idle'));
  T('结束后一级区照样列着旁边的人', dtTexts().indexOf('旁边的人') >= 0);

  /* 走回大厅，交还给后面几节：门那一节从 (4,0) 起步。 */
  G.main.submit('left');
  T('站在杂物间的门上 (0,3)', G.state.data.world.x === 0 && G.state.data.world.y === 3);
  clickCmd('enter');
  T('回到大厅 (7,3)', G.state.data.world.roomId === 'room_hall' &&
    G.state.data.world.x === 7 && G.state.data.world.y === 3);
  G.main.submit('up');
  G.main.submit('up');
  G.main.submit('left');
  G.main.submit('left');
  G.main.submit('left');
  G.main.submit('up');
  T('回到 (4,0)', G.state.data.world.x === 4 && G.state.data.world.y === 0);

  /* ---------- 键盘与模式 ---------- */

  /* 直接往 document 上派发真的 KeyboardEvent，走的就是玩家按键那条路。
     code 是物理键位，key 是字符 —— 处理函数两个都用，所以两个都要给。 */
  const key = (code, keyName, opts) => document.dispatchEvent(new KeyboardEvent('keydown',
    Object.assign({ code: code, key: keyName || code, bubbles: true, cancelable: true }, opts || {})));
  const echoCount = (cmd) => Array.prototype.filter.call(
    $('log').querySelectorAll('p'), (p) => p.textContent === '> ' + cmd).length;

  out.push('键盘与模式');

  T('开局不是命令模式', G.main.inCommand() === false);
  T('输入栏带 walk 标记（键盘归游戏）', $('input-bar').classList.contains('walk'));

  key('ArrowDown');
  T('方向键 ↓ 直接走一格，不用回车', G.state.data.world.y === 1);
  key('ArrowUp');
  T('方向键 ↑ 走回来', G.state.data.world.y === 0);

  key('KeyS');
  T('WASD 的 S 也能走', G.state.data.world.y === 1);
  key('KeyW');
  T('WASD 的 W 也能走', G.state.data.world.y === 0);

  key('Numpad2');
  T('小键盘 2 也能走', G.state.data.world.y === 1);
  key('Numpad8');
  T('小键盘 8 也能走', G.state.data.world.y === 0);

  key('ArrowUp');
  T('键盘撞墙也走不动', G.state.data.world.y === 0);

  /* 键盘走路不该在日志里刷 "> down" */
  const echoBefore = echoCount('down');
  key('ArrowDown');
  T('键盘移动不回显指令（日志不被刷屏）', echoCount('down') === echoBefore);
  key('ArrowUp');

  /* 按住不放会连发 keydown，不能一步一格地刷屏。
     先按一次正常的（一定会走，并给节流打点），紧接着两条 repeat 应该被吃掉。 */
  G.main.leaveCommand();
  const ry0 = G.state.data.world.y;
  key('ArrowDown');
  const ry1 = G.state.data.world.y;
  key('ArrowDown', 'ArrowDown', { repeat: true });
  key('ArrowDown', 'ArrowDown', { repeat: true });
  T('按住不放时的连发被节流（不会刷屏）', ry1 === ry0 + 1 && G.state.data.world.y === ry1);
  key('ArrowUp');

  key('Slash', '/');
  T('按 / 进入命令模式', G.main.inCommand() === true);
  T('命令模式下输入栏去掉 walk 标记', $('input-bar').classList.contains('walk') === false);

  const held = G.state.data.world.y;
  key('ArrowDown');
  T('命令模式下方向键不走路（键盘归输入框）', G.state.data.world.y === held);

  /* 这条是分模式的全部理由：s 既是"向下走"又是 save 的第一个字母 */
  $('cmd').value = 'save';
  T('命令模式下能正常打出 s 开头的指令', $('cmd').value === 'save');

  key('Escape', 'Escape');
  T('Esc 退出命令模式', G.main.inCommand() === false);
  T('Esc 之后输入框被清空', $('cmd').value === '');

  key('Enter', 'Enter');
  T('回车进入命令模式', G.main.inCommand() === true);
  G.main.submit('look');
  T('执行完指令自动回走路模式', G.main.inCommand() === false);
  T('回走路模式后 walk 标记也回来了', $('input-bar').classList.contains('walk'));

  G.main.enterCommand();
  G.main.submit('这个指令不存在');
  T('指令打错时留在命令模式（好接着改）', G.main.inCommand() === true);
  G.main.leaveCommand();
  T('leaveCommand 之后回到走路模式', G.main.inCommand() === false);

  /* 点输入栏 = 我要打字。这里测的是真实路径：
     inCommand() 看的是 document.activeElement，不依赖焦点事件 ——
     无头浏览器里文档没有焦点，Chrome 会把 focus / blur 事件推迟派发。 */
  const bar = $('input-bar');
  bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  T('点输入栏会切到命令模式', G.main.inCommand() === true);
  T('切到命令模式后输入栏去掉 walk 标记', bar.classList.contains('walk') === false);

  G.main.leaveCommand();
  T('退出后输入框不再持有焦点', G.main.inCommand() === false);
  T('退出后输入栏回到 walk 标记', bar.classList.contains('walk') === true);

  /* 回车不该被按钮吃掉 */
  T('焦点不在输入框时输入框是空的', $('cmd').value === '');

  /* ---------- 弹框（释放法术 / 技艺 / 状态详情） ----------

     项目里第一次出现浮层。三处共用一套壳：内容不同，开 / 关的规矩一样。
     三种关法各验一条 —— 只验一种的话，另外两条写坏了看不出来。
     这一节**不动坐标**（后面的「门」那一节要用 (4,0)），只碰状态。 */

  out.push('弹框');

  /* 记下现在站哪儿 —— 这一节**不该动坐标**，但"弹框开着时键盘不给游戏用"
     那条要是坏了，下面几次按键就会把角色走出去，后面「门」那一节
     从 (4,0) 起步，会连带全挂、看不出真正的原因。所以收尾一律摆回去。 */
  const backX = G.state.data.world.x;
  const backY = G.state.data.world.y;

  const modalText = () => $('modal').textContent;
  /* 笔记本是书签切栏：点哪根看哪栏。测试要切到「已完成」再断言那栏的内容。 */
  const noteSwitch = (sec) => {
    const tab = $('modal-body').querySelector('.book-tab[data-arg="' + sec + '"]');
    if (tab) tab.click();
  };
  T('弹框默认是关着的', !G.ui.modalOpen() && $('modal').hidden === true);
  T('弹框右上角有关闭按钮，文案来自 strings',
    !!$('modal-close') && $('modal-close').textContent === '关闭');

  /* (1) 技艺总览：主动 + 被动都在，带描述，纯看不能放 */
  G.main.submit('arts');
  T('arts 打开技艺总览', G.ui.modalOpen() && $('modal').hidden === false);
  T('技艺里有主动法术', modalText().indexOf('凝神') >= 0);
  T('技艺里有被动技能', modalText().indexOf('铁骨') >= 0);
  T('技艺里带了技能描述', modalText().indexOf('筋骨结实') >= 0);
  T('技艺里标出了主动 / 被动',
    modalText().indexOf('主动') >= 0 && modalText().indexOf('被动') >= 0);
  T('技艺是纯总览，不给释放按钮', !document.querySelector('#modal button[data-cmd="cast"]'));

  $('modal-close').click();
  T('点「关闭」能关掉弹框', !G.ui.modalOpen() && $('modal').hidden === true);

  /* (2) 状态详情：描述 / 剩余量 / 影响 / 计时 四块 */
  G.statuses.add('st_focus');
  G.ui.refresh();
  const buffBtn = document.querySelector('#buffs dd.buff button[data-cmd="buff"]');
  if (buffBtn) buffBtn.click();
  T('点状态名打开状态详情', G.ui.modalOpen());
  T('详情里有描述', modalText().indexOf('心神专注') >= 0);
  T('详情里有剩余量',
    modalText().indexOf('剩余量') >= 0 && modalText().indexOf('还能走 5 格') >= 0);
  T('详情里有影响', modalText().indexOf('影响') >= 0 && modalText().indexOf('智力 +2') >= 0);
  T('详情里有计时方式',
    modalText().indexOf('计时') >= 0 && modalText().indexOf('每走一格减 1') >= 0);
  T('标题是状态自己的名字（不是干巴巴的"状态详情"）',
    $('modal-title').textContent.indexOf('凝神') >= 0);
  T('标题上标了正负面', $('modal-title').textContent.indexOf('正面') >= 0);

  /* 剩余量是**活的** —— 以前面板上根本看不到它，
     挂上「凝神」之后不知道还能走几步，只能等它自己消失时报一声。 */
  G.ui.closeModal();
  G.statuses.find('st_focus').left = 3;
  G.main.submit('buff 凝神');
  T('剩余量跟着存档里的 left 走（改成 3 就显示 3）',
    G.ui.modalOpen() && modalText().indexOf('还能走 3 格') >= 0);
  G.ui.closeModal();
  G.main.submit('buff st_focus');
  T('按 id 也能打开', G.ui.modalOpen());
  G.ui.closeModal();
  T('摆好前提：弹框关着', !G.ui.modalOpen());

  G.main.submit('buff 不存在的状态');
  T('身上没有的状态：给一句提示，不开弹框',
    !G.ui.modalOpen() && $('log').textContent.indexOf('没有「不存在的状态」这个状态') >= 0);

  /* 计时方式不同，剩余量那句话也不同（manual / threshold 的 turns 是 0，
     写成"还能走 0 格"就是错的） */
  G.statuses.add('st_drained');            /* threshold */
  G.main.submit('buff 灵性枯竭');
  T('threshold 类状态不说"还能走 0 格"',
    G.ui.modalOpen() && modalText().indexOf('还能走') < 0 &&
    modalText().indexOf('去留看条件') >= 0);
  G.ui.closeModal();
  G.statuses.remove('st_drained');

  /* (3) 弹框开着时键盘不给游戏用 —— 免得在列表上按方向键把角色走丢了 */
  G.main.submit('arts');
  T('摆好前提：弹框开着', G.ui.modalOpen());
  const stayAt = G.state.data.world.x + ',' + G.state.data.world.y;
  key('ArrowDown');
  T('弹框开着时方向键不会把角色走丢',
    G.state.data.world.x + ',' + G.state.data.world.y === stayAt);
  key('KeyS');
  T('弹框开着时 WASD 也不走',
    G.state.data.world.x + ',' + G.state.data.world.y === stayAt);
  key('Slash', '/');
  T('弹框开着时按 / 不会进命令模式', G.main.inCommand() === false);

  key('Escape', 'Escape');
  T('按 Esc 能关掉弹框', !G.ui.modalOpen());
  T('Esc 关掉之后角色还在原地',
    G.state.data.world.x + ',' + G.state.data.world.y === stayAt);
  T('关掉之后不抢焦点（不把光标塞进输入框）', G.main.inCommand() === false);

  /* (4) 点遮罩关掉；点方框里面不关（遮罩和方框是兄弟，靠 closest 区分） */
  G.main.submit('arts');
  T('摆好前提：弹框又开着', G.ui.modalOpen());
  $('modal-box').click();
  T('点弹框里面不会关掉', G.ui.modalOpen());
  $('modal-mask').click();
  T('点遮罩能关掉弹框', !G.ui.modalOpen());

  /* (5) 收尾：位置和状态都还给后面几节 */
  G.statuses.remove('st_focus');
  G.state.data.world.x = backX;
  G.state.data.world.y = backY;
  G.ui.refresh();
  T('收尾：身上没状态、弹框关着、位置没动',
    !G.ui.modalOpen() && G.statuses.defs().length === 0 &&
    G.state.data.world.x === backX && G.state.data.world.y === backY);

  /* ---------- 门 ---------- */

  out.push('门');
  const door = G.data.doorAt(G.state.room(), 4, 0);
  T('门被识别出来', !!door && door.to === 'room_up');
  T('门名用上下左右，不用东南西北', !!door && /上面的铁门/.test(door.name));

  /* 进入按钮绑在门上：走到门格上才冒出来 */
  const enterBtn = document.querySelector('#tile button[data-cmd="enter"]');
  T('站在门格上时，点位状态里冒出进入按钮', !!enterBtn);
  T('进入按钮是门色的（跟通用操作区分开）',
    !!enterBtn && getComputedStyle(enterBtn).color === 'rgb(255, 180, 84)');
  T('进入按钮铺满点位状态那一栏的宽',
    !!enterBtn && Math.abs(enterBtn.getBoundingClientRect().width -
      ($('tile').getBoundingClientRect().width)) < 24);

  if (enterBtn) enterBtn.click();
  T('点进入按钮能进门', G.state.data.world.roomId === 'room_up');
  T('落点是门上标的 back (3,4)', G.state.data.world.x === 3 && G.state.data.world.y === 4);
  T('房间被记为已访问', G.state.data.world.visited['room_up'] === true);
  T('进屋之后（这一格不是门）进入按钮就收起来了',
    !document.querySelector('#tile button[data-cmd="enter"]'));

  G.main.submit('down');
  T('走进回程门格 (3,5)', G.state.data.world.x === 3 && G.state.data.world.y === 5);
  T('走到回程门上，进入按钮又出现了',
    !!document.querySelector('#tile button[data-cmd="enter"]'));

  /* 进门也能按键盘：空格 / 句号 / 小键盘中键 */
  key('Space', ' ');
  T('空格键也能进门', G.state.data.world.roomId === 'room_hall');
  T('落点是 (4,1)', G.state.data.world.x === 4 && G.state.data.world.y === 1);

  /* 再走一趟，把另外两个进门键也验掉 */
  key('ArrowUp'); key('ArrowUp'); key('ArrowUp');
  T('键盘走到上面的门 (4,0)', G.state.data.world.y === 0);
  key('Period', '.');
  T('句号键也能进门', G.state.data.world.roomId === 'room_up');
  key('ArrowDown');
  T('键盘走到回程门 (3,5)', G.state.data.world.y === 5);
  key('Numpad5', '5');
  T('小键盘中键也能进门', G.state.data.world.roomId === 'room_hall');
  T('两趟之后回到 (4,1)', G.state.data.world.x === 4 && G.state.data.world.y === 1);

  /* **进门不算走一格。** 它是一次"传送到另一个房间"，不是走过一格 ——
     所以按步计时的状态不递减，"走十步"这类任务也不推进。

     这条以前是**隐式**的（`enterDoor()` 从不调 `G.quests.add('walk', 1)`），
     没有任何地方写下来，很容易被后来人当成"漏了"而补上。
     补上就等于开了个漏洞：站在门上反复进出，能刷掉中毒、也能把走路任务刷满。

     进度先**摆成 0** —— 它可能早就走到上限了（进度停在目标值上），
     那样"没变"就是恒真的，等于没验。

     注意 q_walk20 这时还只是"可接"（没接的任务压根不推进），
     所以得先真的接下来，验完再把记录整个还原 —— 跟上面「角标」那段的做法一样。 */
  const walk20Save = G.state.data.quests['q_walk20']
    ? JSON.parse(JSON.stringify(G.state.data.quests['q_walk20'])) : null;
  T('摆好场景：接下第二个走路任务', G.quests.accept('q_walk20'));
  const walk20 = G.quests.ensure('q_walk20');
  walk20.progress = 0;
  G.statuses.add('st_focus');                      /* step / turns 5 */
  const focusLeft0 = G.statuses.find('st_focus').left;

  key('ArrowUp');
  T('先走回上门 (4,0)', G.state.data.world.y === 0);
  T('走这一步是算数的（状态递减、任务推进）',
    G.statuses.find('st_focus').left === focusLeft0 - 1 &&
    G.quests.progress('q_walk20') === 1);

  key('Space', ' ');
  T('进门确实换了房间（不是没动）', G.state.data.world.roomId === 'room_up');
  T('进门不递减按步计时的状态（它不是走一格）',
    !!G.statuses.find('st_focus') &&
    G.statuses.find('st_focus').left === focusLeft0 - 1);
  T('进门也不推进"走路"类任务', G.quests.progress('q_walk20') === 1);

  /* 走回回程门 (3,5) 再进门回大厅 —— 收尾要把位置还给后面几节 */
  key('ArrowDown');
  T('走进回程门格 (3,5)', G.state.data.world.y === 5);
  key('Space', ' ');
  T('收尾：回到大厅 (4,1)',
    G.state.data.world.roomId === 'room_hall' &&
    G.state.data.world.x === 4 && G.state.data.world.y === 1);

  G.statuses.remove('st_focus');
  if (walk20Save) G.state.data.quests['q_walk20'] = walk20Save;
  else delete G.state.data.quests['q_walk20'];
  T('收尾：状态和任务记录都还原了',
    !G.statuses.has('st_focus') &&
    G.quests.state('q_walk20') === G.quests.AVAILABLE);

  /* ---------- 点地图走路 ---------- */

  out.push('点地图走路');

  /* NPC 挡路这件事在地图上也得看得出来：站在 (4,1) 时正下方是神秘人，
     那一格不该被标成可走。 */
  T('正下方站着人的格子不会被标成可走',
    !document.querySelector('#map [data-move="down"]'));
  T('没被挡的三个方向照样标了出来',
    document.querySelectorAll('#map [data-move]').length === 3);

  /* 挪到 (3,3)：四邻都没人挡，才测得出"四个方向都标到了"。 */
  G.main.submit('left');
  G.main.submit('down');
  G.main.submit('down');
  T('挪到 (3,3)', G.state.data.world.x === 3 && G.state.data.world.y === 3);

  const moveCells = document.querySelectorAll('#map [data-move]');
  T('四邻中能走的格子被标了出来', moveCells.length === 4);
  T('上下左右四个方向都标到了',
    ['up', 'down', 'left', 'right'].every((d) => !!document.querySelector('#map [data-move="' + d + '"]')));
  T('墙没被标成可走', !document.querySelector('#map .wall[data-move]'));
  T('不相邻的格子也没被标',
    document.querySelectorAll('#map [data-move]').length < document.querySelectorAll('#map span').length);

  T('点得到下边那一格', clickMove('down'));
  T('点相邻的格子能走过去', G.state.data.world.y === 4);
  T('点得到上边那一格', clickMove('up'));
  T('点回来也能走', G.state.data.world.y === 3);

  /* ---------- 操作区方向盘 ---------- */

  out.push('操作区方向盘');

  const pad = document.querySelector('#actions .pad');
  T('移动组排成方向盘，不是一排按钮', !!pad);
  T('方向盘里有四个方向按钮', !!pad && pad.querySelectorAll('button[data-cmd]').length === 4);

  const pUp = pad.querySelector('button[data-cmd="up"]').getBoundingClientRect();
  const pLeft = pad.querySelector('button[data-cmd="left"]').getBoundingClientRect();
  const pDown = pad.querySelector('button[data-cmd="down"]').getBoundingClientRect();
  const pRight = pad.querySelector('button[data-cmd="right"]').getBoundingClientRect();
  T('↑ 单独在上面一行', pUp.top < pLeft.top - 2);
  T('↑ 和 ↓ 在同一列', Math.abs(pUp.left - pDown.left) < 1);
  T('← 在左、↓ 在中、→ 在右', pLeft.left < pDown.left && pDown.left < pRight.left);
  T('四个方向键一样大',
    Math.abs(pUp.width - pLeft.width) < 1 && Math.abs(pLeft.width - pRight.width) < 1);
  T('方向盘整体不超出右栏',
    pRight.right <= $('rail-right').getBoundingClientRect().right + 1);

  const padBefore = echoCount('down');
  pad.querySelector('button[data-cmd="down"]').click();
  T('点方向盘按钮能走', G.state.data.world.y === 4);
  T('点方向盘按钮也不回显指令', echoCount('down') === padBefore);
  pad.querySelector('button[data-cmd="up"]').click();
  T('点回原地', G.state.data.world.y === 3);

  const helpBefore = echoCount('help');
  document.querySelector('#actions button[data-cmd="help"]').click();
  T('非移动类的按钮仍然回显指令（方便对照）', echoCount('help') === helpBefore + 1);

  /* ---------- 事件点 ----------

     事件点**不是 NPC**：它不挡路（玩家可以走上去），状态存在存档里，
     触发方式由"写了哪个回调"决定（onCollide 走上去自动 / onUse 点按钮），
     去留由 once 决定，藏不藏由 hidden 决定 —— 三个维度互相正交。

     大厅里的四个演示素材（起点 (3,3)）：
       泉水 (1,2)  onUse + once:false + 不藏   → 看得见，喝一口，永远在
       地砖 (2,2)  onCollide + once:true + 藏  → 空框，踩一下，然后没了
       石龛 (5,2)  onCollide + onUse + 不藏…（藏）→ 踩一下浮出来，之后能摸
       铜钱 (6,4)  onUse + once:true + 不藏    → 看得见，抠出来，然后没了 */
  out.push('事件点');

  const spring = G.data.event('ev_spring');
  const coin   = G.data.event('ev_coin');
  const tileEv = G.data.event('ev_tile');
  const shrine = G.data.event('ev_shrine');
  const evCell = (y, x) => document.querySelectorAll('#map .row')[y].children[x];

  T('事件点表非空', Array.isArray(G.data.events) && G.data.events.length > 0);
  T('事件点类型表非空', Array.isArray(G.data.eventTypes) && G.data.eventTypes.length > 0);
  T('能按 id 查到泉水', !!spring && spring.name === '一眼泉水');
  T('能按 id 查到铜钱', !!coin && coin.name === '卡住的铜钱');
  T('图标字跟名字是分开定义的（名字放不进一个格子）',
    !!spring && spring.glyph === '泉' && spring.glyph !== spring.name);
  T('每个事件点的类型都能在类型表里查到',
    G.data.events.every((e) => !!G.data.eventType(e.type)));
  T('每个事件点都至少有一个出现位置',
    G.data.events.every((e) => Array.isArray(e.at) && e.at.length > 0));
  T('每个事件点的每个位置都指得回一个真实房间',
    G.data.events.every((e) => e.at.every((p) => !!G.data.room(p.room))));
  T('两个回调至少要有一个（都没有就什么也做不了）',
    G.data.events.every((e) => e.onCollide != null || e.onUse != null));
  T('触发方式由"写了哪个回调"决定，不看类型字段',
    !!tileEv && !!tileEv.onCollide && tileEv.onUse == null &&
    !!spring && !!spring.onUse && spring.onCollide == null);

  /* 事件点**不挡路** —— 这是它跟 NPC 最本质的区别。
     同一个 walkable()，对事件点放行、对 NPC 拦下。 */
  T('事件点不参与可走判定：泉水那一格走得上去',
    G.data.walkable(G.state.room(), 1, 2) === true);
  T('石龛那一格也走得上去', G.data.walkable(G.state.room(), 5, 2) === true);
  T('但 NPC 那一格照样走不过去（两者规则不同）',
    G.data.walkable(G.state.room(), 4, 2) === false);

  /* 地图上怎么画 */
  T('互动型的事件点画自己的图标字', evCell(2, 1).textContent === '泉');
  T('事件点格带 event 类（跟 NPC / 门 / 空地分开）',
    evCell(2, 1).classList.contains('event'));
  T('事件点的颜色来自类型表，写成了格子上的 --event-color',
    evCell(2, 1).style.getPropertyValue('--event-color').trim() ===
      G.data.eventType(spring.type).color);
  T('这个颜色真的用上了（那一格的字是绿的）',
    getComputedStyle(evCell(2, 1)).color === 'rgb(94, 227, 155)');
  const evCs = getComputedStyle(evCell(2, 1));
  T('事件点格有一圈边框', !!evCs.boxShadow && evCs.boxShadow.indexOf('inset') >= 0);
  T('边框用的是这个事件点的类型色', evCs.boxShadow.indexOf('94, 227, 155') >= 0);

  /* 藏起来的触发型：**只有边框、没有字** —— 走上去之前看不出是什么 */
  T('还没触发过的机关只画一个空框（一个字都没有）',
    evCell(2, 2).textContent.trim() === '');
  T('空框那格带 hidden 标记', evCell(2, 2).classList.contains('hidden'));
  T('空框用虚线框，跟已经揭开的实线框分得开',
    getComputedStyle(evCell(2, 2)).outlineStyle === 'dashed');
  T('还没触发过的石龛也是空框', evCell(2, 5).textContent.trim() === '');
  T('互动型的事件点不是空框（看得见是什么）',
    !evCell(2, 1).classList.contains('hidden'));
  T('空框那格照样占位，每行还是 9 个字符',
    Array.prototype.every.call(mapRows, (r) => r.textContent.length === 9));

  /* ---------- 互动（use）---------- */

  G.main.submit('left');
  G.main.submit('left');
  T('走到 (1,3)', G.state.data.world.x === 1 && G.state.data.world.y === 3);
  T('还没站上去时，点位状态里没有「地上」这一块', dtTexts().indexOf('地上') < 0);
  T('还没站上去时也没有互动按钮', !clickCmd('use'));

  G.main.submit('up');
  T('站到泉水上 (1,2)', G.state.data.world.x === 1 && G.state.data.world.y === 2);
  T('站在事件点上时点位状态多出「地上」一块', dtTexts().indexOf('地上') >= 0);
  T('面板上写着它的名字', $('tile').textContent.indexOf('一眼泉水') >= 0);
  T('面板上写着它的类型', $('tile').textContent.indexOf('泉水') >= 0);
  T('面板上带着它的描述', $('tile').textContent.indexOf('石缝里渗出一小汪水') >= 0);
  T('互动按钮的文案来自素材的 hint',
    (document.querySelector('#tile button[data-cmd="use"]') || {}).textContent === '喝一口');
  T('玩家站在事件点上时，那一格画的是玩家自己（玩家优先）',
    evCell(2, 1).textContent === '摸' && evCell(2, 1).classList.contains('me'));

  T('点得到互动按钮', clickCmd('use'));
  T('互动了一次，次数记下来了', G.events.times('ev_spring') === 1);
  T('互动的效果写进了记事', $('log').textContent.indexOf('你掬起一捧水喝了') >= 0);
  T('泉水互动后不消失（once: false）', G.events.alive(spring) === true);
  T('还活着的东西照样在索引里', !!G.events.at(G.state.room(), 1, 2));

  clickCmd('use');
  T('泉水可以反复互动（互动后不消失）', G.events.times('ev_spring') === 2);

  G.main.submit('right');
  T('走开之后，不消失的事件点照样画着自己的字', evCell(2, 1).textContent === '泉');
  G.main.submit('left');
  T('走回泉水 (1,2)', G.state.data.world.x === 1 && G.state.data.world.y === 2);

  /* ---------- 触发（step）---------- */

  G.main.submit('right');
  T('走到松动的地砖上 (2,2)', G.state.data.world.x === 2 && G.state.data.world.y === 2);
  T('踩上去当场自动触发，不用按任何键', $('log').textContent.indexOf('脚下一沉') >= 0);
  T('触发次数记下来了', G.events.times('ev_tile') === 1);
  T('一次性的事件点触发后就没了（once: true）', G.events.alive(tileEv) === false);
  T('没了之后点位状态里也没有「地上」这一块', dtTexts().indexOf('地上') < 0);
  T('没了之后也不该再冒出互动按钮', !clickCmd('use'));

  G.main.submit('right');
  T('走开 (3,2)', G.state.data.world.x === 3 && G.state.data.world.y === 2);
  /* "变回空地"要等走开之后才看得到 —— 玩家站在那一格时画的是玩家自己 */
  T('没了之后地图上那一格变回普通空地',
    evCell(2, 2).textContent.trim() === '' && evCell(2, 2).classList.contains('floor'));

  G.main.submit('left');
  T('走回已经用掉的那一格 (2,2)',
    G.state.data.world.x === 2 && G.state.data.world.y === 2);
  T('已经用掉的事件点不会再触发一遍', G.events.times('ev_tile') === 1);

  /* ---------- 触发后揭开 + 两条触发路都通 ---------- */

  /* (2,2) → 下 → 右×3 → 上。不直着往右走：(4,2) 站着神秘人，会被挡下来 */
  G.main.submit('down');
  G.main.submit('right');
  G.main.submit('right');
  G.main.submit('right');
  G.main.submit('up');
  T('走到石龛上 (5,2)', G.state.data.world.x === 5 && G.state.data.world.y === 2);
  T('踩上去触发了', G.events.times('ev_shrine') === 1);
  T('触发后没消失（once: false）', G.events.alive(shrine) === true);

  G.main.submit('right');
  T('走开 (6,2)', G.state.data.world.x === 6 && G.state.data.world.y === 2);
  T('触发过之后就看得到了（不再是空框）', evCell(2, 5).textContent === '龛');
  T('揭开之后不再是 hidden', !evCell(2, 5).classList.contains('hidden'));
  T('揭开之后换成实线框', getComputedStyle(evCell(2, 5)).outlineStyle !== 'dashed');

  G.main.submit('left');
  T('走回石龛上 (5,2)', G.state.data.world.x === 5 && G.state.data.world.y === 2);
  T('再走上来又踩了一次（每次都再触发）', G.events.times('ev_shrine') === 2);
  T('石龛也有互动按钮（onUse 和 onCollide 都写了）', hasCmd('use'));
  clickCmd('use');
  T('互动也算一次', G.events.times('ev_shrine') === 3);
  T('互动的记事写出来了', $('log').textContent.indexOf('石龛里空空的') >= 0);
  G.main.submit('right');
  G.main.submit('left');
  T('可重复的触发型：走开再走回来还会再触发', G.events.times('ev_shrine') === 4);

  /* ---------- 用掉的东西（use + once）---------- */

  G.main.submit('right');
  G.main.submit('down');
  T('走到铜钱旁边 (6,3)', G.state.data.world.x === 6 && G.state.data.world.y === 3);
  T('站在旁边就看得见铜钱的字（互动型不藏）', evCell(4, 6).textContent === '钱');

  G.main.submit('down');
  T('走到铜钱上 (6,4)', G.state.data.world.x === 6 && G.state.data.world.y === 4);
  T('面板上有互动按钮', hasCmd('use'));
  T('按钮上写着「抠出来」',
    (document.querySelector('#tile button[data-cmd="use"]') || {}).textContent === '抠出来');

  const hpBeforeUse = G.state.player().hp;
  clickCmd('use');
  T('铜钱被用掉了（once: true）', G.events.alive(coin) === false);
  T('记事里说了捡起来', $('log').textContent.indexOf('你把铜钱抠了出来') >= 0);
  T('没了之后点位状态里没有「地上」', dtTexts().indexOf('地上') < 0);
  G.main.submit('up');
  T('走开 (6,3)', G.state.data.world.x === 6 && G.state.data.world.y === 3);
  T('地图上也没了', evCell(4, 6).textContent.trim() === '');
  G.main.submit('down');
  T('走回 (6,4)', G.state.data.world.x === 6 && G.state.data.world.y === 4);
  T('捡完东西生命一点没变（数值效果现在不真改）',
    G.state.player().hp === hpBeforeUse);
  T('applyEffect 直接返回 false（表示没执行）',
    G.rules.applyEffect('player.hp', '-5') === false);

  /* `set` 这一条**现在没有任何素材写** —— 因为当前没有合法的目标字段：
     04 定了"生命 / 灵性只做显示，只有状态的 tick 能改它们"，
     六项基础属性和神性是角色自己的东西，事件点不该直接改。
     所以这段运行分支一直没被执行过（写了等于没写）。
     这里**临时**造一个事件点把分支真的走一遍，验完立刻收拾干净 ——
     别为了测试往 data/ 里塞假素材。

     注意不能用铜钱来试：它是 `once`，已经用掉了，
     `fire()` 第一行就是 `if (!alive(ev)) return`，效果根本跑不到。 */
  const hpBeforeSet = G.state.player().hp;
  let applied = null;
  const realApply = G.rules.applyEffect;
  G.rules.applyEffect = function (k, d) { applied = k + ' ' + d; return realApply(k, d); };

  const setProbe = {
    id: 'ev_set_probe', type: 'trigger', name: '临时', glyph: '临',
    at: [{ room: 'room_hall', x: 1, y: 5 }],
    onUse: [{ set: { 'player.hp': '-5' } }]
  };
  const setProbeRes = G.events.fire(setProbe, G.events.USE);

  T('临时事件点真的触发了', setProbeRes.ok === true);
  T('事件点里的 set 会被解析到（applyEffect 收到了对的键和值）',
    applied === 'player.hp -5');
  T('调归调，生命一点没变（applyEffect 是空壳）',
    G.state.player().hp === hpBeforeSet);

  G.rules.applyEffect = realApply;
  delete G.state.data.events.ev_set_probe;   /* 别把测试用的临时记录留在存档里 */
  T('收尾：临时记录和临时钩子都收拾干净了',
    !G.state.data.events.ev_set_probe && G.rules.applyEffect === realApply);

  /* 纯 onCollide 的东西，用 use 去点是点不动的 ——
     fire() 返回 ok: false，world 那边说一句中性的话，不暴露"要用脚踩"。 */
  const stepOnly = {
    id: 'ev_tmp', type: 'trigger', name: '临时', glyph: '临',
    at: [{ room: 'room_hall', x: 1, y: 5 }],
    onCollide: [{ log: '临时' }]
  };
  T('用 use 去点一个纯 onCollide 的东西，触发不了',
    G.events.fire(stepOnly, G.events.USE).ok === false);
  T('用 step 去触发它就成功', G.events.fire(stepOnly, G.events.STEP).ok === true);
  T('已经用掉的东西再触发也不会 ok', G.events.fire(tileEv, G.events.STEP).ok === false);
  delete G.state.data.events.ev_tmp;   /* 别把测试用的临时数据留在存档里 */

  /* ---------- 任务目标：reach / use ---------- */

  const qSpring = G.data.quest('q_spring');
  const qDrink  = G.data.quest('q_drink');
  T('任务可以指定"走到某个事件点"（reach）',
    !!qSpring && qSpring.goal.type === 'reach' && qSpring.goal.ev === 'ev_spring');
  T('任务可以指定"跟某个事件点互动"（use）',
    !!qDrink && qDrink.goal.type === 'use' && qDrink.goal.ev === 'ev_spring');
  T('每个 reach / use 任务都指向真实事件点',
    G.data.quests.every((q) => ['reach', 'use'].indexOf((q.goal || {}).type) < 0 ||
      !!G.data.event(q.goal.ev)));
  T('没接的 reach 任务，走过去也不推进（未接收不可执行）',
    G.quests.progress('q_spring') === 0);

  /* q_spring 挂在任务链末尾（requires q_walk30）。这里为了单独验它，
     先把前置摆成已交付 —— 任务链门禁本身在前面「对话」那一节已经验过了。

     **摆的是 times 而不是 state** —— requires 的判据是"交过差"（times > 0），
     不是"到了终态"（可重复任务到不了 done）。只把 state 摆成 DONE 是解不开锁的，
     这一条在「收集任务与奖励」那一节有专门的反向验证。 */
  G.quests.ensure('q_walk30').times = 1;
  G.quests.ensure('q_walk30').state = G.quests.DONE;
  T('前置交付之后就能接下「看一眼泉水」', G.quests.accept('q_spring') === true);
  T('接下「看一眼泉水」', G.quests.state('q_spring') === G.quests.ACTIVE);

  /* 从 (6,4) 绕到泉水 (1,2)：(6,4) → 上 → 左×4 → 上 → 左。
     不直着往左走 —— (2,4) 站着商人、(4,2) 站着神秘人，都会被挡下来。 */
  G.main.submit('up');
  G.main.submit('left');
  G.main.submit('left');
  G.main.submit('left');
  G.main.submit('left');
  G.main.submit('up');
  G.main.submit('left');
  T('走到泉水上 (1,2)', G.state.data.world.x === 1 && G.state.data.world.y === 2);
  T('走到指定事件点上，reach 任务当场达成', G.quests.isReady('q_spring') === true);
  T('达成时当场报了一声', $('log').textContent.indexOf('任务目标达成：看一眼泉水') >= 0);

  /* 交付掉，好让后面的 use 任务解锁（requires 看的是"交付了没有"） */
  T('交掉它', G.quests.deliver('q_spring').ok === true);

  G.quests.accept('q_drink');
  T('接下「喝一口」', G.quests.state('q_drink') === G.quests.ACTIVE);
  T('光站着还不算互动', G.quests.isReady('q_drink') === false);
  clickCmd('use');
  T('跟指定事件点互动，use 任务当场达成', G.quests.isReady('q_drink') === true);

  /* 别写成 G.state.data.events.ev_spring.times —— 万一上面某一步没走到，
     这里会直接抛错，把脚本后面几十条检查全带走。 */
  T('触发次数写进了存档', G.events.times('ev_spring') > 0);
  T('存档的 events 里真的留了一条记录',
    !!(G.state.data.events && G.state.data.events.ev_spring &&
       G.state.data.events.ev_spring.times > 0));

  /* 把场景交还给后面几节：(1,2) → (3,3) */
  G.main.submit('right');
  G.main.submit('right');
  G.main.submit('down');
  T('回到 (3,3)', G.state.data.world.x === 3 && G.state.data.world.y === 3);

  /* ---------- 存档接口 ---------- */

  out.push('存档接口');
  T('检测到 File System Access API', G.save.hasFSA() === true);
  T('未绑定时文件名为空', G.save.fileName() === '');
  let exportOk = false;
  try { G.save.exportFile(); exportOk = true; } catch (e) { out.push('      导出抛错：' + e.message); }
  T('导出不抛错', exportOk);

  /* ---------- 存档往返 ---------- */

  out.push('存档往返');
  let text = '';
  try { text = G.state.toJSON(); } catch (e) { text = ''; }
  T('能序列化成字符串', typeof text === 'string' && text.length > 0);

  /* 先连取两个随机数，读档后再连取两个，两两应该完全一样。
     注意不能只取一个做对比：next() 是先推进游标再取值，
     读档后取到的是紧接着的下一个数，不是刚才那个。
     写这个测试时第一版就踩了这个坑，报了假失败。 */
  const a = G.rng.next();
  const b = G.rng.next();

  let roundTripOk = false;
  try {
    G.state.fromJSON(text);
    roundTripOk = true;
  } catch (e) {
    out.push('      读回时抛错：' + e.message);
  }
  T('读回来不抛错', roundTripOk);
  T('读回后还在 room_hall', G.state.data.world.roomId === 'room_hall');
  T('读回后坐标还是 (3,3)', G.state.data.world.x === 3 && G.state.data.world.y === 3);
  T('读回后角色名没丢', G.state.player().name === '摸鱼测试号');
  T('随机流跨存档一致（cursor 恢复正确）', G.rng.next() === a && G.rng.next() === b);
  T('存档里带着版本号 v', G.state.data.v === G.state.VERSION);
  T('存档里带着随机游标', typeof G.state.data.rng.cursor === 'number');
  T('存档里带着任务记录', !!(G.state.data.quests && G.state.data.quests['q_walk10']));
  T('记录里存的是三个状态之一', G.state.data.quests['q_walk10'].state === 'done');
  T('做完的任务读回来还是做完的（不会被当成没做）',
    G.quests.isDone('q_walk10') === true);
  T('存档里记着可重复任务完成过几次', G.quests.times('q_patrol') === 1);
  T('可重复任务读回来不会被当成已完成', G.quests.isDone('q_patrol') === false);

  /* 事件点的触发次数也要跨存档 —— 不然读一次档，捡过的铜钱又长出来了 */
  T('存档里带着事件点的触发次数',
    !!(G.state.data.events && G.state.data.events['ev_spring']));
  T('读回来之后次数没丢', G.events.times('ev_spring') > 0);
  T('用掉的一次性事件点读回来还是用掉的', G.events.alive(coin) === false);

  /* ---------- 操作区不随角色变化 ----------

     操作区原来有一组按"拥有几个主动技能"现生成的「技能」按钮。读档 / 导入
     会把**整个角色换掉**，那时候必须重画 —— 不然屏幕上挂着一个上一个角色的
     按钮，点下去报"没有这个指令"（save.js 里为此专门留过一个注册口子）。

     那组现在**已废弃**：改成「行动」组里一个固定的「释放法术」按钮，
     操作区的内容跟角色无关了，那个注册口子也一起删掉了。
     这一段盯的就是"别再长出动态组来"：换一份技能集完全不同的档读进来，
     操作区的按钮必须一个都不变。 */

  out.push('操作区不随角色变化');

  const saveBack = window.localStorage.getItem(G.save.KEY);
  const actsHtml = () => $('actions').innerHTML;
  const actsBefore = actsHtml();
  T('操作区里没有「技能」这一组（已废弃）', $('actions').textContent.indexOf('技能') < 0);
  T('操作区里没有任何带技能 id 的按钮',
    !document.querySelector('#actions button[data-arg^="skl_"]'));

  /* 造一份"只有被动技能"的档写进本地存储，再走**正常的读档路径** ——
     不直接调 renderActions 去看它画出什么，那样验的是"函数能用"，
     不是"读档之后屏幕上是什么样"。 */
  const altSave = JSON.parse(G.state.toJSON());
  altSave.player.name = '别人的档';
  altSave.player.skills = ['skl_ironbone'];
  window.localStorage.setItem(G.save.KEY, JSON.stringify(altSave));

  G.save.load();
  await wait(50);

  T('读进来的角色确实没有主动技能', G.skills.active().length === 0);
  T('读档之后角色确实换了', G.state.player().name === '别人的档');
  T('读档之后操作区一个按钮都没变（内容跟角色无关）', actsHtml() === actsBefore);
  /* 左栏没有技能块了，被动技能从**技艺弹框**看。
     换角色之后这条也得成立 —— 否则"读档之后被动技能看不见了"
     是个从界面上完全看不出原因的坑。 */
  G.ui.openModal('arts');
  T('被动技能还看得到（在技艺弹框里，它不需要按钮）',
    $('modal').textContent.indexOf('铁骨') >= 0);
  G.ui.closeModal();
  T('看完关掉', !G.ui.modalOpen());

  /* 导入走的是**另一条路**（文件 → onImportFile），跟读档是两处独立的调用点，
     只验读档等于只锁了一半。 */
  window.localStorage.setItem(G.save.KEY, saveBack);
  G.save.load();
  await wait(50);
  T('先读回原档（摆好导入的前提）', G.state.player().name === '摸鱼测试号');

  const altFile = new File([JSON.stringify(altSave)], 'alt.json',
                           { type: 'application/json' });
  G.save.onImportFile(altFile);
  await wait(80);
  T('导入之后角色换成了档里那个', G.state.player().name === '别人的档');
  T('导入之后操作区还是没变', actsHtml() === actsBefore);

  /* 收尾：把原存档写回去再读一遍，别把后面几节带偏 */
  window.localStorage.setItem(G.save.KEY, saveBack);
  G.save.load();
  await wait(50);
  T('收尾：读回原档，角色还是原来那个', G.state.player().name === '摸鱼测试号');
  T('收尾：操作区依然是那一套', actsHtml() === actsBefore);

  /* ---------- 物品与背包 ----------

     第 22 轮（背包系统）。物品有两个来源：事件点的 give 效果、任务奖励 ——
     这一节走**界面**那条路（左栏背包块 / 物品详情 / 钱包 / 笔记本），
     收集类任务和奖励在下一节。

     这一节会给操作区断言：**bag 跟 enter / talk / use / buff 一样不出现在
     操作区里** —— 它的按钮是左栏「玩家背包」块里那个物品名。

     起点先清空背包与钱包。前面几节走过 (7,1)（钱袋那一格），但只是踩上去、
     没点「捡起来」，所以本来就该是空的；显式清一遍是为了**让起点确定**，
     以后前面几节顺手多捡个东西也不会把这一节带偏。 */

  out.push('物品与背包');

  const bagEl = $('bag');
  /* 一律走这几个"找不到就返回空串 / 就不点"的小工具。
     **不要在断言里直接 `.textContent`** —— 元素不在时它是 null，
     当场抛错会把后面几十条检查一起带走，而且报出来的错指不到真正的问题
     （反向验证时逮住的：把"事件点不挡路"改坏之后，钱袋捡不到，
     这一节就断在第一个 `.textContent` 上，后面的背包检查一条都没跑）。 */
  const bagTag = (id) => bagEl.querySelector('dd.item button[data-arg="' + id + '"]');
  const tagText = (id) => { const b = bagTag(id); return b ? b.textContent : ''; };
  const tagAttr = (id, a) => { const b = bagTag(id); return b ? (b.getAttribute(a) || '') : ''; };
  const tagBoxStyle = (id) => {
    const b = bagTag(id);
    return b ? (b.parentNode.getAttribute('style') || '') : '';
  };
  const tagColor = (id) => { const b = bagTag(id); return b ? getComputedStyle(b).color : ''; };
  const clickBag = (id) => { const b = bagTag(id); if (b) b.click(); return !!b; };
  const bagCount = () => bagEl.querySelectorAll('dd.item').length;
  const bagFirstText = () => {
    const d = bagEl.querySelector('dd.item');
    return d ? d.textContent : '';
  };
  /* 标签**盒子**的宽 / 标签**文字**的宽。并排成标签的判据是"盒子按文字占宽"，
     量文字本身没用 —— 盒子会被父级拉满，量出来永远"装得下"。
     找不到元素时返回 0，让对应断言直接变红而不是抛错。 */
  const tagBoxW = (id) => {
    const b = bagTag(id);
    return b ? b.parentNode.getBoundingClientRect().width : 0;
  };
  const tagTextW = (id) => { const b = bagTag(id); return b ? textWidth(b) : 0; };
  const bodyHtml = () => $('modal-body').innerHTML;
  /* 弹框里那个动作按钮。找不到时返回 null —— 调用方用 `&&` 判。 */
  const modalBtn = () => $('modal-body').querySelector('button[data-cmd="bag"]');

  G.state.data.items = {};
  G.state.data.wallet = {};
  /* 位置是前面几节留下的，这里**显式摆回大厅中央** ——
     这一节要走六步去捡钱袋，起点不确定的话走法就不可靠了。 */
  G.state.data.world.roomId = 'room_hall';
  G.state.data.world.x = 3;
  G.state.data.world.y = 3;
  G.ui.refresh();
  T('摆好前提：站在大厅 (3,3)', G.state.data.world.x === 3 && G.state.data.world.y === 3);

  T('背包是 dl#bag（不是占位 div）', bagEl && bagEl.tagName === 'DL');
  T('操作区里没有背包按钮（bag 不占操作区）',
    !document.querySelector('#actions button[data-cmd="bag"]'));
  T('摆好前提：背包是空的', bagCount() === 0);
  T('空背包给一句提示', bagEl.textContent.indexOf(G.data.t('bag.empty')) >= 0);
  T('空的时候 dl 上挂着 idle 类', clsOf(bagEl).indexOf('idle') >= 0);

  G.main.submit('bag');
  T('bag 指令对空背包说一句（不是列一块空白）',
    $('log').textContent.indexOf('身上什么也没有') >= 0);

  /* 真走一遍拾取：走到钱袋那一格，点「捡起来」。
     这是 give / money 两条效果键的**端到端**验证 ——
     素材里写了，背包和钱包里就得真的多出来。 */
  G.main.submit('right');
  G.main.submit('right');
  G.main.submit('right');
  G.main.submit('right');
  T('走到 (7,3)', G.state.data.world.x === 7 && G.state.data.world.y === 3);
  G.main.submit('up');
  G.main.submit('up');
  T('走到钱袋那一格 (7,1)', G.state.data.world.x === 7 && G.state.data.world.y === 1);
  T('踩上去还不算捡到（钱袋只写了 onUse）', G.items.count('itm_purse') === 0);
  T('点位状态里画出了「捡起来」按钮', hasCmd('use'));

  clickCmd('use');
  T('点一下真的捡到了钱袋', G.items.count('itm_purse') === 1);
  T('钱袋只给了一个（唯一物品）', G.items.count('itm_purse') === 1);
  T('同一格上的 money 效果也落了地', G.items.money('coin') === 12);
  T('背包里出现一个标签', bagCount() === 1);
  T('标签上写的是钱袋', tagText('itm_purse') === '钱袋');
  T('唯一的物品不写数量', tagText('itm_purse').indexOf('×') < 0);
  T('标签带分类颜色变量（颜色来自分类表，不写死在 CSS 里）',
    /--item-color/.test(tagBoxStyle('itm_purse')));
  T('标签走 bag 指令、带物品 id',
    tagAttr('itm_purse', 'data-cmd') === 'bag' &&
    tagAttr('itm_purse', 'data-arg') === 'itm_purse');
  T('有东西之后 idle 类去掉了', clsOf(bagEl).indexOf('idle') < 0);

  /* 标签的颜色**真的来自分类表**（`itemKinds[].color`），不是写死在 CSS 里。
     只断言"那个 CSS 变量写在 style 上"是不够的 —— CSS 那边把变量丢掉、
     写成固定色，标签照样在，颜色却不对了。所以量算出来的颜色。 */
  T('标签的颜色真的来自分类表（不是写死在 CSS 里）',
    tagColor('itm_purse') === rgbOf(G.data.itemKind('special').color));

  /* 唯一物品：已经有了再给等于没给 —— **返回 0、数量不变**，
     而且要**补一句提示**（静默失效是本项目最讨厌的一类坑：
     素材里那句"你捡起钱袋"照写，背包里却什么都没多）。 */
  T('唯一物品再给一次：返回 0', G.items.give('itm_purse', 1) === 0);
  T('唯一物品再给一次：数量还是 1', G.items.count('itm_purse') === 1);
  const dupRun = G.effects.run([{ give: { itm_purse: 1 } }]);
  T('唯一物品已经有了再给，会补一句提示（不是静默失效）',
    dupRun.events.length === 1 &&
    dupRun.events[0].text.indexOf('你已经有一个「钱袋」') >= 0);

  /* 点标签 → 物品详情 */
  T('点得到背包标签', clickBag('itm_purse'));
  T('点背包标签开物品详情', G.ui.modalOpen() && $('modal').hidden === false);
  T('标题是物品名（不是干巴巴的"物品详情"）',
    $('modal-title').textContent.indexOf('钱袋') >= 0);
  T('标题上有分类小标签', $('modal-title').textContent.indexOf('特殊') >= 0);
  T('详情里有描述', modalText().indexOf('一只旧布袋') >= 0);
  T('唯一的物品写「只有一个」', modalText().indexOf('只有一个') >= 0);
  T('详情框里**没有**丢弃按钮', modalText().indexOf('丢弃') < 0);

  const purseBtn = modalBtn();
  T('钱袋的按钮是「看看里面有多少」（文案来自 strings）',
    purseBtn && purseBtn.textContent === G.data.t('modal.item.open.wallet'));
  T('按钮走 bag use', purseBtn && purseBtn.getAttribute('data-arg') === 'use itm_purse');

  /* 点它 → **换**成钱包弹框（不是叠一层） */
  if (purseBtn) purseBtn.click();
  T('换成钱包弹框', G.ui.modalOpen() && $('modal-title').textContent.indexOf('钱袋') >= 0);
  T('钱包里报出金币余额', modalText().indexOf('12') >= 0 && modalText().indexOf('金币') >= 0);
  T('余额用币种表里的颜色（不写死）', /--money-color/.test(bodyHtml()));
  G.ui.closeModal();
  T('关掉之后弹框藏起来', !G.ui.modalOpen() && $('modal').hidden === true);

  /* 扣钱扣到 0 为止：不会变成负数，返回的是**实际变化了多少** */
  T('扣钱扣到 0 为止（不会变成负数，返回的是实际变化量）',
    G.items.addMoney('coin', -999) === -12 && G.items.money('coin') === 0);

  /* 一种钱都没有的时候说一句，不是画一排 0 */
  G.main.exec('bag', ['use', 'itm_purse']);
  T('钱包空了就说「里面空空的」', modalText().indexOf('里面空空') >= 0);
  T('空钱包不画一排 0', modalText().indexOf('0') < 0);
  G.ui.closeModal();
  G.items.addMoney('coin', 12);
  T('钱补回来了（摆好后面的前提）', G.items.money('coin') === 12);

  /* 可堆叠 + 能用：清心草 */
  G.items.give('itm_herb', 3);
  G.ui.refresh();
  T('可堆叠的标签写 ×3', tagText('itm_herb') === '清心草 ×3');
  T('排序：消耗品排在特殊前面（按分类表，不按捡到的先后）',
    bagFirstText().indexOf('清心草') >= 0);
  /* 物品标签跟状态标签是同一套排法：**按自己的文字占宽**，不铺满整行。
     量的是 dd 那一层 —— 按钮上加 width 是空操作（宽度由内容决定的 flex item），
     能把标签拉满整行的只有 dd 自己。 */
  T('物品标签按自己的文字占宽（不铺满整行）',
    tagBoxW('itm_herb') > 0 &&
    tagBoxW('itm_herb') < bagEl.getBoundingClientRect().width - 1 &&
    tagBoxW('itm_herb') <= tagTextW('itm_herb') + 20);

  T('点得到清心草那个标签', clickBag('itm_herb'));
  T('详情里写「持有 3 个」', modalText().indexOf('持有 3 个') >= 0);
  const herbUseBtn = modalBtn();
  T('能用的物品按钮是「使用」', herbUseBtn && herbUseBtn.textContent === G.data.t('modal.item.use'));
  if (herbUseBtn) herbUseBtn.click();
  T('用完弹框自动关掉（不然玩家以为点了没反应）', !G.ui.modalOpen());
  T('用完数量减一', G.items.count('itm_herb') === 2);
  T('记事里写了使用那一句', $('log').textContent.indexOf('你把清心草嚼了') >= 0);
  T('use 里的 buff 效果挂上了状态', G.statuses.has('st_focus') === true);
  G.statuses.remove('st_focus');

  G.main.exec('bag', ['use', 'itm_herb']);
  T('bag use 跳过详情框直接吃', G.items.count('itm_herb') === 1 && !G.ui.modalOpen());

  /* 错误路径：三种提示各不相同 */
  G.main.submit('bag 不存在的东西');
  T('找不到的物品报「没有这个指令」', $('log').textContent.indexOf('没有这个指令') >= 0);
  G.main.submit('bag 钱袋');
  T('按名字能查到（不用记 id）', G.ui.modalOpen());
  G.ui.closeModal();
  G.main.submit('bag itm_note');
  T('身上没有的物品说「身上没有」，不是「没有这个指令」',
    !G.ui.modalOpen() && $('log').textContent.indexOf('身上没有「笔记本」') >= 0);

  /* 笔记本：任务分「进行中 / 已完成」两栏。

     **任务记录直接摆，不继承前面几节留下的** —— 读档那几节会把整个状态换掉，
     依赖它们的话，这一节会因为"前面某节换过档"而莫名其妙地红。
     任务机制本身在「任务」「对话」两节已经验过了，这里验的是**笔记本怎么画**：
     谁进「进行中」、谁进「已完成」、进度怎么写。 */
  G.state.data.quests = {};
  G.quests.accept('q_walk10');              /* 进行中：接了、还没交 */
  G.quests.ensure('q_patrol').times = 2;    /* 已完成：交过两次差 */

  T('给笔记本成功', G.items.give('itm_note', 1) === 1);
  G.main.exec('bag', ['use', 'itm_note']);
  T('笔记本弹框开了', G.ui.modalOpen() && $('modal-title').textContent.indexOf('笔记本') >= 0);
  T('有「进行中」一栏', modalText().indexOf(G.data.t('modal.note.active')) >= 0);
  T('有「已完成」一栏', modalText().indexOf(G.data.t('modal.note.done')) >= 0);
  T('进行中列着已接的任务', modalText().indexOf('走十步') >= 0);
  T('进行中报进度', modalText().indexOf('0 / 10') >= 0);
  noteSwitch('done');   /* 切到「已完成」书签再看那一栏 */
  T('已完成列着交过差的任务', modalText().indexOf('搭把手') >= 0);
  T('已完成写的是"完成过几次"（可重复任务能重复出现）',
    modalText().indexOf('完成 2 次') >= 0);
  T('「可接但没接」的任务两栏都不列', modalText().indexOf('三株清心草') < 0);
  T('笔记本是纯看的，不给按钮', !$('modal-body').querySelector('button[data-cmd]'));
  G.ui.closeModal();
  T('看完关掉', !G.ui.modalOpen());

  /* ---------- 收集任务与奖励 ----------

     q_herb 是唯一的 collect 任务：进度**现算**（就是"现在身上有几个"），
     交付时按 goal.count 扣掉，奖励 30 金币。

     跟商人交付走的是玩家那条路（临时把他挪到旁边，点二级区里的「交付」），
     不走 G.quests.deliver() 直调 —— 那样验的是函数能用，
     不是"点按钮之后发生了什么"。

     任务记录同样**直接摆**，理由跟笔记本那一节一样。 */

  out.push('收集任务与奖励');

  /* 前置的判据是 `times > 0`（交过差），**不是 state === 'done'** ——
     可重复任务交付后 state 立刻回到 available，永远到不了 done。
     按 done 判的话，requires 指向一个可重复任务就永远不满足。
     所以这里两种摆法都试一遍：只把 state 摆成 done 不够，还得真的交过差。 */
  G.state.data.quests = {};
  G.quests.ensure('q_patrol').state = G.quests.DONE;
  T('前置只摆 state=done 是不够的（可重复任务到不了 done）',
    G.quests.accept('q_herb') === false);
  G.quests.ensure('q_patrol').times = 1;
  T('前置交过差（times > 0）才真的解锁', G.quests.accept('q_herb') === true);
  T('接下收集任务', G.quests.state('q_herb') === G.quests.ACTIVE);

  /* collect 的"现算"：捡到又用掉，进度得自己退回去。
     不能累计 —— 累计的话"攒够 3 个用掉 1 个"还显示 3 / 3，
     玩家以为能交差，交付时才发现不够。 */
  G.items.take('itm_herb', 99);      /* 把草清干净，起点确定（别动钱袋和笔记本） */
  T('取干净之后记录被删掉（不留 count: 0 的空壳）',
    !G.state.data.items.itm_herb && G.items.has('itm_herb') === false);
  G.items.give('itm_herb', 2);
  T('身上 2 株：进度是 2', G.quests.progress('q_herb') === 2);
  T('身上 2 株：还不能交', G.quests.isReady('q_herb') === false);
  G.items.give('itm_herb', 1);
  T('凑够 3 株：可以交差了', G.quests.isReady('q_herb') === true);
  G.items.take('itm_herb', 1);
  T('用掉 1 株：进度当场退回 2（不累计）', G.quests.progress('q_herb') === 2);
  T('用掉 1 株：立刻变回"还不能交"', G.quests.isReady('q_herb') === false);
  G.items.give('itm_herb', 1);
  T('再补 1 株：又变成可以交', G.quests.isReady('q_herb') === true);

  /* 交付走玩家那条路：把玩家挪进杂物间 —— 商人本来就站在那儿（(2,3)）。
     **不能留在大厅**：q_herb 限定了 `room: room_right`，站在大厅里
     这个任务根本不会从商人身上挂出来（见 ofNpc 的 room 判定）。 */
  const beforeCoin = G.items.money('coin');
  const beforeHerb = G.items.count('itm_herb');
  G.state.data.world.roomId = 'room_right';
  G.state.data.world.x = 1;
  G.state.data.world.y = 3;
  G.ui.refresh();

  T('摆好前提：站在杂物间里，商人就在旁边', !!tileBtn('npc_merchant'));
  T('点得到「跟商人说话」', clickArg('npc_merchant'));
  T('二级区里出现「交付：三株清心草」', talkArgs().indexOf('deliver q_herb') >= 0);

  clickSec('deliver q_herb');
  T('交付成功，清心草被扣掉', G.items.count('itm_herb') === beforeHerb - 3);
  T('奖励的金币到账了', G.items.money('coin') === beforeCoin + 30);
  T('记事里报出拿到了什么', $('log').textContent.indexOf('拿到了：金币 ×30') >= 0);
  T('完成次数记下来了', G.quests.times('q_herb') === 1);
  T('不可重复的任务进终态', G.quests.state('q_herb') === G.quests.DONE);
  T('交完就从对话选项里消失', talkArgs().indexOf('deliver q_herb') < 0);

  /* 交付之后再翻笔记本，它应该躺在「已完成」那一栏里 */
  G.main.exec('bag', ['use', 'itm_note']);
  noteSwitch('done');   /* 交付的任务进了「已完成」，切过去才看得到 */
  T('笔记本里出现刚交掉的任务', modalText().indexOf('三株清心草') >= 0);
  T('它躺在「已完成」那一栏', modalText().indexOf('三株清心草') >
    modalText().indexOf(G.data.t('modal.note.done')));
  G.ui.closeModal();

  /* 把玩家摆回大厅，别把后面几节带偏 */
  G.state.data.world.roomId = 'room_hall';
  G.state.data.world.x = 3;
  G.state.data.world.y = 3;
  G.ui.refresh();

  /* ---------- 降级容错 ---------- */

  out.push('降级容错');

  const nameBefore = G.state.player().name;

  /* v5 是分水岭：**v1–v4 一律拒绝**（player 整个换过，见 07-存档与状态.md）。
     这里逐版验一遍，防止以后有人"顺手"加回一段假的迁移。 */
  const rejects = (obj) => {
    try { G.state.fromJSON(JSON.stringify(obj)); return false; }
    catch (e) { return /重开一局/.test(e.message); }
  };

  T('v1 旧存档被拒绝（玩家状态换过，不迁移）',
    rejects({ v: 1, player: { name: '旧档', lv: 1, hp: 20 }, world: { roomId: 'room_hall' } }));
  T('v2 存档被拒绝', rejects({ v: 2, player: { name: '老档' }, world: { roomId: 'room_hall' } }));
  T('v3 存档被拒绝', rejects({ v: 3, player: { name: '老档三' }, world: { roomId: 'room_hall' } }));
  T('v4 存档被拒绝', rejects({ v: 4, player: { name: '老档四' }, world: { roomId: 'room_hall' } }));

  /* 被拒绝之后内存里的存档不能被动坏 —— migrate 抛错时 load 不该已经跑过 */
  T('拒绝旧档之后，当前存档还在', G.state.isLoaded() === true);
  T('拒绝旧档之后，角色还是原来那个', G.state.player().name === nameBefore);

  /* v5 存档缺字段也能补齐：玩家对象按新结构重建，再逐字段覆盖 */
  let v5Ok = false;
  try {
    G.state.fromJSON(JSON.stringify({
      v: 5,
      player: { name: '半个档' },                 /* 只有名字，别的字段全缺 */
      world: { roomId: '不存在的房间' },
      quests: { q_walk10: { state: 'done', progress: 10, times: 1 } }
    }));
    v5Ok = true;
  } catch (e) { v5Ok = false; }
  T('v5 存档缺字段能补齐', v5Ok);
  T('补齐的生命是满的', G.state.player().hp === 100 && G.state.player().hpMax === 100);
  T('补齐的灵性是满的', G.state.player().ess === 100 && G.state.player().essMax === 100);
  T('补齐的六项基础属性都是 5',
    ['str', 'int', 'spr', 'dex', 'luk', 'per'].every((k) => G.state.player().base[k] === 5));
  T('补齐的神性是 0', G.state.player()[G.rules.DIV_KEY] === 0);
  T('补齐的角色按默认带上初始技能',
    G.state.player().skills.length === G.rules.START_SKILLS.length);
  T('补齐的角色没有状态', G.state.player().statuses.length === 0);
  T('房间被删掉的存档能兜住', G.state.data.world.roomId === 'room_hall');
  T('任务进度照搬过来', G.quests.isDone('q_walk10') === true);

  let rejectOk = false;
  try {
    G.state.fromJSON(JSON.stringify({ v: 999 }));
  } catch (e) { rejectOk = /更新的版本/.test(e.message); }
  T('来自更高版本的存档被拒绝', rejectOk);

  /* ---------- 重开 ---------- */

  out.push('重开');
  G.main.submit('reset');
  T('不加 yes 不会真的删档', G.state.isLoaded() === true);
  G.main.submit('reset yes');
  T('reset yes 之后回到创建页', $('create-screen').hidden === false && G.state.isLoaded() === false);

  out.push('');
  out.push(failed === 0
    ? '全部通过（' + out.filter((l) => l.startsWith('  ✓')).length + ' 项）'
    : '有 ' + failed + ' 项失败');
  return out.join('\n');
})()
