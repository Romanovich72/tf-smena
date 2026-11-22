window.TrainingReport = (() => {
  const key='tf-noir-training-v1';
  const identityKey='tf-noir-identity-v1';
  function read(){try{const x=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(x)?x.filter(v=>v&&v.type&&v.result):[]}catch{return[]}}
  function save(record){const all=read();all.push(record);try{localStorage.setItem(key,JSON.stringify(all));return true}catch{return false}}
  function identity(){try{const x=JSON.parse(localStorage.getItem(identityKey)||'{}');return {name:String(x.name||''),club:String(x.club||'')}}catch{return {name:'',club:''}}}
  function saveIdentity(x){try{localStorage.setItem(identityKey,JSON.stringify({name:String(x.name||''),club:String(x.club||'')}));return true}catch{return false}}
  function profile(type='all'){const rows=read().filter(r=>type==='all'||r.type===type);return window.TRAINING_DATA.checklist.map(c=>{const n=rows.filter(r=>r.result.scores[c.id]!==undefined);const ok=n.filter(r=>r.result.scores[c.id]===2).length;return {...c,done:ok,total:n.length,rate:n.length?Math.round(ok/n.length*100):0}})}
  function text(r){const list=window.TRAINING_DATA.checklist.filter(c=>r.result.scores[c.id]===0).map(c=>`• ${c.id} ${c.title}: 0/2\n  Эталон: ${c.quote}`);const p=identity();return [`ТЕРРИТОРИЯ ФИТНЕСА — ${r.type==='shift'?'РАБОЧАЯ СМЕНА':'ТРЕНИРОВКА'}`,`Менеджер: ${p.name||'не указан'}`,`Клуб: ${p.club||'не указан'}`,`${r.clientName} · ${new Date(r.date).toLocaleString('ru-RU')}`,`Результат: ${r.result.total}/20 · ${r.result.passed?'успешная запись':'запись не зачтена'} · ${r.outcome}`,`Доверие: ${r.trust}/100`,`Ранняя утечка цены / сухая презентация: ${r.earlyPriceLeak||r.result.earlyPriceLeak?'да':'нет'}`,'',...(list.length?['Зоны роста:',...list]:['Все критерии выполнены.'])].join('\n')}
  return {read,save,profile,text,identity,saveIdentity};
})();
