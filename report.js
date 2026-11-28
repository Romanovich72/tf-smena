window.TrainingReport = (() => {
  const key='tf-noir-training-v1';
  const identityKey='tf-noir-identity-v1';
  function readHistory(){
    const stored=localStorage.getItem(key);
    if(stored===null)return [];
    const records=JSON.parse(stored);
    if(!Array.isArray(records))throw new TypeError('История звонков должна быть массивом');
    return records;
  }
  function read(){
    try{return readHistory().filter(record=>record&&record.type&&record.result)}catch{return []}
  }
  function save(record){
    try{
      const records=readHistory();
      records.push(record);
      localStorage.setItem(key,JSON.stringify(records));
      return true;
    }catch{return false}
  }
  function identity(){try{const x=JSON.parse(localStorage.getItem(identityKey)||'{}');return {name:String(x.name||''),club:String(x.club||'')}}catch{return {name:'',club:''}}}
  function saveIdentity(x){try{localStorage.setItem(identityKey,JSON.stringify({name:String(x.name||''),club:String(x.club||'')}));return true}catch{return false}}
  function summarizeHistory(rows){
    const summary={completedShifts:0,passedShifts:0,incompleteShifts:0,shiftCalls:0,legacyShiftCalls:0,practices:0};
    const shifts=new Map();
    for(const record of rows){
      if(record.type==='practice')summary.practices++;
      if(record.type!=='shift')continue;
      summary.shiftCalls++;
      if(!record.shiftId){
        summary.legacyShiftCalls++;
        continue;
      }
      if(!shifts.has(record.shiftId))shifts.set(record.shiftId,[]);
      shifts.get(record.shiftId).push(record);
    }
    for(const calls of shifts.values()){
      const size=calls[0].shiftSize;
      const complete=Number.isInteger(size)&&size>0&&
        calls.every(({shiftSize,shiftCallIndex})=>shiftSize===size&&Number.isInteger(shiftCallIndex)&&shiftCallIndex>=1&&shiftCallIndex<=size)&&
        new Set(calls.map(call=>call.shiftCallIndex)).size===size;
      if(complete){
        summary.completedShifts++;
        if(calls.every(call=>call.result.passed))summary.passedShifts++;
      }else summary.incompleteShifts++;
    }
    return summary;
  }
  function profile(type='all'){const rows=read().filter(r=>type==='all'||r.type===type);return window.TRAINING_DATA.checklist.map(c=>{const n=rows.filter(r=>r.result.scores[c.id]!==undefined);const ok=n.filter(r=>r.result.scores[c.id]===2).length;return {...c,done:ok,total:n.length,rate:n.length?Math.round(ok/n.length*100):0}})}
  function timeoutSummary(record){
    if(!record.timeouts?.length)return '';
    const stages=[...new Set(record.timeouts.map(event=>event.criterion))].join(', ');
    return `Истечения времени: ${record.timeouts.length}. Этапы: ${stages}.`;
  }
  function c1Feedback(record){
    if(record.result.scores.C1!==0)return null;
    const unavailable='Подробная причина незачёта C1 недоступна: в записи не хватает данных.';
    const answers=Array.isArray(record.answers)?record.answers:[];
    const first=answers[0];
    const greetingCompleted=Array.isArray(first?.events)&&first.events.includes('C1');
    // These IDs identify the fixed greeting variants, independently of their shuffled positions.
    const variant=typeof first?.id==='string'?first.id.match(/^(?:analyst|driver|woman|novice)-C1-([0-3])$/u)?.[1]:undefined;
    if(!Array.isArray(first?.events)||!(greetingCompleted||first.criterion==='C1'||variant)){
      const timedOut=answers.length===0&&Array.isArray(record.timeouts)&&record.timeouts.some(event=>event?.criterion==='C1');
      return {explanation:timedOut?'Звонок завершился до первой реплики менеджера.':unavailable};
    }

    const hasNameSnapshot=typeof record.nameKnown==='boolean';
    const askedName=typeof first.asksGuestName==='boolean'?first.asksGuestName
      :hasNameSnapshot&&variant?variant==='0'||variant==='2':undefined;
    const namedTurns=answers.filter(answer=>answer?.addressedGuestByName===true).length;
    const nameKnown=hasNameSnapshot?record.nameKnown:namedTurns>0?true:undefined;
    const countKnown=answers.every(answer=>typeof answer?.addressedGuestByName==='boolean');
    const greetingIssue=hasNameSnapshot&&{
      '1':'менеджер не назвал клуб и не представился',
      '2':'менеджер не представился',
      '3':'менеджер не назвал клуб'
    }[variant];

    const reasons=[greetingCompleted?'Корпоративное приветствие выполнено.'
      :greetingIssue?`Корпоративное приветствие выполнено не полностью: ${greetingIssue}.`
      :'Корпоративное приветствие выполнено не полностью.'];
    const advice=[];
    if(!greetingCompleted){
      const greetingAdvice=hasNameSnapshot&&{'2':'Представься','3':'Назови клуб'}[variant];
      const nextGreeting=greetingAdvice||'Назови клуб и представься';
      advice.push(askedName===false?`${nextGreeting} и уточни, как обращаться к гостю.`:`${nextGreeting} по корпоративному стандарту.`);
    }
    if(askedName===false){
      reasons.push('Имя клиента не было запрошено.');
      if(greetingCompleted)advice.push('Уточни, как обращаться к гостю.');
    }
    if(nameKnown===false&&askedName!==false){
      reasons.push('Имя клиента не было получено.');
      advice.push('Уточни, как обращаться к гостю.');
    }
    if(nameKnown===true){
      reasons.push('Имя клиента получено.');
      if(countKnown&&namedTurns<2){
        reasons.push(`Обращений по имени: ${namedTurns} из 2 необходимых.`);
        advice.push('Используй имя клиента естественно в ходе разговора.');
      }
    }
    if((!greetingCompleted&&!greetingIssue)||(nameKnown===undefined&&askedName!==false)||
      (nameKnown===true&&(!countKnown||(greetingCompleted&&namedTurns>=2)))){
      reasons.push(unavailable);
    }
    return {greetingCompleted,explanation:reasons.join(' '),advice:advice.join(' ')};
  }
  function text(r){const list=window.TRAINING_DATA.checklist.filter(c=>r.result.scores[c.id]===0).map(c=>{
    const entry=`• ${c.id} ${c.title}: 0/2`;
    const c1=c.id==='C1'?c1Feedback(r):null;
    return c1?[entry,`  ${c1.explanation}`,...(c1.advice?[`  ${c1.advice}`]:[])].join('\n'):`${entry}\n  Эталон: ${c.quote}`;
  });const p=r.identity||{},timing=timeoutSummary(r);return [`ТЕРРИТОРИЯ ФИТНЕСА — ${r.type==='shift'?'РАБОЧАЯ СМЕНА':'ТРЕНИРОВКА'}`,`Менеджер: ${p.name||'не указан'}`,`Клуб: ${p.club||'не указан'}`,`${r.clientName} · ${new Date(r.date).toLocaleString('ru-RU')}`,`Результат: ${r.result.total}/${2*window.TRAINING_DATA.checklist.length} · ${r.result.passed?'успешная запись':'запись не зачтена'} · ${r.outcome}`,`Доверие: ${r.trust}/100`,`Ранняя утечка цены / сухая презентация: ${r.earlyPriceLeak||r.result.earlyPriceLeak?'да':'нет'}`,...(timing?[timing]:[]),'',...(list.length?['Зоны роста:',...list]:['Все критерии выполнены.'])].join('\n')}
  return {read,save,profile,summarizeHistory,text,timeoutSummary,c1Feedback,identity,saveIdentity};
})();
