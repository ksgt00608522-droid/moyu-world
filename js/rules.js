/* 魔鱼世界 · 数值与规则
   全局：G.rules

   所有公式只写在这里。调平衡只改这个文件，不要散到别处。
   数值本身（基础属性、技能与状态的修正项）放在 data/，不写死在代码里。

   玩家没有等级。属性只有一条链路：

     基础值 → 叠加被动技能 → 乘生命惩罚 → 叠加状态 → 最终值

   见 docs/设定/04-数值与成长.md。 */

var G = window.G || (window.G = {});

G.rules = {

  NAME_MAX: 12,

  /* ---------- 属性表 ---------- */

  /* 六项基础属性。**面板按这个顺序显示**，加属性只改这里。
     神性（div）不在表里 —— 它参与判定但不上面板，见 DIV_KEY。 */
  attrs: [
    { key: 'str', label: '力量' },
    { key: 'int', label: '智力' },
    { key: 'spr', label: '精神' },
    { key: 'dex', label: '灵巧' },
    { key: 'luk', label: '幸运' },
    { key: 'per', label: '感知' }
  ],

  /* 六项基础属性的初始值 */
  ATTR_BASE: 5,

  /* 特殊属性：神性。**面板上不显示**，只供判定读写。
     它不在 attrs 里，所以遍历 attrs 的地方（面板、校验）都碰不到它。 */
  DIV_KEY: 'div',

  /* 生命与灵性：初始值 = 初始上限，都是百分比（0–100）。
     上限以后可以被技能或状态抬高，所以是独立字段。 */
  HP_START: 100,
  ESS_START: 100,

  /* 新建角色自带哪些技能。还没有获取途径（掉落 / 任务 / 学习都没做），
     先直接给两个示例，把"修正项 → 最终属性"这条链跑通。 */
  START_SKILLS: ['skl_ironbone', 'skl_focus'],

  /* ---------- 生命惩罚 ---------- */

  /* 生命掉到多少以下开始削属性。按"当前值 ÷ 当前上限"判，
     **取最严重的一档**，不叠加（生命 25% 只按 ×0.6 算）。 */
  HP_LOW: 0.30,       /* ≤ 30% → ×0.6 */
  HP_WARN: 0.60,      /* ≤ 60% → ×0.8 */
  PENALTY_LOW: 0.6,
  PENALTY_WARN: 0.8,

  hpPenalty: function (hp, hpMax) {
    var r = G.rules.ratio(hp, hpMax);
    if (r <= G.rules.HP_LOW) return G.rules.PENALTY_LOW;
    if (r <= G.rules.HP_WARN) return G.rules.PENALTY_WARN;
    return 1;
  },

  /* 值 ÷ 上限，夹在 0–1。上限是 0 或不是数字时返回 0 ——
     宁可显示 0% 也不要让 NaN 漏进面板。 */
  ratio: function (v, max) {
    var m = Number(max);
    if (!isFinite(m) || m <= 0) return 0;
    var r = Number(v) / m;
    if (!isFinite(r)) return 0;
    if (r < 0) return 0;
    if (r > 1) return 1;
    return r;
  },

  /* ---------- 修正项 ---------- */

  /* 把一串修正项按属性汇总，返回 { add: { str: 2 }, pct: { str: 20 } }。
     **同一属性的多个加值先相加、多个百分比也先相加**，不是逐个相乘 ——
     见 docs/设定/04-数值与成长.md 的三条要点。 */
  collectMods: function (list) {
    var out = { add: {}, pct: {} };
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || !m.attr) continue;
      if (m.add != null) {
        out.add[m.attr] = (out.add[m.attr] || 0) + Number(m.add);
      }
      if (m.pct != null) {
        out.pct[m.attr] = (out.pct[m.attr] || 0) + Number(m.pct);
      }
    }
    return out;
  },

  /* ---------- 最终属性 ---------- */

  /* 算一遍六项属性的最终值，返回 { str: 6, int: 7, ... }（已四舍五入取整）。

       固有 = (基础 + Σ被动加值) × (1 + Σ被动百分比 ÷ 100)
       最终 = (固有 × 生命惩罚 + Σ状态加值) × (1 + Σ状态百分比 ÷ 100)

     受惩罚的只有"角色固有"那一块（基础属性 + 被动技能）；
     主动技能和状态在惩罚之后施加，不吃惩罚。

     **最终值不存进存档**，每次现算 —— 存档里就不会出现
     "改了技能忘了同步属性"这种不一致。 */
  finalAttrs: function () {
    var p = G.state.player();
    var out = {};
    if (!p) return out;

    var passive = G.rules.collectMods(G.skills ? G.skills.passiveMods() : null);
    var extra = G.rules.collectMods(G.statuses ? G.statuses.mods() : null);
    var penalty = G.rules.hpPenalty(p.hp, p.hpMax);
    var base = p.base || {};
    var list = G.rules.attrs;

    for (var i = 0; i < list.length; i++) {
      var k = list[i].key;
      var b = Number(base[k]);
      if (!isFinite(b)) b = 0;

      var own = (b + (passive.add[k] || 0)) * (1 + (passive.pct[k] || 0) / 100);
      var v = (own * penalty + (extra.add[k] || 0)) * (1 + (extra.pct[k] || 0) / 100);
      out[k] = Math.round(v);
    }
    return out;
  },

  /* 单项最终值。偶尔查一个用这个，一次要全部就用 finalAttrs()。 */
  attr: function (key) {
    return G.rules.finalAttrs()[key];
  },

  /* 把每项属性拆成 基础 / 被动 / 状态 / 装备 四段**惩罚后的实际贡献**，
     给面板的括号明细用。返回 { str: { base, passive, status, gear, total }, ... }。

     为什么能精确拆开：整个式子对每一项都是**乘法**的 ——
       固有 = (基础 + Σ被动加值) × 被动因子
       最终 = (固有 × 惩罚 + Σ状态加值) × 状态因子
     展开就是
       基础贡献 = 基础   × 被动因子 × 惩罚 × 状态因子
       被动贡献 = Σ被动加值 × 被动因子 × 惩罚 × 状态因子
       状态贡献 = Σ状态加值 × 状态因子
       装备贡献 = 0（**还没有装备系统**，位置先留着）
     四段相加 = 最终值，一点不差（浮点末位可能差一点点，显示上取一位小数看不出来）。

     **主动技能没有单独一项** —— 它是靠挂状态生效的，贡献算在「状态」里。
     见 docs/设定/04-数值与成长.md 的「面板怎么显示属性」。

     `total` 走的是跟 finalAttrs **同一个表达式**，不是把四段加起来 ——
     这样两个函数永远不会因为浮点结合律差出 1 点。 */
  attrParts: function () {
    var p = G.state.player();
    var out = {};
    if (!p) return out;

    var passive = G.rules.collectMods(G.skills ? G.skills.passiveMods() : null);
    var extra = G.rules.collectMods(G.statuses ? G.statuses.mods() : null);
    var penalty = G.rules.hpPenalty(p.hp, p.hpMax);
    var base = p.base || {};
    var list = G.rules.attrs;

    for (var i = 0; i < list.length; i++) {
      var k = list[i].key;
      var b = Number(base[k]);
      if (!isFinite(b)) b = 0;

      var pAdd = Number(passive.add[k]) || 0;
      var pF = 1 + (Number(passive.pct[k]) || 0) / 100;
      var sAdd = Number(extra.add[k]) || 0;
      var sF = 1 + (Number(extra.pct[k]) || 0) / 100;

      /* 基础 / 被动 共用的那一串因子 */
      var own = pF * penalty * sF;

      out[k] = {
        base: b * own,
        passive: pAdd * own,
        status: sAdd * sF,
        gear: 0,
        total: Math.round(((b + pAdd) * pF * penalty + sAdd) * sF)
      };
    }
    return out;
  },

  /* ---------- 建角色 ---------- */

  /* 建一个全新角色。**没有等级、没有经验、没有金币** ——
     见 docs/设定/04-数值与成长.md 的「已废弃」。 */
  newPlayer: function (name) {
    var base = {};
    for (var i = 0; i < G.rules.attrs.length; i++) {
      base[G.rules.attrs[i].key] = G.rules.ATTR_BASE;
    }

    var p = {
      name: String(name || '无名氏'),
      hp: G.rules.HP_START, hpMax: G.rules.HP_START,
      ess: G.rules.ESS_START, essMax: G.rules.ESS_START,
      base: base,
      skills: G.rules.START_SKILLS.slice(),
      statuses: []
    };
    p[G.rules.DIV_KEY] = 0;
    return p;
  },

  /* ---------- NPC 态度 ---------- */

  ATTITUDE_MIN: 0,
  ATTITUDE_MAX: 100,

  /* 态度分 → 阶段。阶段表在 data/npcs.js，按 min 升序排列。
     分数先夹到 0–100：素材写超了不报错，按边界算。
     表是空的时候返回一个空阶段，免得调用方拿到 undefined 炸掉。 */
  attitudeStage: function (n) {
    var list = G.data.attitudeStages || [];
    if (!list.length) return { min: 0, name: '', color: '' };

    var v = Math.floor(Number(n));
    if (!isFinite(v)) v = G.rules.ATTITUDE_MIN;
    if (v < G.rules.ATTITUDE_MIN) v = G.rules.ATTITUDE_MIN;
    if (v > G.rules.ATTITUDE_MAX) v = G.rules.ATTITUDE_MAX;

    var out = list[0];
    for (var i = 0; i < list.length; i++) {
      if (v >= list[i].min) out = list[i];
    }
    return out;
  },

  /* ---------- 效果 ---------- */

  /* 数值效果的执行体。key 是点号路径（"player.hp"），delta 是**带符号的
     字符串**（"+1" / "-5"）。

     ⚠️ **现在这个函数还是空的，什么都不做。**

     生命和灵性已经有了（见 docs/设定/04-数值与成长.md），
     但**死亡怎么处理还没定**（99-待定问题.md 的 A 组）。
     现在就让它扣血，等于替玩家把那个板拍了 —— 扣到 0 之后怎么办，谁也说不清。

     所以事件点素材里照写 `"player.hp": "-5"`，照常解析、照常调这里，
     数值就是不改。**唯一能自动改生命 / 灵性的东西是状态的 tick**，
     那条路是专门做出来验证状态管线的，范围卡得很死（见 06-物品与技能.md）。

     等 A 组拍板，只改这一个函数，素材一行都不用动。
     在那之前别把它删掉 —— 删了以后加回来时，素材里写错的键就没人拦了
     （格式校验在 tools/validate.mjs 里，跟这个函数是两回事）。

     返回 false 表示"没有执行"。以后真做了，返回 true。 */
  applyEffect: function (key, delta) {
    return false;
  },

  /* 校验角色名，通过返回 null，不通过返回提示文字 */
  checkName: function (name) {
    var n = String(name == null ? '' : name).trim();
    if (!n) return '名字不能为空。';
    if (n.length > G.rules.NAME_MAX) {
      return '名字最多 ' + G.rules.NAME_MAX + ' 个字。';
    }
    return null;
  }

};
