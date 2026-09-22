/* 魔鱼世界 · 素材校验
   用法：node tools/validate.mjs

   做六件事：
     1. 剥掉 G.data.x = / G.data.x.push(...) 外壳后按**严格 JSON** 解析
        （防止写出注释、尾逗号、单引号）
     2. 检查字段齐全、id 唯一、门的目标房间存在、门能来回
     3. 检查区域归属：每个房间必须属于一个存在的区域，区域中心必须是本区域的房间
     4. 检查 NPC 与任务：类型 / 任务引用必须存在，位置必须站得住
     5. 检查技能与状态：id 前缀、修正项的 attr 落在属性表里、
        主动技能的 applies 指向真实状态、tick 的 key 与 unit 配得上
     6. 检查物品与币种：id 前缀、分类存在、use / panel 不打架，
        以及**效果与任务奖励里引用的物品 / 币种真的存在**

   这一步存在的意义：AI 批量生成素材时最容易犯的错是字段名漂移和 id 拼错，
   校验脚本能挡掉绝大部分"运行到一半才炸"的情况。

   房间素材是**一个区域一个文件**（data/rooms/*.js），这里扫描整个目录，
   不写死文件名 —— 新开一个区域文件不用回来改这个脚本。 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const ROOMS_DIR = join(DATA, 'rooms');

/* 任务目标支持的类型。加新类型时同步改 js/quests.js 与 data/quests.js。
   reach / use 是"指定事件点"的目标，必须写 goal.ev —— 见下面 EV_GOAL_TYPES。
   collect 是"收集物品"的目标，必须写 goal.item —— 见 ITEM_GOAL_TYPES。 */
const GOAL_TYPES = ['walk', 'reach', 'use', 'collect'];
const EV_GOAL_TYPES = ['reach', 'use'];
const ITEM_GOAL_TYPES = ['collect'];

const errors = [];
const fail = (file, m) => errors.push(`${file}：${m}`);

/* ---------- 读取与解析 ---------- */

/* 从 text[i]（必须是 [ { ( 之一）开始，扫到配对的那个符号。

   不能简单找"最后一个右括号" —— 注释里出现一个括号就会切歪。
   这里扫一遍括号配平，顺便跳过字符串里的括号。

   返回 { inner, end }：inner 是括号**里面**的内容，end 是配对符号的下标。 */
function scanBalanced(text, i) {
  const open = text[i];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`不认识的起始符号 "${open}"`);

  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return { inner: text.slice(i + 1, j), end: j };
    }
  }
  throw new Error(`从 "${open}" 开始的括号没闭合`);
}

/* 把 `G.data.x = <值>;` 里的**整个值**（含最外层的方括号或花括号）切出来。

   两个坑：
   1. 必须用正则要求"标记后面紧跟等号"。先找标记再找下一个等号的话，
      会被文件头注释里的等号骗到，报出来的错完全对不上真正的问题。
   2. 不能切到文件尾。一个文件里可以放好几个数据块
      （data/npcs.js 就有类型表、态度表、NPC 表三块），
      切到文件尾会把后面几块一起吞进来，JSON.parse 直接报
      "Unexpected non-whitespace character after JSON"。 */
function sliceValue(text, name) {
  const re = new RegExp(`G\\.data\\.${name}\\s*=`);
  const m = re.exec(text);
  if (!m) throw new Error(`找不到 G.data.${name} = ...`);

  let i = m.index + m[0].length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) throw new Error(`G.data.${name} = 后面什么都没有`);

  const r = scanBalanced(text, i);
  return text.slice(i, r.end + 1);
}

/* 把 `marker(...)` 括号**里面**的内容切出来 */
function sliceCall(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`找不到 ${marker}(...)`);
  const open = text.indexOf('(', at + marker.length);
  if (open < 0) throw new Error(`${marker} 后面没有左括号`);
  return scanBalanced(text, open).inner;
}

async function readUtf8(file, rel) {
  const text = await readFile(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) fail(rel, '带 BOM，请存成 UTF-8 无 BOM');
  return text;
}

function parseJson(body, rel) {
  try {
    return JSON.parse(body);
  } catch (e) {
    fail(rel, `不是严格 JSON（${e.message}）。检查有没有注释、尾逗号或单引号`);
    return null;
  }
}

/* 读一个 data/*.js 里 `G.data.<name> = ...` 那份数据。
   读不到或解析失败返回 null（问题已经记进 errors 了）。 */
async function loadTop(rel, name) {
  let text;
  try { text = await readUtf8(join(DATA, rel), rel); }
  catch { fail(rel, '读不到文件'); return null; }
  let body;
  try { body = sliceValue(text, name); }
  catch (e) { fail(rel, e.message); return null; }
  return parseJson(body, rel);
}

/* 读一个用 `G.data.<name>.push(a, b, c)` 写的 data/*.js，返回**拍平后的数组**。
   房间素材就是这么写的（一个区域一个文件、文件里追加好几条），
   技能表和状态表也一样 —— 一个文件装一整张表。

   两个坑：
   1. push(a, b, c) 是**多个参数不是数组**，按 JSON 解析前要自己补一对方括号。
      顺手也容忍 push([a, b, c]) 这种写法，不至于因为多写了一对方括号就报错。
   2. 切 push(...) 的括号范围不能取最后一个右括号 —— 注释里出现括号就会切歪，
      sliceCall 里是扫一遍括号配平。 */
async function loadPushed(rel, name) {
  let text;
  try { text = await readUtf8(join(DATA, rel), rel); }
  catch { fail(rel, '读不到文件'); return null; }

  let body;
  try { body = sliceCall(text, `G.data.${name}.push`); }
  catch (e) { fail(rel, e.message); return null; }

  const t = body.trim();
  const list = parseJson(t.startsWith('[') ? t : `[${t}]`, rel);
  if (list === null) return null;
  if (!Array.isArray(list)) { fail(rel, 'push(...) 里必须是一个数组'); return null; }
  return list;
}

/* ---------- 通用小工具 ---------- */

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isInt = (v) => Number.isInteger(v);
const isPos = (v) => isInt(v) && v >= 0;
const isPercent = (v) => isInt(v) && v >= 0 && v <= 100;

function inBounds(room, x, y) {
  return isPos(y) && y < room.tiles.length &&
         isPos(x) && x < room.tiles[y].length;
}

function walkable(room, x, y) {
  if (!inBounds(room, x, y)) return false;
  if (room.doors && room.doors[`${x},${y}`]) return true;
  return room.tiles[y][x] !== '#';
}

/* ---------- 校验 strings ---------- */

const strings = await loadTop('strings.js', 'strings');
if (strings) {
  if (typeof strings !== 'object' || Array.isArray(strings)) {
    fail('strings.js', '顶层必须是一个对象');
  } else {
    for (const [k, v] of Object.entries(strings)) {
      if (typeof v !== 'string') fail('strings.js', `"${k}" 的值不是字符串`);
    }
    if (Object.keys(strings).length === 0) fail('strings.js', '一条文案都没有');
  }
}

/* ---------- 校验 areas ---------- */

const areas = await loadTop('areas.js', 'areas');
const areaById = new Map();

if (areas) {
  if (!Array.isArray(areas)) {
    fail('areas.js', '顶层必须是一个数组');
  } else {
    for (const a of areas) {
      const tag = (a && a.id) || '(没有 id 的区域)';
      if (!a || typeof a !== 'object') { fail('areas.js', '区域不是一个对象'); continue; }

      if (!isStr(a.id)) fail('areas.js', `${tag}：id 必须是非空字符串`);
      else if (!/^[a-z][a-z0-9_]*$/.test(a.id)) {
        fail('areas.js', `${tag}：id 建议用小写字母数字下划线（不要 room_ 前缀）`);
      } else if (areaById.has(a.id)) fail('areas.js', `${tag}：id 重复`);
      else areaById.set(a.id, a);

      if (!isStr(a.name)) fail('areas.js', `${tag}：缺 name`);
      if (!isStr(a.center)) fail('areas.js', `${tag}：缺 center（区域中心房间 id）`);
      if (a.parent != null && !isStr(a.parent)) fail('areas.js', `${tag}：parent 必须是字符串`);
    }

    if (areaById.size === 0) fail('areas.js', '一个区域都没有');

    /* 区域之间的关系要等索引建好才能查 */
    for (const a of areas) {
      if (!a || !isStr(a.id)) continue;
      if (a.parent == null) continue;
      if (a.parent === a.id) fail('areas.js', `${a.id}：parent 不能是自己`);
      else if (!areaById.has(a.parent)) fail('areas.js', `${a.id}：parent "${a.parent}" 不存在`);
    }
  }
}

/* ---------- 校验 npcTypes（NPC 类型表） ---------- */

const npcTypes = await loadTop('npcs.js', 'npcTypes');
const typeById = new Map();

if (npcTypes) {
  if (!Array.isArray(npcTypes)) {
    fail('npcs.js', 'G.data.npcTypes 顶层必须是一个数组');
  } else {
    for (const t of npcTypes) {
      const tag = (t && t.id) || '(没有 id 的类型)';
      if (!t || typeof t !== 'object') { fail('npcs.js', '类型不是一个对象'); continue; }

      if (!isStr(t.id)) fail('npcs.js', `${tag}：id 必须是非空字符串`);
      else if (typeById.has(t.id)) fail('npcs.js', `${tag}：id 重复`);
      else typeById.set(t.id, t);

      if (!isStr(t.name)) fail('npcs.js', `${tag}：缺 name`);
      if (!isStr(t.color)) fail('npcs.js', `${tag}：缺 color（地图上那个字的颜色）`);
    }
    if (typeById.size === 0) fail('npcs.js', 'npcTypes 一条都没有');
  }
}

/* ---------- 校验 attitudeStages（态度阶段表） ---------- */

const attitudeStages = await loadTop('npcs.js', 'attitudeStages');

if (attitudeStages) {
  if (!Array.isArray(attitudeStages)) {
    fail('npcs.js', 'G.data.attitudeStages 顶层必须是一个数组');
  } else if (attitudeStages.length === 0) {
    fail('npcs.js', 'attitudeStages 一条都没有');
  } else {
    let prev = -1;
    for (let i = 0; i < attitudeStages.length; i++) {
      const s = attitudeStages[i];
      const tag = `attitudeStages[${i}]`;
      if (!s || typeof s !== 'object') { fail('npcs.js', `${tag}：不是一个对象`); continue; }

      if (!isPercent(s.min)) {
        fail('npcs.js', `${tag}：min 必须是 0–100 的整数，现在是 ${JSON.stringify(s.min)}`);
      } else {
        if (i === 0 && s.min !== 0) {
          fail('npcs.js', 'attitudeStages 第一项的 min 必须是 0，否则低分没有阶段可落');
        }
        if (s.min <= prev) {
          fail('npcs.js', `${tag}：min 必须严格升序（上一项 ${prev}，这一项 ${s.min}）`);
        }
        prev = s.min;
      }

      if (!isStr(s.name)) fail('npcs.js', `${tag}：缺 name`);
      if (!isStr(s.color)) fail('npcs.js', `${tag}：缺 color`);
    }
  }
}

/* ---------- 校验 items.js（分类表 / 币种表 / 物品表） ----------
   一个文件里三块数据，跟 npcs.js 一样，三块都得按配对括号切。 */

const itemKinds = await loadTop('items.js', 'itemKinds');
const kindById = new Map();

if (itemKinds) {
  if (!Array.isArray(itemKinds)) {
    fail('items.js', 'G.data.itemKinds 顶层必须是一个数组');
  } else {
    for (const k of itemKinds) {
      const tag = (k && k.id) || '(没有 id 的分类)';
      if (!k || typeof k !== 'object') { fail('items.js', '分类不是一个对象'); continue; }

      if (!isStr(k.id)) fail('items.js', `${tag}：id 必须是非空字符串`);
      else if (kindById.has(k.id)) fail('items.js', `${tag}：id 重复`);
      else kindById.set(k.id, k);

      if (!isStr(k.name)) fail('items.js', `${tag}：缺 name`);
      if (!isStr(k.color)) fail('items.js', `${tag}：缺 color（背包标签的颜色）`);
    }
    if (kindById.size === 0) fail('items.js', 'itemKinds 一条都没有');
  }
}

const moneyTypes = await loadTop('items.js', 'moneyTypes');
const moneyById = new Map();

if (moneyTypes) {
  if (!Array.isArray(moneyTypes)) {
    fail('items.js', 'G.data.moneyTypes 顶层必须是一个数组');
  } else {
    for (const m of moneyTypes) {
      const tag = (m && m.id) || '(没有 id 的币种)';
      if (!m || typeof m !== 'object') { fail('items.js', '币种不是一个对象'); continue; }

      if (!isStr(m.id)) fail('items.js', `${tag}：id 必须是非空字符串`);
      else if (moneyById.has(m.id)) fail('items.js', `${tag}：id 重复`);
      else moneyById.set(m.id, m);

      if (!isStr(m.name)) fail('items.js', `${tag}：缺 name`);
      if (!isStr(m.color)) fail('items.js', `${tag}：缺 color（余额那一行的颜色）`);
    }
    if (moneyById.size === 0) fail('items.js', 'moneyTypes 一条都没有');
  }
}

/* 物品详情框里那两个面板。加面板要同步改 js/ui.js 与 data/strings.js。 */
const ITEM_PANELS = ['wallet', 'notebook'];

const items = await loadTop('items.js', 'items');
const itemById = new Map();

/* give / take 的形状：{ 物品id: 正整数 }。
   **物品必须真实存在** —— 写错一个字母运行时是静默失效
   （背包里什么都没多、记事里也不会说一句），跟 set 写错键是同一类坑。 */
function checkItemMap(map, where, file) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    fail(file, `${where} 必须是一个对象 { 物品id: 数量 }`);
    return;
  }
  const keys = Object.keys(map);
  if (keys.length === 0) { fail(file, `${where} 是空的`); return; }

  for (const k of keys) {
    const def = itemById.get(k);
    if (!def) fail(file, `${where}：物品 "${k}" 在 data/items.js 里不存在`);

    const v = map[k];
    if (!isInt(v) || v <= 0) {
      fail(file, `${where}：["${k}"] 必须是正整数，现在是 ${JSON.stringify(v)}`);
    } else if (def && def.stack === false && v > 1) {
      /* 唯一物品恒为 1，写 5 也拿不到第二个 —— 留着就是一句自欺欺人的备注 */
      fail(file, `${where}：["${k}"] 是唯一物品（stack: false），写 ${v} 也拿不到第二个`);
    }
  }
}

/* money 的形状：{ 币种id: "带符号的数字字符串" }。跟 set 一个规矩。 */
function checkMoneyMap(map, where, file) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    fail(file, `${where} 必须是一个对象 { 币种id: "带符号的字符串" }`);
    return;
  }
  const keys = Object.keys(map);
  if (keys.length === 0) { fail(file, `${where} 是空的`); return; }

  for (const k of keys) {
    if (!moneyById.has(k)) {
      fail(file, `${where}：币种 "${k}" 在 data/items.js 的 moneyTypes 里不存在`);
    }
    const v = map[k];
    if (typeof v !== 'string' || !/^[+-]\d+$/.test(v)) {
      fail(file, `${where}：["${k}"] 必须是带符号的数字字符串` +
                 `（"+20" / "-5"），现在是 ${JSON.stringify(v)}`);
    }
  }
}

if (items) {
  if (!Array.isArray(items)) {
    fail('items.js', 'G.data.items 顶层必须是一个数组');
  } else {
    for (const it of items) {
      const tag = (it && it.id) || '(没有 id 的物品)';
      if (!it || typeof it !== 'object') { fail('items.js', '物品不是一个对象'); continue; }

      if (!isStr(it.id)) fail('items.js', `${tag}：id 必须是非空字符串`);
      else if (!/^itm_[a-z0-9_]+$/.test(it.id)) {
        fail('items.js', `${tag}：id 建议用 itm_ 前缀 + 小写字母数字下划线`);
      } else if (itemById.has(it.id)) fail('items.js', `${tag}：id 重复`);
      else itemById.set(it.id, it);

      if (!isStr(it.name)) fail('items.js', `${tag}：缺 name`);
      if (!isStr(it.desc)) fail('items.js', `${tag}：缺 desc`);

      if (!isStr(it.kind)) fail('items.js', `${tag}：缺 kind（属于哪个分类）`);
      else if (kindById.size && !kindById.has(it.kind)) {
        fail('items.js', `${tag}：kind "${it.kind}" 不在 itemKinds 里`);
      }

      /* stack 是必填的 —— 漏了的话运行时会被当成 undefined，
         既不是"可堆叠"也不是"唯一"，行为完全靠碰运气。 */
      if (typeof it.stack !== 'boolean') {
        fail('items.js', `${tag}：stack 必须是 true / false` +
                         `（true = 可堆叠，false = 唯一），现在是 ${JSON.stringify(it.stack)}`);
      }

      /* use 和 panel 都会往详情框里塞一个按钮，一个物品只该有一个动作 */
      if (it.use != null && it.panel != null) {
        fail('items.js', `${tag}：use 和 panel 不能同时写 —— ` +
                         `两个都会往详情框里塞按钮，一个物品只该有一个动作`);
      }

      if (it.use != null) {
        if (!Array.isArray(it.use) || it.use.length === 0) {
          fail('items.js', `${tag}：use 必须是非空数组（不想要使用效果就别写这个字段）`);
        } else {
          checkEffects(it.use, 'use', tag, 'items.js');
        }
      }

      if (it.panel != null) {
        if (!isStr(it.panel) || ITEM_PANELS.indexOf(it.panel) < 0) {
          fail('items.js', `${tag}：panel ${JSON.stringify(it.panel)} 不认识` +
                           `（只允许 ${ITEM_PANELS.join(' / ')}）`);
        }
      }
    }
    if (itemById.size === 0) fail('items.js', '一个物品都没有');
  }
}

/* ---------- 校验 quests ---------- */

const quests = await loadTop('quests.js', 'quests');
const questById = new Map();

if (quests) {
  if (!Array.isArray(quests)) {
    fail('quests.js', '顶层必须是一个数组');
  } else {
    for (const q of quests) {
      const tag = (q && q.id) || '(没有 id 的任务)';
      if (!q || typeof q !== 'object') { fail('quests.js', '任务不是一个对象'); continue; }

      if (!isStr(q.id)) fail('quests.js', `${tag}：id 必须是非空字符串`);
      else if (!/^q_[a-z0-9_]+$/.test(q.id)) {
        fail('quests.js', `${tag}：id 建议用 q_ 前缀 + 小写字母数字下划线`);
      } else if (questById.has(q.id)) fail('quests.js', `${tag}：id 重复`);
      else questById.set(q.id, q);

      if (!isStr(q.name)) fail('quests.js', `${tag}：缺 name`);
      if (!isStr(q.desc)) fail('quests.js', `${tag}：缺 desc`);

      const goal = q.goal;
      if (!goal || typeof goal !== 'object') {
        fail('quests.js', `${tag}：缺 goal（完成条件）`);
        continue;
      }
      if (GOAL_TYPES.indexOf(goal.type) < 0) {
        fail('quests.js', `${tag}：goal.type "${goal.type}" 不认识（现在只支持 ${GOAL_TYPES.join(' / ')}）`);
      }
      if (!isInt(goal.count) || goal.count <= 0) {
        fail('quests.js', `${tag}：goal.count 必须是正整数，现在是 ${JSON.stringify(goal.count)}`);
      }

      /* reach / use 是"走到 / 互动某个事件点"，不写 ev 就永远推不动进度 ——
         而且从界面上完全看不出为什么（任务能接、进度就是不动）。 */
      if (EV_GOAL_TYPES.indexOf(goal.type) >= 0) {
        if (!isStr(goal.ev)) {
          fail('quests.js', `${tag}：goal.type 是 "${goal.type}"，` +
                            `必须写 goal.ev（指定是哪一个事件点）`);
        }
      } else if (goal.ev != null) {
        fail('quests.js', `${tag}：goal.ev 只在 reach / use 上用 —— ` +
                          `walk 不挑地方，写了也不会有人看`);
      }

      /* collect 是"收集某个物品"，不写 item 就不知道收什么。
         判定是**现算**当前持有量，交付时按 count 扣掉（见 09-NPC与任务.md）。 */
      if (ITEM_GOAL_TYPES.indexOf(goal.type) >= 0) {
        if (!isStr(goal.item)) {
          fail('quests.js', `${tag}：goal.type 是 "${goal.type}"，` +
                            `必须写 goal.item（指定收哪个物品）`);
        } else if (itemById.size && !itemById.has(goal.item)) {
          fail('quests.js', `${tag}：goal.item "${goal.item}" 在 data/items.js 里不存在`);
        }
      } else if (goal.item != null) {
        fail('quests.js', `${tag}：goal.item 只在 collect 上用 —— ` +
                          `别的类型写了也不会有人看`);
      }

      /* 任务挂在谁身上、在哪个房间出现 —— 由**任务自己**声明，
         不是写在 NPC 上的（任务与 NPC 非绑定）。 */
      if (!isStr(q.giver)) {
        fail('quests.js', `${tag}：缺 giver（这个任务挂在哪个 NPC 身上）`);
      }
      if (q.room != null && !isStr(q.room)) {
        fail('quests.js', `${tag}：room 要么不写，要么写成房间 id`);
      }
      if (q.requires != null && !isStr(q.requires)) {
        fail('quests.js', `${tag}：requires 要么不写，要么写成任务 id`);
      }
      if (q.requires === q.id) {
        fail('quests.js', `${tag}：requires 不能指向自己`);
      }
      if (q.repeatable != null && typeof q.repeatable !== 'boolean') {
        fail('quests.js', `${tag}：repeatable 只能是 true / false`);
      }
      if (q.offer != null && !isStr(q.offer)) {
        fail('quests.js', `${tag}：offer 要么不写，要么是非空字符串`);
      }
      if (q.turnin != null && !isStr(q.turnin)) {
        fail('quests.js', `${tag}：turnin 要么不写，要么是非空字符串`);
      }

      /* 任务奖励。字段名（money / items）**跟事件效果的键故意不一样** ——
         奖励是一份"清单"，不是一串按顺序执行的效果，两套东西不共用一个名字。
         值是**正整数**：奖励只有"给"，没有"扣"。 */
      if (q.reward != null) {
        const rw = q.reward;
        if (!rw || typeof rw !== 'object' || Array.isArray(rw)) {
          fail('quests.js', `${tag}：reward 必须是一个对象 { money, items }`);
        } else {
          for (const k of Object.keys(rw)) {
            if (k !== 'money' && k !== 'items') {
              fail('quests.js', `${tag}：reward 里不认识的键 "${k}"（只允许 money / items）`);
            }
          }
          if (Object.keys(rw).length === 0) {
            fail('quests.js', `${tag}：reward 是空的 —— 什么都不给的奖励不如不写`);
          }

          if (rw.money != null) {
            if (!rw.money || typeof rw.money !== 'object' || Array.isArray(rw.money)) {
              fail('quests.js', `${tag}：reward.money 必须是一个对象 { 币种id: 正整数 }`);
            } else {
              for (const k of Object.keys(rw.money)) {
                if (moneyById.size && !moneyById.has(k)) {
                  fail('quests.js', `${tag}：reward.money 的币种 "${k}" 在 moneyTypes 里不存在`);
                }
                const v = rw.money[k];
                if (!isInt(v) || v <= 0) {
                  fail('quests.js', `${tag}：reward.money["${k}"] 必须是正整数` +
                                    `（奖励不带符号），现在是 ${JSON.stringify(v)}`);
                }
              }
            }
          }

          if (rw.items != null) {
            checkItemMap(rw.items, `${tag} 的 reward.items`, 'quests.js');
          }
        }
      }
    }
  }
}

/* ---------- 校验 rooms ---------- */

/* 扫 data/rooms/ 目录，一个文件一个区域 */
const rooms = await (async () => {
  let files;
  try {
    files = (await readdir(ROOMS_DIR)).filter((f) => f.endsWith('.js')).sort();
  } catch {
    fail('data/rooms/', '目录不存在或读不了');
    return null;
  }
  if (files.length === 0) { fail('data/rooms/', '一个房间文件都没有'); return null; }

  const all = [];
  for (const f of files) {
    const list = await loadPushed(`rooms/${f}`, 'rooms');
    if (list) all.push(...list);
  }
  return all;
})();

const roomById = new Map();

if (rooms) {
  for (const r of rooms) {
    const tag = (r && r.id) || '(没有 id 的房间)';

    if (!r || typeof r !== 'object') { fail('rooms', '房间不是一个对象'); continue; }
    if (!isStr(r.id)) fail('rooms', `${tag}：id 必须是非空字符串`);
    else if (!/^room_[a-z0-9_]+$/.test(r.id)) fail('rooms', `${tag}：id 建议用 room_ 前缀 + 小写字母数字下划线`);
    else if (roomById.has(r.id)) fail('rooms', `${tag}：id 重复（跨区域文件也算重复）`);
    else roomById.set(r.id, r);

    /* 归属：房间必须属于一个存在的区域 */
    if (!isStr(r.area)) fail('rooms', `${tag}：缺 area（这个房间属于哪个区域）`);
    else if (!areaById.has(r.area)) fail('rooms', `${tag}：area "${r.area}" 在 data/areas.js 里不存在`);

    if (!isStr(r.name)) fail('rooms', `${tag}：缺 name`);
    if (!isStr(r.desc)) fail('rooms', `${tag}：缺 desc`);

    if (!Array.isArray(r.tiles) || r.tiles.length < 3) {
      fail('rooms', `${tag}：tiles 至少要 3 行`);
      continue;
    }
    if (!r.tiles.every((row) => typeof row === 'string')) {
      fail('rooms', `${tag}：tiles 的每一行都必须是字符串`);
      continue;
    }
    const w = r.tiles[0].length;
    if (w < 3) fail('rooms', `${tag}：每行至少要 3 个字符`);
    if (!r.tiles.every((row) => row.length === w)) {
      fail('rooms', `${tag}：tiles 每行长度不一致（应为 ${w}）`);
    }
    if (!/^#+$/.test(r.tiles[0]) || !/^#+$/.test(r.tiles[r.tiles.length - 1])) {
      fail('rooms', `${tag}：上下两行必须全是墙 #`);
    }
    for (const row of r.tiles) {
      const bad = [...row].find((c) => c !== '#' && c !== '.');
      if (bad) fail('rooms', `${tag}：tiles 里出现了不认识的字符 "${bad}"（只允许 # 和 .）`);
    }

    if (!r.spawn || !isPos(r.spawn.x) || !isPos(r.spawn.y)) {
      fail('rooms', `${tag}：spawn 必须是 { x, y } 且为非负整数`);
    } else if (!inBounds(r, r.spawn.x, r.spawn.y)) {
      fail('rooms', `${tag}：spawn (${r.spawn.x},${r.spawn.y}) 在地图外面`);
    } else if (!walkable(r, r.spawn.x, r.spawn.y)) {
      fail('rooms', `${tag}：spawn (${r.spawn.x},${r.spawn.y}) 落在墙里`);
    }

    if (r.doors != null && (typeof r.doors !== 'object' || Array.isArray(r.doors))) {
      fail('rooms', `${tag}：doors 必须是一个对象`);
    }
  }

  /* 门的引用检查，要等所有房间都建好索引 */
  for (const r of rooms) {
    if (!r || !r.doors) continue;
    for (const [key, door] of Object.entries(r.doors)) {
      const where = `${r.id} 的门 "${key}"`;

      const m = /^(\d+),(\d+)$/.exec(key);
      if (!m) { fail('rooms', `${where}：键必须是 "x,y" 的形式`); continue; }
      const dx = Number(m[1]);
      const dy = Number(m[2]);
      if (!inBounds(r, dx, dy)) { fail('rooms', `${where}：坐标在地图外面`); continue; }
      if (r.tiles[dy][dx] !== '#') {
        fail('rooms', `${where}：门必须开在墙 # 上，这里现在是 "${r.tiles[dy][dx]}"`);
      }

      if (!door || typeof door !== 'object') { fail('rooms', `${where}：值必须是一个对象`); continue; }
      if (!isStr(door.name)) fail('rooms', `${where}：缺 name`);

      const target = isStr(door.to) ? roomById.get(door.to) : null;
      if (!target) {
        fail('rooms', `${where}：目标房间 "${door.to}" 不存在`);
        continue;
      }

      if (door.back) {
        if (!isPos(door.back.x) || !isPos(door.back.y)) {
          fail('rooms', `${where}：back 必须是 { x, y } 且为非负整数`);
        } else if (!inBounds(target, door.back.x, door.back.y)) {
          fail('rooms', `${where}：back (${door.back.x},${door.back.y}) 在目标房间外面`);
        } else if (!walkable(target, door.back.x, door.back.y)) {
          fail('rooms', `${where}：back 落在 ${target.id} 的墙里`);
        }
      }

      const back = Object.values(target.doors || {}).filter((d) => d && d.to === r.id);
      if (back.length === 0) {
        fail('rooms', `${where} 通向 ${target.id}，但 ${target.id} 里没有门能回来`);
      }
    }
  }

  /* 每个房间至少要有出口 */
  for (const r of rooms) {
    if (r && (!r.doors || Object.keys(r.doors).length === 0)) {
      fail('rooms', `${r.id}：一个门都没有，进去就出不来了`);
    }
  }
}

/* ---------- 校验 npcs（要等房间索引建好才能查位置） ---------- */

const npcs = await loadTop('npcs.js', 'npcs');

if (npcs) {
  if (!Array.isArray(npcs)) {
    fail('npcs.js', 'G.data.npcs 顶层必须是一个数组');
  } else if (rooms) {
    /* 同一房间同一格不能站两个人 */
    const spotOwner = new Map();

    for (const n of npcs) {
      const tag = (n && n.id) || '(没有 id 的 NPC)';
      if (!n || typeof n !== 'object') { fail('npcs.js', 'NPC 不是一个对象'); continue; }

      if (!isStr(n.id)) fail('npcs.js', `${tag}：id 必须是非空字符串`);
      else if (!/^npc_[a-z0-9_]+$/.test(n.id)) {
        fail('npcs.js', `${tag}：id 建议用 npc_ 前缀 + 小写字母数字下划线`);
      }

      if (!isStr(n.name)) fail('npcs.js', `${tag}：缺 name`);

      /* 地图格子上只放得下一个字，多了会被裁掉 */
      if (!isStr(n.glyph)) {
        fail('npcs.js', `${tag}：缺 glyph（地图上画的那个字）`);
      } else if ([...n.glyph].length !== 1) {
        fail('npcs.js', `${tag}：glyph 必须是 1 个字，现在是 "${n.glyph}"`);
      }

      /* 类型表 / 任务表读不出来时就不再重复报一遍"不存在" */
      if (!isStr(n.type)) fail('npcs.js', `${tag}：缺 type`);
      else if (typeById.size && !typeById.has(n.type)) {
        fail('npcs.js', `${tag}：type "${n.type}" 不在 npcTypes 里`);
      }

      if (!isPercent(n.attitude)) {
        fail('npcs.js', `${tag}：attitude 必须是 0–100 的整数，现在是 ${JSON.stringify(n.attitude)}`);
      }

      /* 普通对话台词。任务对话不在这里 —— 那是任务自己的 offer / turnin。 */
      if (!Array.isArray(n.talk) || n.talk.length === 0) {
        fail('npcs.js', `${tag}：talk 必须是非空数组（这个人的普通对话台词）`);
      } else {
        for (let i = 0; i < n.talk.length; i++) {
          if (!isStr(n.talk[i])) {
            fail('npcs.js', `${tag}：talk[${i}] 必须是非空字符串`);
          }
        }
      }

      /* 任务**不再挂在 NPC 上**了：改成任务自己声明 giver / room，
         见 data/quests.js。留着这个字段会让人以为改这里有用。 */
      if (n.quest != null) {
        fail('npcs.js', `${tag}：quest 字段已经废弃 —— 任务改由 data/quests.js 的 ` +
                        `giver 声明挂在谁身上，把这个字段删掉`);
      }

      if (!Array.isArray(n.at) || n.at.length === 0) {
        fail('npcs.js', `${tag}：at 必须是非空数组（NPC 至少得出现在一个地方）`);
        continue;
      }

      for (const p of n.at) {
        const where = `${tag} 的 at`;
        if (!p || typeof p !== 'object') {
          fail('npcs.js', `${where}：每一项必须是 { room, x, y }`);
          continue;
        }

        const room = isStr(p.room) ? roomById.get(p.room) : null;
        if (!room) { fail('npcs.js', `${where}：房间 "${p.room}" 不存在`); continue; }
        if (!isPos(p.x) || !isPos(p.y)) {
          fail('npcs.js', `${where}：x / y 必须是非负整数`);
          continue;
        }
        if (!inBounds(room, p.x, p.y)) {
          fail('npcs.js', `${where}：坐标 (${p.x},${p.y}) 在 ${room.id} 外面`);
          continue;
        }
        if (!walkable(room, p.x, p.y)) {
          fail('npcs.js', `${where}：坐标 (${p.x},${p.y}) 落在 ${room.id} 的墙里`);
          continue;
        }
        if (room.doors && room.doors[`${p.x},${p.y}`]) {
          fail('npcs.js', `${where}：坐标 (${p.x},${p.y}) 是 ${room.id} 的门格，站个人会把路堵住`);
        }

        const key = `${room.id}|${p.x},${p.y}`;
        if (spotOwner.has(key)) {
          fail('npcs.js', `${where}：${room.id} 的 (${p.x},${p.y}) 已经站了 ${spotOwner.get(key)}`);
        } else {
          spotOwner.set(key, n.id);
        }
      }
    }
  }
}

/* ---------- 校验 eventTypes（事件点类型表） ---------- */

const eventTypes = await loadTop('events.js', 'eventTypes');
const evTypeById = new Map();

if (eventTypes) {
  if (!Array.isArray(eventTypes)) {
    fail('events.js', 'G.data.eventTypes 顶层必须是一个数组');
  } else {
    for (const t of eventTypes) {
      const tag = (t && t.id) || '(没有 id 的类型)';
      if (!t || typeof t !== 'object') { fail('events.js', '类型不是一个对象'); continue; }

      if (!isStr(t.id)) fail('events.js', `${tag}：id 必须是非空字符串`);
      else if (evTypeById.has(t.id)) fail('events.js', `${tag}：id 重复`);
      else evTypeById.set(t.id, t);

      if (!isStr(t.name)) fail('events.js', `${tag}：缺 name`);
      if (!isStr(t.color)) fail('events.js', `${tag}：缺 color（地图上那个字的颜色）`);
      if (t.hidden != null && typeof t.hidden !== 'boolean') {
        fail('events.js', `${tag}：hidden 只能是 true / false`);
      }
      if (t.once != null && typeof t.once !== 'boolean') {
        fail('events.js', `${tag}：once 只能是 true / false`);
      }
    }
    if (evTypeById.size === 0) fail('events.js', 'eventTypes 一条都没有');
  }
}

/* ---------- 校验 events（要等房间和 NPC 都读出来才能查位置） ---------- */

/* 一条效果里只允许这几个键。**打错一个字母就等于这条效果静默失效**，
   而且运行时完全看不出问题，所以必须拦。
   这套键由 js/effects.js 解释，事件点的 onCollide / onUse 和物品的 use
   用的是**同一套** —— 加新键要同时改这三处。 */
const EFFECT_KEYS = ['log', 'cls', 'set', 'give', 'take', 'money', 'buff'];
/* cls 的取值跟 G.ui.log() 的第二参数是同一套 */
const LOG_CLASSES = ['title', 'info', 'sys', 'ok', 'warn', 'err'];

/* set 的键必须指向**玩家对象上真实存在的字段**。
   光校验格式是不够的：写成已删字段（`player.gold`）格式完全合法，
   而运行时 applyEffect 又是个空壳，于是这条效果**永远静默失效**，
   从界面上一点都看不出来。见 10-事件点.md。
   （这里只管"这个字段在不在"，不管"该不该改它" —— 后者是玩法问题。） */
const PLAYER_SET_KEYS = [
  'player.hp', 'player.hpMax', 'player.ess', 'player.essMax', 'player.div',
  'player.base.str', 'player.base.int', 'player.base.spr',
  'player.base.dex', 'player.base.luk', 'player.base.per'
];

function checkEffects(ev, field, tag, file) {
  const list = ev[field];
  if (list == null) return;

  if (!Array.isArray(list) || list.length === 0) {
    fail(file, `${tag}：${field} 必须是非空数组` +
               `（不想要这条触发路就别写这个字段，写了空数组等于白写）`);
    return;
  }

  for (let i = 0; i < list.length; i++) {
    const ef = list[i];
    const where = `${tag} 的 ${field}[${i}]`;

    if (!ef || typeof ef !== 'object' || Array.isArray(ef)) {
      fail(file, `${where}：必须是一个对象`);
      continue;
    }

    for (const k of Object.keys(ef)) {
      if (EFFECT_KEYS.indexOf(k) < 0) {
        fail(file, `${where}：不认识的键 "${k}"（只允许 ${EFFECT_KEYS.join(' / ')}）`);
      }
    }

    if (ef.log != null && !isStr(ef.log)) {
      fail(file, `${where}：log 必须是非空字符串`);
    }

    if (ef.cls != null) {
      if (!isStr(ef.cls) || LOG_CLASSES.indexOf(ef.cls) < 0) {
        fail(file, `${where}：cls ${JSON.stringify(ef.cls)} 不认识` +
                   `（只允许 ${LOG_CLASSES.join(' / ')}）`);
      }
    }

    if (ef.set != null) {
      if (!ef.set || typeof ef.set !== 'object' || Array.isArray(ef.set)) {
        fail(file, `${where}：set 必须是一个对象`);
      } else {
        const keys = Object.keys(ef.set);
        if (keys.length === 0) fail(file, `${where}：set 是空的`);
        for (const k of keys) {
          if (k.indexOf('player.') !== 0 || k.length <= 'player.'.length) {
            fail(file, `${where}：set 的键 "${k}" 必须是 player.xxx 这种点号路径`);
          } else if (PLAYER_SET_KEYS.indexOf(k) < 0) {
            fail(file, `${where}：set 的键 "${k}" 在玩家对象上不存在` +
                       `（只允许 ${PLAYER_SET_KEYS.join(' / ')}）—— ` +
                       `写一个已删字段，这条效果会永远静默失效`);
          }
          /* 值必须是**带符号的字符串**。写数字不行 —— 分不清"加 5"还是"设成 5"。 */
          const v = ef.set[k];
          if (typeof v !== 'string' || !/^[+-]\d+$/.test(v)) {
            fail(file, `${where}：set["${k}"] 必须是带符号的数字字符串` +
                       `（"+1" / "-5"），现在是 ${JSON.stringify(v)}`);
          }
        }
      }
    }

    /* give / take：物品增减。键必须指向真实物品，值必须是正整数。 */
    if (ef.give != null) checkItemMap(ef.give, `${where} 的 give`, file);
    if (ef.take != null) checkItemMap(ef.take, `${where} 的 take`, file);

    /* money：货币增减。**不并进 give / take** —— 货币不是物品，不占背包格。 */
    if (ef.money != null) checkMoneyMap(ef.money, `${where} 的 money`, file);

    /* buff：挂一个状态。**这条只查形状，存在性放到文件末尾**（状态表在
       后半段才读出来）。写错一个字母 = 挂不上任何状态、记事里也不说一句，
       界面上完全看不出来，必须拦。 */
    if (ef.buff != null && !isStr(ef.buff)) {
      fail(file, `${where}：buff 必须是状态 id 字符串（如 "st_focus"）`);
    }

    /* 一个键都没写的一条 = 白写一条，多半是键名打错了 */
    const used = Object.keys(ef).filter((k) => k !== 'cls');
    if (used.length === 0) {
      fail(file, `${where}：这条效果什么都不会做（只写了 cls？cls 是给 log 配的样式）`);
    }
  }
}

const events = await loadTop('events.js', 'events');

if (events) {
  if (!Array.isArray(events)) {
    fail('events.js', 'G.data.events 顶层必须是一个数组');
  } else if (rooms) {
    /* NPC 占的格子。事件点开在那儿 = 玩家永远走不上去，
       那个事件点就成了碰不到的东西 —— 光检查坐标在界内是拦不住的。 */
    const npcSpots = new Set();
    for (const x of (npcs || [])) {
      if (!x || !Array.isArray(x.at)) continue;
      for (const p of x.at) {
        if (p && isStr(p.room) && isPos(p.x) && isPos(p.y)) {
          npcSpots.add(`${p.room}|${p.x},${p.y}`);
        }
      }
    }

    const evSpot = new Map();

    for (const ev of events) {
      const tag = (ev && ev.id) || '(没有 id 的事件点)';
      if (!ev || typeof ev !== 'object') { fail('events.js', '事件点不是一个对象'); continue; }

      if (!isStr(ev.id)) fail('events.js', `${tag}：id 必须是非空字符串`);
      else if (!/^ev_[a-z0-9_]+$/.test(ev.id)) {
        fail('events.js', `${tag}：id 建议用 ev_ 前缀 + 小写字母数字下划线`);
      }

      if (!isStr(ev.name)) fail('events.js', `${tag}：缺 name`);

      if (!isStr(ev.glyph)) {
        fail('events.js', `${tag}：缺 glyph（地图上画的那个字）`);
      } else if ([...ev.glyph].length !== 1) {
        fail('events.js', `${tag}：glyph 必须是 1 个字，现在是 "${ev.glyph}"`);
      }

      if (!isStr(ev.type)) fail('events.js', `${tag}：缺 type`);
      else if (evTypeById.size && !evTypeById.has(ev.type)) {
        fail('events.js', `${tag}：type "${ev.type}" 不在 eventTypes 里`);
      }

      if (ev.once != null && typeof ev.once !== 'boolean') {
        fail('events.js', `${tag}：once 只能是 true / false`);
      }
      if (ev.hidden != null && typeof ev.hidden !== 'boolean') {
        fail('events.js', `${tag}：hidden 只能是 true / false`);
      }
      if (ev.desc != null && !isStr(ev.desc)) {
        fail('events.js', `${tag}：desc 要么不写，要么是非空字符串`);
      }
      if (ev.hint != null && !isStr(ev.hint)) {
        fail('events.js', `${tag}：hint 要么不写，要么是非空字符串`);
      }

      /* 两个回调至少要有一个 —— 都没有的事件点什么也做不了。
         触发方式完全由"写了哪个回调"决定，所以这条也是唯一的"触发方式"检查。 */
      if (ev.onCollide == null && ev.onUse == null) {
        fail('events.js', `${tag}：onCollide 和 onUse 至少要写一个，` +
                          `两个都没有的事件点什么也做不了`);
      }
      checkEffects(ev, 'onCollide', tag, 'events.js');
      checkEffects(ev, 'onUse', tag, 'events.js');

      if (!Array.isArray(ev.at) || ev.at.length === 0) {
        fail('events.js', `${tag}：at 必须是非空数组（至少得出现在一个地方）`);
        continue;
      }

      for (const p of ev.at) {
        const where = `${tag} 的 at`;
        if (!p || typeof p !== 'object') {
          fail('events.js', `${where}：每一项必须是 { room, x, y }`);
          continue;
        }

        const room = isStr(p.room) ? roomById.get(p.room) : null;
        if (!room) { fail('events.js', `${where}：房间 "${p.room}" 不存在`); continue; }
        if (!isPos(p.x) || !isPos(p.y)) {
          fail('events.js', `${where}：x / y 必须是非负整数`);
          continue;
        }
        if (!inBounds(room, p.x, p.y)) {
          fail('events.js', `${where}：坐标 (${p.x},${p.y}) 在 ${room.id} 外面`);
          continue;
        }
        /* 事件点**不挡路**，所以它的坐标必须是玩家真能走上去的格子。
           注意这里跟 NPC 那一段是**两套不同的规则**，别抄错。 */
        if (!walkable(room, p.x, p.y)) {
          fail('events.js', `${where}：坐标 (${p.x},${p.y}) 落在 ${room.id} 的墙里，` +
                            `走不上去的东西没有意义`);
          continue;
        }
        if (room.doors && room.doors[`${p.x},${p.y}`]) {
          fail('events.js', `${where}：坐标 (${p.x},${p.y}) 是 ${room.id} 的门格 —— ` +
                            `门格上的动作是"进入"，再挂一个事件点两个按钮会打架`);
          continue;
        }
        if (room.spawn && room.spawn.x === p.x && room.spawn.y === p.y) {
          fail('events.js', `${where}：坐标 (${p.x},${p.y}) 是 ${room.id} 的出生点，` +
                            `玩家一进来就站在上面`);
          continue;
        }
        if (npcSpots.has(`${room.id}|${p.x},${p.y}`)) {
          fail('events.js', `${where}：坐标 (${p.x},${p.y}) 站了 NPC —— ` +
                            `NPC 挡路，那一格玩家永远走不上去`);
          continue;
        }

        const key = `${room.id}|${p.x},${p.y}`;
        if (evSpot.has(key)) {
          fail('events.js', `${where}：${room.id} 的 (${p.x},${p.y}) 已经放了 ${evSpot.get(key)}`);
        } else {
          evSpot.set(key, ev.id);
        }
      }
    }
  }
}

/* ---------- 任务的交叉检查（要等 NPC 和房间都读出来） ---------- */

if (quests && npcs && rooms) {
  const npcById = new Map();
  for (const x of npcs) if (x && isStr(x.id)) npcById.set(x.id, x);

  for (const q of quests) {
    if (!q || !isStr(q.id)) continue;
    const tag = q.id;

    const giver = isStr(q.giver) ? npcById.get(q.giver) : null;
    if (isStr(q.giver) && !giver) {
      fail('quests.js', `${tag}：giver "${q.giver}" 在 data/npcs.js 里不存在`);
    }
    if (isStr(q.room) && !roomById.has(q.room)) {
      fail('quests.js', `${tag}：room "${q.room}" 在 data/rooms/ 里不存在`);
    }

    /* giver 必须**真的会出现在** room 里，否则这个任务谁也发不出来，
       玩家永远接不到 —— 光检查两个 id 都存在是不够的。 */
    if (giver) {
      const spots = (giver.at || []).filter((p) => p && isStr(p.room));
      if (isStr(q.room)) {
        if (!spots.some((p) => p.room === q.room)) {
          fail('quests.js', `${tag}：giver ${giver.id} 从来不出现在 ${q.room}，` +
                            `这个任务没人发得出来`);
        }
      } else if (spots.length === 0) {
        fail('quests.js', `${tag}：giver ${giver.id} 一个出现位置都没有`);
      }
    }

    /* 前置任务必须存在，而且**不能串成环** ——
       成环的那几个永远都解锁不了，而且从界面上完全看不出为什么。 */
    if (isStr(q.requires)) {
      if (!questById.has(q.requires)) {
        fail('quests.js', `${tag}：requires "${q.requires}" 在 data/quests.js 里不存在`);
      } else {
        const chain = [q.id];
        let cur = q.requires;
        while (cur) {
          if (chain.indexOf(cur) >= 0) {
            fail('quests.js', `${tag}：requires 串成了环（${chain.join(' → ')} → ${cur}）`);
            break;
          }
          chain.push(cur);
          const prev = questById.get(cur);
          cur = prev && isStr(prev.requires) ? prev.requires : null;
        }
      }
    }
  }
}

/* ---------- 任务的 goal.ev 必须指向真实事件点 ---------- */

if (quests && events) {
  const evById = new Set();
  for (const e of events) if (e && isStr(e.id)) evById.add(e.id);

  for (const q of quests) {
    if (!q || !isStr(q.id)) continue;
    const goal = q.goal || {};
    if (EV_GOAL_TYPES.indexOf(goal.type) < 0) continue;
    if (!isStr(goal.ev)) continue;   /* 缺 ev 上面已经报过了，不重复报 */

    if (!evById.has(goal.ev)) {
      fail('quests.js', `${q.id}：goal.ev "${goal.ev}" 在 data/events.js 里不存在`);
    }
  }
}

/* ---------- NPC 不能把路堵死 ---------- */

if (rooms && npcs) {
  /* 哪些格子站了人 —— 运行时 NPC 是障碍，这里也要按障碍算 */
  const blocked = new Set();
  for (const x of npcs) {
    if (!x || !Array.isArray(x.at)) continue;
    for (const p of x.at) {
      if (p && isStr(p.room) && isPos(p.x) && isPos(p.y)) blocked.add(`${p.room}|${p.x},${p.y}`);
    }
  }

  for (const r of rooms) {
    if (!r || !r.spawn) continue;
    const sx = r.spawn.x, sy = r.spawn.y;
    if (!inBounds(r, sx, sy) || !walkable(r, sx, sy)) continue;   /* 出生点本身有问题，上面报过了 */

    if (blocked.has(`${r.id}|${sx},${sy}`)) {
      fail('npcs.js', `${r.id}：出生点 (${sx},${sy}) 上站了 NPC，玩家一进来就被卡住`);
      continue;
    }

    /* 从出生点出发，按"NPC 挡路"的规则能走到哪些格子 */
    const seen = new Set([`${sx},${sy}`]);
    const queue = [[sx, sy]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        if (!walkable(r, nx, ny)) continue;
        if (blocked.has(`${r.id}|${nx},${ny}`)) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }

    /* 每个门格都得走得到，否则这个出口等于没有 —— 而且从界面上看不出是被谁堵的 */
    for (const key of Object.keys(r.doors || {})) {
      const [dx, dy] = key.split(',').map(Number);
      if (!seen.has(`${dx},${dy}`)) {
        fail('npcs.js', `${r.id}：门 "${key}" 走不到了 —— 被 NPC 堵死了`);
      }
    }
  }
}

/* ---------- 区域与房间的交叉检查 ---------- */

if (areas && rooms) {
  for (const a of areas) {
    if (!a || !isStr(a.id)) continue;

    /* 中心房间必须真的存在，而且必须属于这个区域 */
    if (isStr(a.center)) {
      const c = roomById.get(a.center);
      if (!c) {
        fail('areas.js', `${a.id}：中心房间 "${a.center}" 不存在`);
      } else if (c.area !== a.id) {
        fail('areas.js', `${a.id}：中心房间 ${c.id} 的 area 是 "${c.area}"，对不上`);
      }
    }

    /* 空区域多半是写错了 area 字段，值得拦一下 */
    const count = rooms.filter((r) => r && r.area === a.id).length;
    if (count === 0) fail('areas.js', `${a.id}：这个区域里一个房间都没有`);
  }
}

/* ---------- 校验 statuses ---------- */

/* 修正项（mods）技能和状态共用同一套写法，校验也共用一份。
   attr 必须落在属性表里 —— 打错一个字母（"luc" 之类）运行时是**静默失效**，
   属性就是不变，从界面上完全看不出为什么。 */
const ATTR_KEYS = ['str', 'int', 'spr', 'dex', 'luk', 'per'];

function checkMods(owner, mods, tag) {
  if (!Array.isArray(mods) || mods.length === 0) {
    fail(owner, `${tag}：mods 必须是非空数组（不想要修正就别写这个字段）`);
    return;
  }
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    const where = `${tag} 的 mods[${i}]`;

    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      fail(owner, `${where}：必须是一个对象 { attr, add / pct }`);
      continue;
    }

    if (ATTR_KEYS.indexOf(m.attr) < 0) {
      fail(owner, `${where}：attr "${m.attr}" 不是属性 key` +
                  `（只允许 ${ATTR_KEYS.join(' / ')}）`);
    }

    const hasAdd = m.add != null;
    const hasPct = m.pct != null;
    if (hasAdd === hasPct) {
      fail(owner, `${where}：add 和 pct 必须二选一` +
                  `（现在是${hasAdd ? '两个都写了' : '一个都没写'}）`);
    }
    if (hasAdd && !isInt(m.add)) {
      fail(owner, `${where}：add 必须是整数，现在是 ${JSON.stringify(m.add)}`);
    }
    if (hasPct && !isInt(m.pct)) {
      fail(owner, `${where}：pct 必须是整数，现在是 ${JSON.stringify(m.pct)}`);
    }
  }
}

/* 计时方式，跟 js/statuses.js 同步 */
const STATUS_UNITS = ['step', 'time', 'manual', 'threshold'];
/* tick 能改的字段，跟 js/statuses.js 的 applyTick 同步 */
const TICK_KEYS = ['hp', 'ess'];

const statuses = await loadPushed('statuses.js', 'statuses');
const statusById = new Map();

if (statuses) {
  if (!Array.isArray(statuses)) {
    fail('statuses.js', '顶层必须是一个数组');
  } else {
    for (const s of statuses) {
      const tag = (s && s.id) || '(没有 id 的状态)';
      if (!s || typeof s !== 'object') { fail('statuses.js', '状态不是一个对象'); continue; }

      if (!isStr(s.id)) fail('statuses.js', `${tag}：id 必须是非空字符串`);
      else if (!/^st_[a-z0-9_]+$/.test(s.id)) {
        fail('statuses.js', `${tag}：id 建议用 st_ 前缀 + 小写字母数字下划线`);
      } else if (statusById.has(s.id)) fail('statuses.js', `${tag}：id 重复`);
      else statusById.set(s.id, s);

      if (!isStr(s.name)) fail('statuses.js', `${tag}：缺 name`);
      if (!isStr(s.desc)) fail('statuses.js', `${tag}：缺 desc`);

      if (s.kind !== 'buff' && s.kind !== 'debuff') {
        fail('statuses.js', `${tag}：kind 只能是 buff / debuff，` +
                            `现在是 ${JSON.stringify(s.kind)}`);
      }

      if (STATUS_UNITS.indexOf(s.unit) < 0) {
        fail('statuses.js', `${tag}：unit "${s.unit}" 不认识` +
                            `（只允许 ${STATUS_UNITS.join(' / ')}）`);
      } else if (s.unit === 'time') {
        /* ⚠️ 按真实秒数计时的计时器**还没实现** —— js/statuses.js 的 tickStep
           只认 step，time 的状态挂上就永远不会消失，而且完全看不出原因。
           素材先别用这个值；要用得先把计时器补上，再把这条删掉。 */
        fail('statuses.js', `${tag}：unit "time"（按真实秒数计时）的计时器还没实现，` +
                            `现在挂上就永远不会过期`);
      }

      if (!isPos(s.turns)) {
        fail('statuses.js', `${tag}：turns 必须是 0 或正整数，` +
                            `现在是 ${JSON.stringify(s.turns)}`);
      } else if (s.unit === 'manual' || s.unit === 'threshold') {
        if (s.turns !== 0) {
          fail('statuses.js', `${tag}：unit 是 "${s.unit}"，去留不由计时决定，turns 必须写 0`);
        }
      } else if (s.turns === 0) {
        fail('statuses.js', `${tag}：unit 是 "${s.unit}"，turns 写 0 等于刚挂上就掉，没有意义`);
      }

      if (s.mods != null) checkMods('statuses.js', s.mods, tag);

      if (s.tick != null) {
        const where = `${tag} 的 tick`;
        if (typeof s.tick !== 'object' || Array.isArray(s.tick)) {
          fail('statuses.js', `${where}：必须是一个对象 { key, delta }`);
        } else {
          if (TICK_KEYS.indexOf(s.tick.key) < 0) {
            fail('statuses.js', `${where}：key "${s.tick.key}" 不认识` +
                                `（只允许 ${TICK_KEYS.join(' / ')}）`);
          }
          if (!isInt(s.tick.delta) || s.tick.delta === 0) {
            fail('statuses.js', `${where}：delta 必须是非零整数，` +
                                `现在是 ${JSON.stringify(s.tick.delta)}`);
          }
          /* tick 是"每次计时"的附加效果，只有会自动计时的 unit 才配得上它。
             manual / threshold 根本不计时，写了 tick 也永远跑不到。 */
          if (s.unit !== 'step') {
            fail('statuses.js', `${where}：unit 是 "${s.unit}"，这个 tick 永远跑不到 —— ` +
                                `现在只有 step（走一格算一次）会执行 tick`);
          }
        }
      }
    }
    if (statusById.size === 0) fail('statuses.js', '一个状态都没有');
  }
}

/* ---------- 校验 skills（要等状态索引建好才能查 applies） ---------- */

const skills = await loadPushed('skills.js', 'skills');

if (skills) {
  if (!Array.isArray(skills)) {
    fail('skills.js', '顶层必须是一个数组');
  } else {
    const skillIds = new Set();

    for (const s of skills) {
      const tag = (s && s.id) || '(没有 id 的技能)';
      if (!s || typeof s !== 'object') { fail('skills.js', '技能不是一个对象'); continue; }

      if (!isStr(s.id)) fail('skills.js', `${tag}：id 必须是非空字符串`);
      else if (!/^skl_[a-z0-9_]+$/.test(s.id)) {
        fail('skills.js', `${tag}：id 建议用 skl_ 前缀 + 小写字母数字下划线`);
      } else if (skillIds.has(s.id)) fail('skills.js', `${tag}：id 重复`);
      else skillIds.add(s.id);

      if (!isStr(s.name)) fail('skills.js', `${tag}：缺 name`);
      if (!isStr(s.desc)) fail('skills.js', `${tag}：缺 desc`);

      if (s.kind === 'passive') {
        /* 被动技能"拥有就生效"，没有 mods 等于白给一个技能 */
        if (s.mods == null) {
          fail('skills.js', `${tag}：被动技能必须写 mods，不然它什么都不改`);
        } else {
          checkMods('skills.js', s.mods, tag);
        }
        if (s.applies != null) {
          fail('skills.js', `${tag}：被动技能不写 applies —— ` +
                            `它的修正直接在 mods 里，不经过状态`);
        }
      } else if (s.kind === 'active') {
        /* 主动技能的效果**全部**来自它挂的那个状态。
           写在这儿的 mods 会被 G.skills.passiveMods() 忽略掉 ——
           留着让人以为有用，所以直接拦。 */
        if (s.mods != null) {
          fail('skills.js', `${tag}：主动技能不写 mods —— 修正在它挂的状态里，` +
                            `写在这里会被忽略（见 docs/设定/06-物品与技能.md）`);
        }
        if (!isStr(s.applies)) {
          fail('skills.js', `${tag}：主动技能必须写 applies（用一次挂哪个状态）`);
        } else if (statusById.size && !statusById.has(s.applies)) {
          fail('skills.js', `${tag}：applies "${s.applies}" 在 data/statuses.js 里不存在`);
        }
      } else {
        fail('skills.js', `${tag}：kind 只能是 passive / active，` +
                          `现在是 ${JSON.stringify(s.kind)}`);
      }
    }

    if (skillIds.size === 0) fail('skills.js', '一个技能都没有');
  }
}

/* ---------- 效果里的 buff 必须指向真实状态 ----------
   状态表在文件后半段才读出来，所以这条**只能放到这里做**（形状检查在
   checkEffects 里已经做过了）。写错一个字母 = 挂不上任何状态、记事里
   也不会说一句，从界面上完全看不出来 —— 跟 set 写错键是同一类坑。

   要扫两处：事件点的 onCollide / onUse，以及物品的 use。
   以后再加"会挂状态"的地方，记得也加进来。 */

if (statusById.size) {
  const scanBuff = (file, list, where) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const ef = list[i];
      if (!ef || typeof ef !== 'object') continue;
      if (!isStr(ef.buff)) continue;               /* 形状不对上面报过了 */
      if (!statusById.has(ef.buff)) {
        fail(file, `${where}[${i}]：buff "${ef.buff}" 在 data/statuses.js 里不存在`);
      }
    }
  };

  for (const ev of (events || [])) {
    if (!ev || !isStr(ev.id)) continue;
    scanBuff('events.js', ev.onCollide, `${ev.id} 的 onCollide`);
    scanBuff('events.js', ev.onUse, `${ev.id} 的 onUse`);
  }
  for (const it of (items || [])) {
    if (!it || !isStr(it.id)) continue;
    scanBuff('items.js', it.use, `${it.id} 的 use`);
  }
}

/* ---------- 汇总 ---------- */

if (errors.length) {
  console.error('\n素材校验不通过：\n');
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`\n共 ${errors.length} 个问题。\n`);
  process.exit(1);
}

const n = (x) => (Array.isArray(x) ? x.length : 0);
console.log('素材校验通过。');
console.log(`  区域 ${n(areas)} 个，房间 ${n(rooms)} 个，` +
            `NPC ${n(npcs)} 个，任务 ${n(quests)} 个，` +
            `事件点 ${n(events)} 个，` +
            `物品 ${n(items)} 个（分类 ${n(itemKinds)} / 币种 ${n(moneyTypes)}），` +
            `技能 ${n(skills)} 个，状态 ${n(statuses)} 个，` +
            `文案 ${strings ? Object.keys(strings).length : 0} 条。`);
