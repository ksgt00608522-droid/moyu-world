(async () => {
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const G = window.G;
  $('create-name').value = '背包测试';
  $('create-go').click();
  await wait(300);
  const r = [];
  r.push('bag tag=' + $('bag').tagName + ' id=' + $('bag').id);
  r.push('before: ' + $('bag').outerHTML);
  r.push('give=' + G.items.give('itm_purse', 1));
  r.push('count=' + G.items.count('itm_purse'));
  r.push('list=' + JSON.stringify(G.items.list().map(x => x.def.id + ':' + x.count)));
  G.ui.refresh();
  r.push('after: ' + $('bag').outerHTML);
  return r.join('\n');
})()
