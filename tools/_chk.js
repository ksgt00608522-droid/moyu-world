(function () {
  var out = [];
  out.push('G.items=' + (typeof G.items));
  out.push('G.effects=' + (typeof G.effects));
  out.push('items=' + G.data.items.length);
  out.push('kinds=' + G.data.itemKinds.length);
  out.push('money=' + G.data.moneyTypes.length);
  out.push('v=' + G.state.VERSION);
  out.push('itemLookup=' + (G.data.item('itm_purse') ? G.data.item('itm_purse').name : 'null'));
  return out.join(' | ');
})()
