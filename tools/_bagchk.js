(async () => {
  const out = [];
  let failed = 0;
  const T = (name, cond) => {
    if (!cond) failed++;
    out.push((cond ? '  ✓ ' : '  ✗ ') + name);
  };

  const G = window.G;
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  $('create-name').value = '背包测试';
  $('create-go').click();
  await wait(300);

  const bagEl = $('bag');
  const tagOf = (id) => bagEl.querySelector('dd.item button[data-arg="' + id + '"]');

  out.push('背包块');
  T('背包是 dl#bag，不是占位 div', bagEl && bagEl.tagName === 'DL');
  T('开局背包是空的', bagEl.querySelectorAll('dd.item').length === 0);
  T('空背包给一句提示', bagEl.textContent.indexOf(G.data.t('bag.empty')) >= 0);
  T('空的时候 dl 上挂着 idle 类', /(^|\s)idle(\s|$)/.test(bagEl.className));

  G.main.submit('bag');
  T('bag 指令对空背包说一句', $('log').textContent.indexOf('身上什么也没有') >= 0);

  out.push('钱袋（唯一 + panel）');
  T('给钱袋成功', G.items.give('itm_purse', 1) === 1);
  G.ui.refresh();
  T('背包里出现一个标签', bagEl.querySelectorAll('dd.item').length === 1);
  T('标签上写的是钱袋', tagOf('itm_purse') && tagOf('itm_purse').textContent === '钱袋');
  T('唯一的物品不写数量', tagOf('itm_purse').textContent.indexOf('×') < 0);
  T('标签带分类颜色变量',
    /--item-color/.test(bagEl.querySelector('dd.item').getAttribute('style') || ''));
  T('标签走 bag 指令', tagOf('itm_purse').getAttribute('data-cmd') === 'bag');
  T('有东西之后 idle 类去掉了', !/(^|\s)idle(\s|$)/.test(bagEl.className));

  tagOf('itm_purse').click();
  T('点标签开物品详情', $('modal').hidden === false);
  T('标题是物品名', $('modal-title').textContent.indexOf('钱袋') >= 0);
  T('标题上有分类小标签', $('modal-title').textContent.indexOf('特殊') >= 0);
  T('正文有描述', $('modal-body').textContent.indexOf('一只旧布袋') >= 0);
  T('唯一的写「只有一个」', $('modal-body').textContent.indexOf('只有一个') >= 0);
  T('没有丢弃按钮', $('modal-body').textContent.indexOf('丢弃') < 0);

  const openBtn = $('modal-body').querySelector('button[data-cmd="bag"]');
  T('钱袋的按钮是「看看里面有多少」',
    openBtn && openBtn.textContent === '看看里面有多少');
  T('按钮走 bag use', openBtn && openBtn.getAttribute('data-arg') === 'use itm_purse');

  openBtn.click();
  T('换成钱包弹框（不是叠一层）', $('modal-title').textContent === '钱袋');
  T('没钱时说「里面空空的」', $('modal-body').textContent.indexOf('里面空空') >= 0);
  G.ui.closeModal();
  T('关闭之后弹框藏起来', $('modal').hidden === true);

  G.items.addMoney('coin', 30);
  G.main.exec('bag', ['use', 'itm_purse']);
  T('钱包里报出金币余额', $('modal-body').textContent.indexOf('30') >= 0);
  T('余额那一行有币种名', $('modal-body').textContent.indexOf('金币') >= 0);
  T('余额用币种颜色', /--money-color/.test($('modal-body').innerHTML));
  G.ui.closeModal();

  out.push('清心草（可堆叠 + use）');
  G.items.give('itm_herb', 3);
  G.ui.refresh();
  T('可堆叠的标签写 ×3', tagOf('itm_herb') && tagOf('itm_herb').textContent === '清心草 ×3');
  T('排序：消耗品排在特殊前面',
    bagEl.querySelectorAll('dd.item')[0].textContent.indexOf('清心草') >= 0);

  tagOf('itm_herb').click();
  T('数量写「持有 3 个」', $('modal-body').textContent.indexOf('持有 3 个') >= 0);
  const useBtn = $('modal-body').querySelector('button[data-cmd="bag"]');
  T('能用的物品按钮是「使用」', useBtn && useBtn.textContent === '使用');
  useBtn.click();
  T('用完弹框自动关掉', $('modal').hidden === true);
  T('用完数量减一', G.items.count('itm_herb') === 2);
  T('记事里写了使用那一句', $('log').textContent.indexOf('你把清心草嚼了') >= 0);
  T('挂上了状态', G.statuses.has('st_focus') === true);

  G.main.exec('bag', ['use', 'itm_herb']);
  T('bag use 跳过详情框直接吃', G.items.count('itm_herb') === 1 && $('modal').hidden === true);

  out.push('笔记本');
  T('给笔记本成功', G.items.give('itm_note', 1) === 1);
  G.quests.accept('q_walk10');
  G.quests.ensure('q_patrol').times = 2;    /* 假装交过两次差 */
  G.main.exec('bag', ['use', 'itm_note']);
  T('笔记本弹框开了', $('modal-title').textContent === '笔记本');

  const note = $('modal-body').textContent;
  T('有「进行中」一栏', note.indexOf('进行中') >= 0);
  T('有「已完成」一栏', note.indexOf('已完成') >= 0);
  T('进行中列着已接的任务', note.indexOf('走十步') >= 0);
  T('进行中报进度', note.indexOf('0 / 10') >= 0);
  T('已完成列着交过差的任务', note.indexOf('搭把手') >= 0);
  T('已完成写完成次数', note.indexOf('完成 2 次') >= 0);
  T('没接的任务不列', note.indexOf('看一眼泉水') < 0);
  G.ui.closeModal();

  out.push('错误路径');
  G.main.submit('bag 不存在的东西');
  T('找不到的物品报「没有这个指令」', $('log').textContent.indexOf('没有这个指令') >= 0);
  G.main.submit('bag 清心草');
  T('身上有的按名字能查到', $('modal').hidden === false);
  G.ui.closeModal();

  G.main.submit('bag 钱袋');
  T('按名字查也行', $('modal').hidden === false);
  G.ui.closeModal();

  out.push('');
  out.push(failed ? '失败 ' + failed + ' 条' : '全部通过');
  return out.join('\n');
})()
