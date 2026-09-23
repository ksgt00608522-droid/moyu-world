/* 魔鱼世界 · 界面文案
   全局：G.data.strings

   注意：赋值号右边必须是**严格的 JSON**（双引号、无尾逗号、无注释）。
   tools/validate.mjs 会剥掉前缀后用 JSON.parse 校验，写错会直接报错。

   占位符写法：{name}，取值时用 G.data.t('key', { name: 'xx' }) */

G.data.strings = {
  "boot.title": "魔 鱼 世 界",
  "boot.continue": "检测到存档。用方向键或 WASD 走路，按 / 输入指令。",

  "create.done": "「{name}」睁开了眼。你站在一间空旷的大厅中央，四面墙上各有一扇门。",

  "room.enter": "【{name}】{desc}",

  "move.ok": "你向{dir}走了一步。",
  "move.blocked": "那边是墙，过不去。",
  "move.blocked.npc": "{name}挡在前面，过不去。",

  "door.here": "这里有一扇{name}。按空格 / 句号，或点右边的「进入这扇门」。",
  "door.enter": "你推开{name}，走了进去。",
  "door.none": "你脚下没有门。",
  "door.missing": "这扇门后面什么都没有。（目标房间不存在，检查一下素材）",

  "dir.up": "上",
  "dir.down": "下",
  "dir.left": "左",
  "dir.right": "右",

  "npc.here": "这里有人：{names}。",

  "talk.line": "{name}：「{line}」",
  "talk.silent": "他看了你一眼，什么也没说。",
  "talk.nobody": "旁边没有人。",
  "talk.which": "旁边站着好几个人：{names}。点他那一行的按钮，或者打 talk <id>。",
  "talk.opt.start": "跟{name}说话",
  "talk.opt.chat": "随便聊聊",
  "talk.opt.accept": "接受：{name}",
  "talk.opt.deliver": "交付：{name}",
  "talk.opt.bye": "结束对话",
  "talk.offer": "这事就交给你了。",
  "talk.turnin": "办好了，拿着吧。",

  "quest.ready": "任务目标达成：{name}。去找发布的人交差。",
  "quest.ready.short": "可以交差了",
  "quest.finished": "已完成",
  "quest.accept": "接下任务：{name}。",
  "quest.deliver": "交付任务：{name}。",
  "quest.repeat": "「{name}」还能再接一次（已经做完 {times} 次）。",
  "quest.reward": "拿到了：{list}。",
  "quest.short": "「{name}」还差 {n} 个，凑齐了再来。",

  "use.none": "脚下没有可以互动的东西。",
  "use.noop": "你碰了碰，没什么反应。",
  "use.opt": "动手试试",

  "save.ok": "已存档。",
  "save.ok.file": "已存档，并写入磁盘文件「{file}」。",
  "save.fail": "存档失败：{msg}",

  "load.ok": "已读档。欢迎回来，「{name}」。",
  "load.none": "没有找到存档。",
  "load.fail": "读档失败：{msg}",

  "export.ok": "已导出存档文件：{file}",
  "import.ask": "请选择要导入的存档文件。",
  "import.ok": "已导入存档，「{name}」。",
  "import.fail": "导入失败：{msg}",

  "bind.unsupported": "这个浏览器不支持绑定磁盘文件，改用「导出」吧。",
  "bind.ok": "已绑定存档文件「{file}」。以后每次存档都会写进去。",
  "bind.fail": "绑定失败：{msg}",
  "bind.none": "还没有绑定磁盘文件。输入 bind 选一个。",
  "bind.state": "磁盘文件：{file}",
  "bind.state.none": "磁盘文件：未绑定",

  "help.header": "可用指令：",
  "help.keys": "方向键 / WASD / 小键盘 8 2 4 6 走路，小键盘 5 进门。按 / 或回车输入指令，Esc 退出输入。",
  "cmd.unknown": "没有这个指令：{cmd}。输入 help 看看有什么。",
  "cmd.echo": "> {cmd}",

  "reset.ask": "这会删掉当前存档，无法撤销。确认请输入 reset yes。",
  "reset.done": "存档已删除。重新开始吧。",
  "clear.done": "记事已清空。",

  "ui.hint": "↑↓←→ 或 WASD 走路，点地图上相邻的格子也能走",
  "ui.walkHint": "↑↓←→ / WASD 走路　按 / 输入指令",
  "ui.cmdHint": "输入指令，help 查看全部",
  "ui.blocked": "还没有角色，先创建一个。",

  "ui.talking": "正在跟{name}说话",
  "ui.secondaryIdle": "站在人旁边，点「跟某某说话」，选项会出现在这里。",

  "ui.buffIdle": "身上没什么特别的。",
  "ui.skill.passive": "被动",
  "ui.skill.active": "主动",
  "ui.buff.good": "正面",
  "ui.buff.bad": "负面",
  "ui.buff.view": "点开看效果",
  "ui.item.view": "点开看详情",
  "ui.modal.close": "关闭",

  "ui.vital.hp": "生命",
  "ui.vital.ess": "灵性",
  "ui.attr.name": "名字",

  "skill.use": "你用了「{name}」。",
  "skill.refresh": "「{name}」又续上了。",
  "skill.notActive": "「{name}」是被动技能，不用手动用。",
  "skill.missing": "「{name}」现在用不了。",

  "status.gain": "你身上多了「{name}」。",
  "status.refresh": "「{name}」又续上了。",
  "status.lose": "「{name}」消退了。",
  "status.tick.hp": "「{name}」：生命 {delta}。",
  "status.tick.ess": "「{name}」：灵性 {delta}。",

  "item.amount": "{name}",
  "item.amount.n": "{name} ×{n}",
  "item.dup": "你已经有一个「{name}」了。",

  "money.amount": "{name} ×{n}",

  "bag.empty": "身上什么也没有。",
  "bag.list": "身上带着：{list}。",
  "bag.none": "身上没有「{name}」。",
  "bag.which": "有两个东西都叫「{name}」，打 id 吧。",
  "bag.noUse": "「{name}」没什么能用的。",

  "modal.spells.title": "法术列表",
  "modal.spells.idle": "还没有学会任何法术。",
  "modal.spells.use": "释放",
  "modal.spells.applies": "释放后挂上「{name}」{extra}",

  "modal.arts.title": "技艺",
  "modal.arts.idle": "还没有学会任何技艺。",
  "modal.arts.active": "主动法术",
  "modal.arts.passive": "被动技能",

  "modal.buff.title": "状态详情",
  "modal.buff.desc": "描述",
  "modal.buff.left": "剩余量",
  "modal.buff.effect": "影响",
  "modal.buff.unit": "计时",
  "modal.buff.none": "不改变任何属性。",

  "modal.item.title": "物品详情",
  "modal.item.desc": "描述",
  "modal.item.count": "数量",
  "modal.item.count.n": "持有 {n} 个",
  "modal.item.count.one": "只有一个",
  "modal.item.use": "使用",
  "modal.item.open.wallet": "看看里面有多少",
  "modal.item.open.notebook": "翻开看看",

  "modal.wallet.title": "钱袋",
  "modal.wallet.empty": "里面空空的，一枚钱也没有。",

  "modal.note.title": "笔记本",
  "modal.note.active": "进行中",
  "modal.note.done": "已完成",
  "modal.note.active.none": "眼下没有在办的事。",
  "modal.note.done.none": "还什么都没办成。",
  "modal.note.progress": "{n} / {total}",
  "modal.note.times": "完成 {n} 次",
  "modal.note.pages": "第 {p} / {total} 页",

  "buff.left.step": "还能走 {n} 格",
  "buff.left.time": "还能持续 {n} 秒",
  "buff.left.manual": "不会自己消失，要手动解除",
  "buff.left.threshold": "不由计时决定，去留看条件",

  "buff.unit.step": "每走一格减 1",
  "buff.unit.time": "按真实时间流逝",
  "buff.unit.manual": "不自动消失",
  "buff.unit.threshold": "不由计时驱动，去留由外部条件决定",

  "buff.tick.step": "每走一格：{what}",
  "buff.tick.other": "每次计时：{what}",

  "mods.add": "{attr} {n}",
  "mods.pct": "{attr} {n}%",

  "cmd.buff.which": "身上挂着好几个状态：{names}。点名字看详情，或者打 buff <名字>。",
  "cmd.buff.missing": "你身上没有「{name}」这个状态。"
};
