/* 魔鱼世界 · 任务表
   全局：G.data.quests

   **任务单独存放、单独维护。** 不写在 NPC 里，也不写在房间里。
   任务与 NPC **不是绑定关系** —— 任务自己声明 `giver` 和 `room`，
   由这两个字段动态决定它此刻出现在哪个房间的哪个 NPC 身上（见 ofNpc()）。

   注意：赋值号右边必须是**严格的 JSON**（双引号、无尾逗号、无注释）。
   tools/validate.mjs 会剥掉前缀后用 JSON.parse 校验，写错会直接报错。

   字段：
     id          唯一标识，q_ 前缀 + 小写字母数字下划线
     name        任务名，显示给玩家
     desc        任务描述
     goal        完成条件
     giver       **必填**，发布这个任务的 NPC id。任务挂在谁身上看这个
     room        可选。只在哪个房间出现。NPC 会出现在多个房间时用它限定 ——
                 填了之后，只有站在这个房间里的那个 NPC 才会拿出这个任务
     requires    可选。前置任务 id。**前置没交付，这个任务完全不出现**
                 （不是"显示了但灰着"，是根本不在对话选项里）
     repeatable  可选，默认 false。true = 交付后可以反复再接
     reward      可选。交付时给什么，**只允许 money / items 两个键**：
                   { "money": { "coin": 30 }, "items": { "itm_herb": 1 } }
                 值是**正整数**（奖励只有"给"，没有"扣"）。
                 字段名跟事件效果的键（give / money）**故意不一样** ——
                 奖励是一份"清单"，不是一串按顺序执行的效果。
                 **没有 log 字段**，交付时那一行由系统生成。
     offer       可选。接取时 NPC 说的话。不填用通用文案
     turnin      可选。交付时 NPC 说的话。不填用通用文案

   goal 现在有四种类型：
     { "type": "walk",    "count": 10 }                     走够 10 步
     { "type": "reach",   "count": 1, "ev": "ev_xx" }       走到某个事件点上
     { "type": "use",     "count": 1, "ev": "ev_xx" }       跟某个事件点互动
     { "type": "collect", "count": 3, "item": "itm_xx" }    身上攒够 3 个某物品

   **reach / use 必须写 ev**（指定是哪一个事件点）—— walk 不用，因为它不挑地方。
   **collect 必须写 item**，而且它跟另外三种**不是一回事**：

     walk / reach / use  累计推进（存档里的 progress 一直加）
     collect             **现算**（进度就是"现在身上有几个"），交付时扣掉

   collect 不能累计的理由：那样"捡到 3 个 -> 用掉 1 个"之后进度还停在 3 / 3，
   玩家会以为可以交差，交付时却发现东西不够。

   reach 和 use 的区别：站在泉水上是 reach，喝一口才是 use。
   reach 不看 count（走到就是走到，没有"走到一半"这回事），use 看。

   加一种目标类型要同时改三处：tools/validate.mjs 的 GOAL_TYPES，
   以及谁去调 G.quests.add() / reach() / use()（现在是 js/world.js）。

   进度存在存档的 quests 字段里：
     { "<任务 id>": { "state": "active", "progress": 3, "times": 0 } }
   state 三个值：available（可接）/ active（已接，进行中）/ done（已交付）。
   **"没有记录" = available**，所以旧存档不用迁移就能直接用。
   （collect 的 progress 字段不用，现算 —— 见上。）

   任务链就是靠 requires 串起来的：q_walk10 -> q_walk20 -> q_walk30，
   交付一个，下一个才出现。
   **判据是"交过差"（times > 0），不是"到了终态"** ——
   可重复任务交付后立刻回到 available，永远到不了 done，
   按 done 判的话它当不了任何任务的前置。

   ------------------------------------------------------------------
   现在有哪几个
   ------------------------------------------------------------------
     q_walk10 / q_walk20 / q_walk30 / q_spring / q_drink
                              神秘人的一条链（走十步 -> 二十 -> 三十 -> 看泉 -> 喝一口）
     q_patrol                 商人的可重复任务，奖励 1 株清心草
     q_herb                   商人的收集任务（3 株清心草），奖励 30 金币，
                              前置是 q_patrol

   q_patrol 和 q_herb 是第 22 轮（背包系统）加的，专门把 reward 和 collect
   各跑通一遍：**采草 -> 攒够三株 -> 交任务 -> 拿钱**。
   两个的奖励故意错开（一个给物品、一个给钱），两条路各自演示一个字段。 */

G.data.quests = [
  {
    "id": "q_walk10",
    "name": "走十步",
    "desc": "在大厅里走上十步，让这双腿先认得这块地。",
    "goal": { "type": "walk", "count": 10 },
    "giver": "npc_mystery",
    "room": "room_hall",
    "offer": "先走十步给我看看。别问为什么，走就是了。",
    "turnin": "十步。行，你至少不是那种站着不动的。"
  },
  {
    "id": "q_walk20",
    "name": "再走二十步",
    "desc": "接着走，走到二十步。",
    "goal": { "type": "walk", "count": 20 },
    "giver": "npc_mystery",
    "room": "room_hall",
    "requires": "q_walk10",
    "offer": "才十步就回来了？再走二十步。",
    "turnin": "三十步了。你的脚步声我记住了。"
  },
  {
    "id": "q_walk30",
    "name": "走三十步",
    "desc": "最后三十步。",
    "goal": { "type": "walk", "count": 30 },
    "giver": "npc_mystery",
    "room": "room_hall",
    "requires": "q_walk20",
    "offer": "最后一段。走完我就告诉你一件事。",
    "turnin": "……算了，还是不告诉你了。再去走走吧。"
  },
  {
    "id": "q_spring",
    "name": "看一眼泉水",
    "desc": "大厅左上角有一眼泉水。走过去看看。",
    "goal": { "type": "reach", "count": 1, "ev": "ev_spring" },
    "giver": "npc_mystery",
    "room": "room_hall",
    "requires": "q_walk30",
    "offer": "……走够了？那去看看那眼泉水。它在左上角。",
    "turnin": "看见了？那不是水，是这地方唯一还活着的东西。"
  },
  {
    "id": "q_drink",
    "name": "喝一口",
    "desc": "在泉水那儿喝一口。",
    "goal": { "type": "use", "count": 1, "ev": "ev_spring" },
    "giver": "npc_mystery",
    "room": "room_hall",
    "requires": "q_spring",
    "offer": "光看着不算。喝一口。",
    "turnin": "……凉的，对吧。"
  },

  {
    "id": "q_patrol",
    "name": "搭把手",
    "desc": "在杂物间里来回走上五步，替商人看着点货。",
    "goal": { "type": "walk", "count": 5 },
    "giver": "npc_merchant",
    "room": "room_right",
    "repeatable": true,
    "reward": { "items": { "itm_herb": 1 } },
    "offer": "闲着也是闲着，替我转两圈看着点货。",
    "turnin": "行，没丢东西。这个你拿着，下回还找你。"
  },

  {
    "id": "q_herb",
    "name": "三株清心草",
    "desc": "商人要三株清心草，说石缝里长的就有。攒够了拿回来。",
    "goal": { "type": "collect", "count": 3, "item": "itm_herb" },
    "giver": "npc_merchant",
    "room": "room_right",
    "requires": "q_patrol",
    "reward": { "money": { "coin": 30 } },
    "offer": "替我攒三株清心草。石缝里长的，掐断了还会再长，不难。",
    "turnin": "成色不错。钱拿着，别嫌少。"
  }
];
