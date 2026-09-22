/* 魔鱼世界 · 反向验证（故意把代码改坏，看冒烟测试拦不拦得住）
   用法：node tools/mutate.mjs

   为什么要这个脚本
   ------------------------------------------------------------------
   冒烟测试最容易出的问题是"断言写得太松，代码改坏了它照样绿"。
   所以每加一组检查，都该把对应逻辑故意改坏一次，确认失败数对得上。

   靠人手动改来改去容易漏、也容易忘。这里把几条关键规则写成一张"破坏清单"：
   改坏 → 跑冒烟 → 数变红的条数 → 立刻还原。**只读文件内容再写回，
   跑完一定还原**（哪怕是中途报错也一样，`finally` 里还原）。

   ⚠ **但被 `kill` 掉时 `finally` 不会跑。** 所以另外挂了 SIGINT / SIGTERM /
   SIGHUP 处理器，收到就先把当前那个文件还原再退出。
   这一轮就踩过一次：命令超时把脚本掐掉，`js/skills.js` 留在了改坏状态 ——
   之后所有验证都不可信，症状却只是"某条断言一直红"+"清单里那条被跳过"。
   **这个脚本要跑几分钟，别用会超时的前台命令跑**（跑后台，或者把超时调大）。

   两种判据
   ------------------------------------------------------------------
   1. **改坏代码，等冒烟变红**（默认）。数输出里 `✗` 的条数。
   2. **塞坏素材，等 validate 报错**（写了 `expect` 的）。看输出里有没有那句话。

   为什么必须有第 2 种：**校验类规则用第 1 种验不出来**。
   把 validate 里某条检查删掉，结果是"校验通过了" ——
   一个"通过"里数不出任何 `✗`，看起来像"拦住了"，其实什么也没验到。
   校验的判据只能是"坏素材必须被报出来"。

   注意
   ------------------------------------------------------------------
   - 这个脚本会**临时改写 `js/`、`data/` 与 `tools/` 下的源文件**，跑的时候别同时改代码。
   - 每条默认跑冒烟；写了 `runner: 'validate'` 的跑素材校验。
   - 每条破坏都要求能在源码里找到那个片段。找不到只警告、不算失败 ——
     代码重构之后片段可能变了，补一下清单就行，不该因此挡住别的检查。
   - 破坏点要挑**不会让流程中途抛错**的。让冒烟脚本炸在半路，
     后面的检查一条都不跑，看起来"拦住了"其实什么也没验到。
     （冒烟里的 clickArg / clickCmd / clickMove 就是为了这个：
     元素找不到时返回 false，让断言变红而不是抛错。） */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'file:///' + join(ROOT, 'index.html').replace(/\\/g, '/');

/* 每条：改哪个文件、把哪段换成哪段、想验的是哪条规则 */
const CASES = [
  {
    rule: '未接收不可执行（没接的任务不该推进进度）',
    file: 'js/quests.js',
    from: 'if (stateOf(q.id) !== ACTIVE) continue;',
    to: 'if (stateOf(q.id) !== ACTIVE && false) continue;'
  },
  {
    rule: '任务链门禁（前置没交付，下一个任务不该出现）',
    file: 'js/quests.js',
    from: 'if (!unlocked(q)) continue;',
    to: 'if (!unlocked(q) && false) continue;'
  },
  {
    rule: '可重复任务（交完该回到可接，不是锁死）',
    file: 'js/quests.js',
    from: 'if (q.repeatable) {',
    to: 'if (q.repeatable && false) {'
  },
  {
    rule: '任务的 room 限定（换个人/换个房间不该拿出同一个任务）',
    file: 'js/quests.js',
    from: 'if (q.room && q.room !== (room && room.id)) continue;',
    to: 'if (q.room && q.room !== (room && room.id) && false) continue;'
  },
  {
    rule: 'NPC 挡路（那一格该走不上去）',
    file: 'js/data.js',
    from: "if (people[x + ',' + y]) return false;",
    to: "if (people[x + ',' + y] && false) return false;"
  },

  /* ---------- 事件点 ---------- */

  {
    rule: '事件点不挡路（它那一格走得上去，跟 NPC 正好相反）',
    file: 'js/data.js',
    from: "var people = npcIdx || G.data.npcIndex(room);\n    if (people[x + ',' + y]) return false;",
    to: "var people = npcIdx || G.data.npcIndex(room);\n    if (people[x + ',' + y] || G.events.at(room, x, y)) return false;"
  },
  {
    rule: '一次性事件点用掉之后就没了',
    file: 'js/events.js',
    from: 'return !onceOf(ev) || timesOf(ev.id) === 0;',
    to: 'return true;'
  },
  {
    rule: '藏起来的事件点：触发之前只画空框',
    file: 'js/events.js',
    from: 'return !hiddenOf(ev) || timesOf(ev.id) > 0;',
    to: 'return true;'
  },
  {
    rule: '藏起来的事件点：触发过之后要能看见',
    file: 'js/events.js',
    from: 'return !hiddenOf(ev) || timesOf(ev.id) > 0;',
    to: 'return !hiddenOf(ev);'
  },
  {
    rule: '已经用掉的东西再触发不该成功',
    file: 'js/events.js',
    from: 'if (!ev || !alive(ev)) return out;',
    to: 'if (!ev) return out;'
  },
  {
    rule: '纯 onCollide 的东西，用 use 点不动',
    file: 'js/events.js',
    from: 'var list = (kind === KIND_STEP) ? ev.onCollide : ev.onUse;',
    to: 'var list = ev.onUse || ev.onCollide;'
  },
  {
    rule: '触发次数要累加（不是只记一次）',
    file: 'js/events.js',
    from: 'e.times = (Number(e.times) || 0) + 1;',
    to: 'e.times = 1;'
  },
  {
    rule: '走到事件点上就算"到了"（跟 fire 成不成功无关）',
    file: 'js/world.js',
    from: '      logReady(G.quests.reach(ev.id));',
    to: '      if (hit.ok) logReady(G.quests.reach(ev.id));'
  },

  /* ---------- 一级区 / 二级操作 ---------- */

  {
    rule: '一级区永远列着旁边所有人（说话时不该把这一块整块顶掉）',
    file: 'js/ui.js',
    from: '      html += nearHtml(npcs, talking ? talking.id : null);',
    to: "      html += talking ? '' : nearHtml(npcs, null);"
  },
  {
    rule: '正在说话的那个人在一级区要高亮',
    file: 'js/ui.js',
    from: "(npc.id === curId ? ' cur' : '')",
    to: "''"
  },
  {
    rule: '一级区不再重复报任务进度（进度只在二级操作里看）',
    file: 'js/ui.js',
    from: '      html += npcMetaHtml(npc);',
    to: '      html += npcMetaHtml(npc);\n      html += npcQuestHtml(npc, G.state.room());'
  },
  {
    rule: '二级操作闲着时要给提示（带 idle 类让提示居中）',
    file: 'js/ui.js',
    from: "    el.second.className = npc ? '' : 'idle';",
    to: "    el.second.className = '';"
  },
  {
    /* 注意这条验的不是"顺序"（grid-template-rows 只改行高、不改先后），
       而是"谁吃剩余空间" —— 二级操作的选项一多就长，得让它撑开。 */
    rule: '二级操作吃剩余空间（不是缩成一小条内容高度）',
    file: 'css/theme.css',
    from: '#rail-right { grid-template-rows: minmax(0, 1fr) minmax(0, auto); }',
    to: '#rail-right { grid-template-rows: minmax(0, auto) minmax(0, 1fr); }'
  },
  {
    /* 改这一轮时真的踩过：`#tile, #secondary dd.act button` 不是一个选择器，
       而是"裸的 #tile" + "#secondary dd.act button" 两条，
       结果 #tile 里的按钮一条样式都没上（门那个「进入这扇门」按钮的颜色和宽度一起丢）。
       冒烟里那两条量颜色、量宽度的检查就是为了拦这个。 */
    rule: '两块面板的按钮样式要真的落在两块上（选择器别写成裸 #tile）',
    file: 'css/theme.css',
    from: ':is(#tile, #secondary) dd.act button,',
    to: '#tile, #secondary dd.act button,'
  },

  /* ---------- 玩家状态（属性合成公式） ---------- */

  {
    rule: '生命惩罚第二档（≤30% 要削到 ×0.6，不是 ×0.8）',
    file: 'js/rules.js',
    from: '    if (r <= G.rules.HP_LOW) return G.rules.PENALTY_LOW;',
    to: '    if (r <= G.rules.HP_LOW) return G.rules.PENALTY_WARN;'
  },
  {
    rule: '生命惩罚按"当前值 ÷ 当前上限"判（不是拿绝对值跟 100 比）',
    file: 'js/rules.js',
    from: '    var r = G.rules.ratio(hp, hpMax);',
    to: '    var r = G.rules.ratio(hp, 100);'
  },
  {
    /* 公式：最终 = (固有 × 惩罚 + Σ状态加值) × (1 + Σ状态百分比)。
       状态和主动技能施加在惩罚**之后**，不吃削减。 */
    rule: '状态 / 主动技能的加值加在生命惩罚之后（不吃削减）',
    file: 'js/rules.js',
    from: '      var v = (own * penalty + (extra.add[k] || 0)) * (1 + (extra.pct[k] || 0) / 100);',
    to: '      var v = ((own + (extra.add[k] || 0)) * penalty) * (1 + (extra.pct[k] || 0) / 100);'
  },
  {
    /* 注意别写成 G.rules.DIV_KEY —— 要改坏的正是 G.rules 自己的定义体，
       那时候 G.rules 还不存在，会当场抛错把整个脚本带走（写这一轮时踩过）。 */
    rule: '神性参与判定但不上面板（不在 attrs 表里）',
    file: 'js/rules.js',
    from: "    { key: 'per', label: '感知' }\n  ],",
    to: "    { key: 'per', label: '感知' },\n    { key: 'div', label: '神性' }\n  ],"
  },
  {
    rule: '被动技能的加成要算进最终属性',
    file: 'js/skills.js',
    from: "    var list = byKind('passive');",
    to: '    var list = [];'
  },
  {
    rule: '状态挂上后的修正要算进最终属性',
    file: 'js/statuses.js',
    from: '      for (var j = 0; j < m.length; j++) out.push(m[j]);',
    to: '      for (var j = 0; j < 0; j++) out.push(m[j]);'
  },

  /* ---------- 玩家状态（面板） ---------- */

  {
    rule: '生命 / 灵性要显示成百分比 + 细进度条',
    file: 'js/ui.js',
    from: "           '<dd class=\"meter' + (cls ? ' ' + cls : '') + '\">' +\n" +
          "             '<span class=\"bar\"><i style=\"width:' + pct + '%\"></i></span>' +\n" +
          "             '<span class=\"pct\">' + pct + '%</span>' +\n" +
          "           '</dd>';",
    to: "           '<dd class=\"meter' + (cls ? ' ' + cls : '') + '\">' + pct + '</dd>';"
  },
  {
    rule: '状态面板要列出挂着的状态',
    file: 'js/ui.js',
    from: '  function renderBuffs() {\n    var list = G.statuses.owned();',
    to: '  function renderBuffs() {\n    var list = [];'
  },
  {
    /* 原始 bug：一个选项占一个 dd，选项一多就把面板撑出滚动条、
       最下面那个按钮被裁掉一半。选项必须全塞进同一个 dd。 */
    rule: '对话选项全塞进同一个 dd（一个选项一个 dd 会裁掉最后一个）',
    file: 'js/ui.js',
    from: "    return html + '<dd class=\"acts\">' + btns + '</dd>';",
    to: "    return html + btns.replace(/<button/g, '<dd><button').replace(/<\\/button>/g, '</button></dd>');"
  },

  /* ---------- 技能与状态 ---------- */

  {
    rule: '状态按走的步数计时（走一步剩余量减 1）',
    file: 'js/statuses.js',
    from: '      rec.left = (Number(rec.left) || 0) - 1;',
    to: '      rec.left = (Number(rec.left) || 0);'
  },
  {
    rule: '状态的 tick 是唯一能自动改生命 / 灵性的东西',
    file: 'js/statuses.js',
    from: '      var hit = applyTick(p, def.tick);',
    to: '      var hit = null;'
  },
  {
    rule: '灵性 ≤20% 自动挂「灵性枯竭」',
    file: 'js/statuses.js',
    from: '    else if (r <= ESS_LOW) want = ST_DRAINED;',
    to: '    else if (false) want = ST_DRAINED;'
  },
  {
    rule: '灵性到 0% 要把「灵性枯竭」换成「灵性耗尽」（不是一直停在枯竭）',
    file: 'js/statuses.js',
    from: '    if (r <= 0) want = ST_EXHAUSTED;',
    to: '    if (r <= 0) want = ST_DRAINED;'
  },

  /* ---------- 进门不算走一格 ---------- */

  {
    /* 这条规则以前是**隐式**的（enterDoor 从不调 move 的那些副作用）。
       补上任何一条就等于开了个漏洞：站在门上反复进出，
       能刷掉中毒、也能把走路任务刷满。两个副作用各验一条。 */
    rule: '进门不算走一格：不该推进"走路"类任务',
    file: 'js/world.js',
    from: "    G.ui.log(G.data.t('door.enter', { name: door.name }), 'sys');",
    to: "    G.ui.log(G.data.t('door.enter', { name: door.name }), 'sys');\n    logReady(G.quests.add('walk', 1));"
  },
  {
    rule: '进门不算走一格：不该递减按步计时的状态',
    file: 'js/world.js',
    from: "    G.ui.log(G.data.t('door.enter', { name: door.name }), 'sys');",
    to: "    G.ui.log(G.data.t('door.enter', { name: door.name }), 'sys');\n    tickStatuses();"
  },

  /* ---------- 技能与状态的边角 ---------- */

  {
    /* 现有素材一个 pct 都没写，公式里那两个 `(1 + Σ百分比 ÷ 100)` 因子
       以前**一次都没算过**。摘掉被动那一段的因子，力量该是 6 而不是 9。 */
    rule: '被动技能的百分比因子真的参与计算',
    file: 'js/rules.js',
    from: '      var own = (b + (passive.add[k] || 0)) * (1 + (passive.pct[k] || 0) / 100);',
    to: '      var own = (b + (passive.add[k] || 0));'
  },
  {
    rule: '状态的百分比因子真的参与计算',
    file: 'js/rules.js',
    from: '      var v = (own * penalty + (extra.add[k] || 0)) * (1 + (extra.pct[k] || 0) / 100);',
    to: '      var v = (own * penalty + (extra.add[k] || 0));'
  },
  {
    /* 两个 50% 相加是 +100%（幸运 10），逐个相乘是 +125%（11.25 → 11）。
       改坏成"乘起来"，冒烟里那条 `!== 11` 就派上用场了。 */
    rule: '同一属性的多个百分比是相加，不是逐个相乘',
    file: 'js/rules.js',
    from: '        out.pct[m.attr] = (out.pct[m.attr] || 0) + Number(m.pct);',
    to: '        out.pct[m.attr] = out.pct[m.attr]\n' +
        '          ? out.pct[m.attr] * (1 + Number(m.pct) / 100)\n' +
        '          : Number(m.pct);'
  },
  {
    rule: '同一个主动技能用第二次要如实报"续期"（refreshed）',
    file: 'js/skills.js',
    from: '    return { ok: true, skill: s, status: st, refreshed: !added };',
    to: '    return { ok: true, skill: s, status: st, refreshed: false };'
  },
  {
    rule: '学技能要挡住"不存在的技能"',
    file: 'js/skills.js',
    from: '    if (!p || !G.data.skill(id) || has(id)) return false;',
    to: '    if (!p || has(id)) return false;'
  },
  {
    rule: '学技能不能重复加已有的技能',
    file: 'js/skills.js',
    from: '    if (!p || !G.data.skill(id) || has(id)) return false;',
    to: '    if (!p || !G.data.skill(id)) return false;'
  },

  /* ---------- 属性明细（2 行 3 列 + 括号四色） ---------- */

  {
    /* 明细里的每一段都得是**惩罚后的实际贡献** —— 基础那一段也要乘上
       被动因子、生命惩罚、状态因子。少乘一个，括号里就跟总值对不上了，
       而"总和 ≈ 总值"正是玩家能自己核对的前提。 */
    rule: '属性明细按惩罚后的实际贡献拆（基础那一段也得乘上那一串因子）',
    file: 'js/rules.js',
    from: '        base: b * own,',
    to: '        base: b,'
  },
  {
    /* 片段要带上 gap —— 光写 repeat(3, 1fr) 会撞上操作区那个方向盘，
       replace 取的是第一处，改坏的就不是属性面板了。 */
    rule: '属性面板排成 2 行 3 列（排成 1 列就白改了）',
    file: 'css/theme.css',
    from: '  grid-template-columns: repeat(3, 1fr);\n  gap: 6px 5px;',
    to: '  grid-template-columns: repeat(1, 1fr);\n  gap: 6px 5px;'
  },
  {
    rule: '括号明细固定四项：基础 + 被动 + 状态 + 装备',
    file: 'js/ui.js',
    from: "                  '<i class=\"p p-gear\">'    + num(a.gear)    + '</i>' +\n",
    to: ''
  },
  {
    rule: '状态名是可点的按钮（点开弹框看效果）',
    file: 'js/ui.js',
    from: "                '<button data-cmd=\"buff\" data-arg=\"' + esc(list[i].id) + '\"' +\n",
    to: "                '<button data-arg=\"' + esc(list[i].id) + '\"' +\n"
  },
  {
    rule: '剩余量按计时方式说（manual / threshold 的 turns 是 0，不能说"还能走 0 格"）',
    file: 'js/ui.js',
    from: "    if (u === 'threshold') return G.data.t('buff.left.threshold');",
    to: "    if (false) return G.data.t('buff.left.threshold');"
  },

  /* ---------- 左栏布局（三块 / 状态并排 / 背包吃余量） ---------- */

  {
    /* 反向规则：左栏**不该**有技能块。把它加回来，那条"连壳都没有"的
       断言就该变红 —— 否则哪天有人顺手加回来，没人拦得住。 */
    rule: '左栏没有「技能」块（加回来就该被拦下）',
    file: 'index.html',
    from: '      <div class="panel" id="buff-panel">',
    to: '      <div class="panel" id="skill-panel">\n' +
        '        <h2>技能</h2>\n' +
        '        <dl id="skills"></dl>\n' +
        '      </div>\n\n' +
        '      <div class="panel" id="buff-panel">'
  },
  {
    /* 状态块得**按内容高度**。给它 1fr 就变成"吃剩余空间"，
       挂再多状态它的高度也不动 —— "状态挂多了跟着长高"那条该变红。 */
    rule: '状态块按内容高度（给它 1fr 就变成吃剩余空间了）',
    file: 'css/theme.css',
    from: '    minmax(0, auto)   /* 状态（按内容高度，标签并排） */\n' +
          '    minmax(0, 1fr);   /* 玩家背包（预留）← 吃掉剩余空间 */',
    to: '    minmax(0, 1fr)    /* 状态（按内容高度，标签并排） */\n' +
        '    minmax(0, auto);  /* 玩家背包（预留）← 吃掉剩余空间 */'
  },
  {
    rule: '背包吃左栏剩余空间（改成 auto 就没有余量可吃了）',
    file: 'css/theme.css',
    from: '    minmax(0, 1fr);   /* 玩家背包（预留）← 吃掉剩余空间 */',
    to: '    minmax(0, auto);  /* 玩家背包（预留）← 吃掉剩余空间 */'
  },
  {
    /* 状态要**并排成标签**。改回单列 grid，一个状态就独占一行，
       "两个状态排在同一行"那条该变红。 */
    rule: '状态并排成标签（改回单列就变成一行一个）',
    file: 'css/theme.css',
    from: '  display: flex;\n  flex-wrap: wrap;\n  align-content: flex-start;\n  gap: 4px 6px;',
    to: '  display: grid;\n  grid-template-columns: 1fr;\n  align-content: start;\n  gap: 4px 6px;'
  },
  {
    /* 改的是**标签（dd）**那一层，不是按钮 —— 按钮上加 `width: 100%`
       在"宽度由内容决定的 flex item"里是空操作，改坏了也不会红
       （反向验证时逮住的：这条破坏点原本是假阳性）。
       能把标签拉满整行的只有 dd 自己。 */
    rule: '单个状态的标签按自己的文字占宽（铺满整行就白并排了）',
    file: 'css/theme.css',
    from: ':is(#buffs, #bag) dd { margin: 0; color: var(--fg); }',
    to: ':is(#buffs, #bag) dd { margin: 0; width: 100%; color: var(--fg); }'
  },

  /* ---------- 弹框（释放法术 / 技艺 / 状态详情） ---------- */

  {
    rule: 'cast 不带参数要弹出法术列表（点按钮走的是这条路）',
    file: 'js/main.js',
    from: "      G.ui.openModal('spells');",
    to: '      return;'
  },
  {
    rule: '法术列表只列主动法术（被动技能没有"用一下"这个动作）',
    file: 'js/ui.js',
    from: '    var list = G.skills ? G.skills.active() : [];',
    to: '    var list = G.skills ? G.skills.owned() : [];'
  },
  {
    rule: '技艺总览要把主动和被动都列出来',
    file: 'js/ui.js',
    from: '    var list = G.skills ? G.skills.owned() : [];',
    to: '    var list = G.skills ? G.skills.active() : [];'
  },
  {
    rule: '列表里的「释放」按钮要带上技能 id（不带就变成又开一次列表）',
    file: 'js/ui.js',
    from: "      html += '<div class=\"m-act\"><button data-cmd=\"cast\" data-arg=\"' + esc(s.id) + '\">' +",
    to: "      html += '<div class=\"m-act\"><button data-cmd=\"cast\">' +"
  },
  {
    rule: '弹框开着时键盘不给游戏用（方向键不能把角色走丢）',
    file: 'js/main.js',
    from: '    if (G.ui.modalOpen()) {',
    to: '    if (false) {'
  },
  {
    rule: '点遮罩 / 点「关闭」都要能关掉弹框',
    file: 'js/main.js',
    from: "      if (e.target.closest('[data-modal=\"close\"]')) { G.ui.closeModal(); return; }\n",
    to: ''
  },

  /* ---------- 事件点的数值效果 ---------- */

  {
    /* set 的解析在**效果执行器**里（唯一认识效果键的地方），
       不事件点模块 —— 第 22 轮把那段从 js/events.js 挪过去了。
       改坏它 = applyEffect 收不到东西，set 效果静默失效。 */
    rule: '事件点里的 set 要真的被解析到（照调 applyEffect）',
    file: 'js/effects.js',
    from: '      if (ef.set) {',
    to: '      if (false) {'
  },
  {
    /* 这一类跟上面全都不同，值得单独说清楚：

       **改坏的不是校验逻辑，而是素材。** 塞一条 `player.gold`（v5 已删的字段）
       进事件点，期望的是 **validate 报出这个错**。

       为什么不能照搬"改坏校验逻辑、等冒烟变红"：把白名单那条判断去掉之后，
       validate 反而**通过了** —— 一个"通过"里看不出任何红，
       数 ✗ 的条数永远是 0。**校验类规则的判据是"坏素材必须被报出来"，
       不是"好素材跑得通"。** 所以这一类看 `expect` 里那句话在不在输出里。

       为什么要锁它：`player.gold` 这种键**格式完全合法**，applyEffect 又是空壳，
       于是这条效果永远静默失效、界面上一点都看不出来 —— 曾经真的这么溜进去过。 */
    rule: 'set 的键写已删字段，validate 要拦下来',
    file: 'data/events.js',
    from: '      { "log": "你把铜钱抠了出来，吹掉灰，塞进兜里。", "cls": "ok" }',
    to: '      { "log": "你把铜钱抠了出来，吹掉灰，塞进兜里。", "cls": "ok" },\n' +
        '      { "set": { "player.gold": "+1" } }',
    runner: 'validate',
    expect: 'player.gold'
  },

  /* ---------- 物品与背包 ---------- */

  {
    rule: 'take 取到没有为止，记录归零要删掉（不留 count: 0 的空壳）',
    file: 'js/items.js',
    from: '    if (left > 0) b[id] = { count: left };\n    else delete b[id];',
    to: '    b[id] = { count: left };'
  },
  {
    rule: '唯一物品（stack: false）恒为 1：已经有了再给等于没给',
    file: 'js/items.js',
    from: '      if (cur > 0) return 0;',
    to: '      if (false) return 0;'
  },
  {
    rule: '货币扣到 0 为止（不能变成负数，返回的是实际变化量）',
    file: 'js/items.js',
    from: '    if (v < 0) v = 0;',
    to: '    if (false) v = 0;'
  },
  {
    rule: '背包标签的颜色来自分类表（不是写死在 CSS 里）',
    file: 'css/theme.css',
    from: '#bag dd.item { color: var(--item-color, var(--fg)); }',
    to: '#bag dd.item { color: var(--fg); }'
  },
  {
    /* 唯一物品已经有了再给，素材那句"你捡起钱袋"照写、背包里却什么都没多 ——
       这就是静默失效。必须补一句提示。 */
    rule: '给不出去的时候要补一句提示（别静默失效）',
    file: 'js/effects.js',
    from: '      if (sign > 0 && moved === 0) {',
    to: '      if (false) {'
  },
  {
    rule: '「使用」物品要扣掉一个（素材不用写"用一次少一个"）',
    file: 'js/effects.js',
    from: '    var r = run(def.use);\n    G.items.take(id, 1);',
    to: '    var r = run(def.use);'
  },
  {
    rule: 'renderBag 要从 refresh 里调（摘掉就永远不画背包）',
    file: 'js/ui.js',
    from: '    renderBuffs();\n    renderBag();',
    to: '    renderBuffs();'
  },
  {
    rule: '物品详情里**没有**丢弃按钮（不是画出来点了没反应）',
    file: 'js/ui.js',
    from: "+ esc(label) + '</button></div>';",
    to: "+ esc(label) + '</button>丢弃</div>';"
  },
  {
    rule: '钱包一种钱都没有时要说一句（不是画一排 0）',
    file: 'js/ui.js',
    from: '    if (!any) {',
    to: '    if (false) {'
  },
  {
    rule: '笔记本的「已完成」看 times（交过几次差），不是 state === done',
    file: 'js/ui.js',
    from: '      if (G.quests.times(q.id) > 0) done.push(q);',
    to: '      if (G.quests.isDone(q.id)) done.push(q);'
  },
  {
    /* panel 型的物品（钱袋 / 笔记本）走的是"开面板"那条路，不是"跑效果"。
       写反了的话 `bag use 钱袋` 会说"没什么能用的"，钱包永远打不开。 */
    rule: '物品的 panel 按钮要真的开面板（不是走"使用"那条路）',
    file: 'js/main.js',
    from: '    if (def.panel) {',
    to: '    if (false) {'
  },

  /* ---------- 收集任务与奖励 ---------- */

  {
    /* 累计的话"捡到 3 个 -> 用掉 1 个"之后进度还停在 3 / 3，
       玩家以为能交差，交付时才发现不够。 */
    rule: 'collect 的进度是现算的（不是读存档里那个累计值）',
    file: 'js/quests.js',
    from: "    if (goal.type === 'collect') return G.items.count(goal.item);",
    to: "    if (goal.type === 'collect') {\n      var ce = entry(id);\n      return ce ? (Number(ce.progress) || 0) : 0;\n    }"
  },
  {
    rule: 'collect 交付时要按 goal.count 扣掉物品',
    file: 'js/quests.js',
    from: '      G.items.take(goal.item, goal.count);',
    to: '      ;'
  },
  {
    rule: '任务奖励要真的发出去',
    file: 'js/quests.js',
    from: '    return { ok: true, events: grantReward(q) };',
    to: '    return { ok: true, events: [] };'
  },
  {
    /* 可重复任务交付后 state 立刻回到 available，永远到不了 done ——
       按 done 判的话，requires 指向一个可重复任务就永远不满足。 */
    rule: '前置的判据是 times > 0（交过差），不是 state === done',
    file: 'js/quests.js',
    from: '    return timesOf(q.requires) > 0;',
    to: '    return isDone(q.requires);'
  },

  /* ---------- 塞坏物品 / 效果素材，等 validate 报错 ---------- */

  {
    rule: 'use 和 panel 不能同时写（一个物品只该有一个动作），validate 要拦下来',
    file: 'data/items.js',
    from: '    "stack": false,\n    "panel": "wallet"',
    to: '    "stack": false,\n    "panel": "wallet",\n    "use": [ { "log": "x" } ]',
    runner: 'validate',
    expect: 'use 和 panel 不能同时写'
  },
  {
    rule: 'give 指向不存在的物品，validate 要拦下来',
    file: 'data/events.js',
    from: '      { "give": { "itm_purse": 1 } },',
    to: '      { "give": { "itm_nope": 1 } },',
    runner: 'validate',
    expect: 'itm_nope'
  },
  {
    rule: 'money 的值必须是带符号的字符串（写数字要拦下来）',
    file: 'data/events.js',
    from: '      { "money": { "coin": "+12" } }',
    to: '      { "money": { "coin": 12 } }',
    runner: 'validate',
    expect: '必须是带符号的数字字符串'
  },
  {
    rule: '唯一物品写了数量 2，validate 要拦下来（给了也拿不到第二个）',
    file: 'data/events.js',
    from: '      { "give": { "itm_purse": 1 } },',
    to: '      { "give": { "itm_purse": 2 } },',
    runner: 'validate',
    expect: '拿不到第二个'
  }
];

let broken = 0;

/* 正在改坏的那个文件（跑完就清掉）。
   **被 SIGTERM / SIGINT 杀掉时 `finally` 根本不会跑** —— 这一轮就踩过：
   命令超时把脚本掐掉，`js/skills.js` 留在了改坏状态，之后所有验证结果
   都不可信，而且很难看出来（症状是"某条断言一直红" + "清单里那条被跳过"）。
   所以挂上信号处理器：收到就先还原，再退出。 */
let pending = null;

function restorePending() {
  if (!pending) return null;
  const p = pending;
  writeFileSync(p.path, p.src, 'utf8');
  pending = null;
  return p;
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => {
    const p = restorePending();
    console.log('\n⚠ 收到 ' + sig + '，' +
                (p ? '已还原 ' + p.file : '没有待还原的文件'));
    process.exit(130);
  });
});

for (const c of CASES) {
  const path = join(ROOT, c.file);
  const src = readFileSync(path, 'utf8');

  if (src.indexOf(c.from) < 0) {
    console.log('\n⚠ 跳过：' + c.rule);
    console.log('   ' + c.file + ' 里找不到要改坏的片段。两种可能：');
    console.log('     1. 代码重构过，片段变了 —— 更新清单里的 from；');
    console.log('     2. **上一次跑被中途杀掉，这个文件还停在改坏的状态** ——');
    console.log('        先确认文件是好的（validate + 冒烟能过），再重跑这一条。');
    broken++;
    continue;
  }

  pending = { path: path, src: src, file: c.file };
  writeFileSync(path, src.replace(c.from, c.to), 'utf8');

  /* 默认跑冒烟；标了 runner: 'validate' 的跑素材校验 ——
     两条流水线都可能有该锁住的规则，不该只锁一半。 */
  const cmd = c.runner === 'validate'
    ? 'node tools/validate.mjs'
    : 'node tools/probe.mjs "' + URL + '" tools/smoke.js';

  let out = '';
  try {
    out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  } finally {
    restorePending();   /* 无论成败都还原 */
  }

  const reds = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('✗'));
  const crashed = reds.some((l) => l.indexOf('求值抛错') >= 0);

  console.log('\n改坏：' + c.rule);

  /* 第二类：塞一份**坏素材**，期望 runner **报出这个错**（见 CASES 末尾那条）。
     这类不看 ✗ 的条数 —— 坏的是素材不是校验逻辑，输出里没有"变红"这回事。 */
  if (c.expect) {
    if (out.indexOf(c.expect) >= 0) {
      const line = out.split('\n').find((l) => l.indexOf(c.expect) >= 0) || '';
      console.log('   ✓ 报出来了：' + line.trim().slice(0, 120));
    } else {
      console.log('   ✗ 没报出来 —— 这份坏素材溜过去了，校验漏了一处');
      broken++;
    }
    continue;
  }

  if (!reds.length) {
    console.log('   ✗ 没有任何断言变红 —— 这条规则没被测试拦住');
    broken++;
  } else if (crashed) {
    console.log('   ⚠ 拦住了，但脚本是抛错中断的（后面的检查没跑到）：');
    console.log('     ' + reds[0]);
    console.log('   变红 ' + reds.length + ' 条');
    broken++;
  } else {
    for (const l of reds.slice(0, 5)) console.log('   ' + l);
    if (reds.length > 5) console.log('   …… 还有 ' + (reds.length - 5) + ' 条');
    console.log('   ✓ 拦住了，变红 ' + reds.length + ' 条');
  }
}

console.log('\n' + (broken === 0
  ? '全部拦住了（' + CASES.length + ' 条）。'
  : '有 ' + broken + ' 条没拦住，回去补断言或补清单。'));
process.exit(broken === 0 ? 0 : 1);
