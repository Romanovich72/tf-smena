const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApp(pressure, storage = new Map([['tf-noir-pressure-v1', String(pressure)]]), faults = {}) {
  const intervals = new Map();
  const tones = [];
  let nextInterval = 0;
  let buttons = new Map();
  let html = '';
  let clip = '';
  const temporaryFields=new Set();
  const node = key => {
    if (!buttons.has(key)) buttons.set(key, {setAttribute(){},focus(){this.focused=true},select(){this.selected=true}});
    return buttons.get(key);
  };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; buttons = new Map(); },
    querySelector: node,
    querySelectorAll: selector => ({
      '[data-go]': [Object.assign(node('home'), {dataset:{go:'home'}}), Object.assign(node('profile'), {dataset:{go:'profile'}})],
      '[data-client]': ['analyst','driver','woman','novice'].map(client=>Object.assign(node(client), {dataset:{client}})),
      '[data-filter]': ['all','shift','practice'].map(filter=>Object.assign(node('filter-'+filter), {dataset:{filter}})),
      '.choices .answer': [0,1,2,3].map(node)
    })[selector] || []
  };
  const document={
    querySelector:()=>root,
    createElement:()=>({style:{},select(){this.selected=true},remove(){temporaryFields.delete(this)}}),
    body:{append:field=>temporaryFields.add(field)}
  };
  if(faults.fallback){
    document.execCommand=command=>{
      assert.equal(command,'copy');
      const result=faults.fallback();
      if(result===true)clip=[...temporaryFields].find(field=>field.selected).value;
      return result;
    };
  }
  const env = {
    structuredClone, document,
    localStorage:{
      getItem(key){faults.beforeRead?.(key);return storage.get(key)??null},
      setItem(key,value){faults.beforeWrite?.(key,value);storage.set(key,value)},
      removeItem:key=>storage.delete(key)
    },
    confirm:()=>true,
    navigator:faults.clipboardUnavailable?{}:{clipboard:{writeText:async text=>{await faults.clipboard?.();clip=text}}},
    setInterval(callback, ms) { assert.equal(ms,1000); intervals.set(++nextInterval,callback); return nextInterval; },
    clearInterval:id=>intervals.delete(id),
    AudioContext:class {
      currentTime=0;
      destination={};
      createOscillator() { return {frequency:{setValueAtTime:hz=>tones.push(hz)},connect(){},start(){},stop(){}}; }
      createGain() { return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}; }
    }
  };
  env.window=env;
  vm.createContext(env);
  for(const file of ['scenarios','engine','report','app']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file+'.js'),'utf8'),env,{filename:file+'.js'});
  }
  let stage;
  const options=env.TrainingEngine.options;
  env.TrainingEngine.options=session=>stage=options(session);
  if (faults.practiceOpening !== undefined) {
    const start=env.TrainingEngine.start;
    env.TrainingEngine.start=(client,mode,index)=>start(client,mode,index??(client.id===(faults.practiceClient??'analyst')?faults.practiceOpening:null));
  }
  const click=key=>node(key).onclick({preventDefault(){},currentTarget:node(key)});
  const choose=(kind='correct')=>{
    const index=stage.answers.findIndex(a=>typeof kind==='function'?kind(a):kind==='rough'?a.rough:kind==='correct'?a.events.includes(stage.criterion):!a.events.length&&!a.rough);
    assert.ok(index>=0);
    click(index);
  };
  const tick=count=>{
    for(let i=0;i<count;i++){
      assert.equal(intervals.size,1);
      intervals.values().next().value();
    }
  };
  return {click,choose,tick,intervals,tones,node,root,storage,temporaryFields,history:()=>JSON.parse(storage.get('tf-noir-training-v1')||'[]'),clipboard:()=>clip,
    report:env.TrainingReport,
    setIdentity(name,club){node('#managerName').value=name;node('#managerClub').value=club;node('#managerName').oninput()},
    completeCall(){for(let i=0;i<10;i++)choose()},
    practice(client='analyst'){click('#free');click(client)}};
}

test('Заметки в силовой ветке показывают только раскрытые факты и сохраняются при переигрывании',()=>{
  const app=loadApp(false, undefined, {practiceOpening:2});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.practice();
  app.choose();
  app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose('soft'); // C3: do not reveal the experience.
  assert.doesNotMatch(notes(),/стойк|бассейн|выносливость/u);
  app.choose();
  assert.match(notes(),/вернуть силу и постепенно набрать выносливость/u);
  assert.doesNotMatch(notes(),/стойк|бассейн/u);
  app.choose();
  assert.match(app.root.innerHTML,/Life Fitness.*Concept2/u);
  for(let move=0;move<5;move++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,2);
  assert.equal(record.result.total,18);
  app.click('#replay');
  assert.match(app.root.innerHTML,/выбираю между двумя клубами/u);
  assert.match(notes(),/Фиксируйте важные детали/u);
});

test('Семейные заметки раскрываются по очереди, звонок повторяется, смена с ним даёт 80/80',async()=>{
  const app=loadApp(false,undefined,{practiceOpening:3});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.practice();
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/перестал из-за семейного графика/u);
  assert.doesNotMatch(notes(),/без лишних разъездов|Сын 8 лет/u);
  app.choose();
  assert.match(notes(),/без лишних разъездов/u);
  assert.doesNotMatch(notes(),/Сын 8 лет/u);
  app.choose();
  assert.match(notes(),/Сын 8 лет, интересуется плаванием/u);
  assert.doesNotMatch(notes(),/супруг/u);
  for(let i=0;i<5;i++)app.choose();
  assert.equal(app.history()[0].contextIndex,3);
  assert.equal(app.history()[0].result.total,20);
  app.click('#replay');
  assert.match(app.root.innerHTML,/Рассматриваю ваш фитнес-клуб/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home');
  app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(record=>record.clientId)).size,4);
  assert.equal(shift.find(record=>record.clientId==='analyst').contextIndex,3);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/);
});

test('Обеденная ветка показывает только известные заметки, переигрывается и входит в смену 80/80',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'driver',practiceOpening:2});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.setIdentity('Марина','Люблино');
  app.practice('driver');
  assert.match(app.root.innerHTML,/Территория Фитнеса Люблино, менеджер Марина/u);
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/Раньше занимался силовыми/u);
  assert.doesNotMatch(notes(),/Работает рядом|компьютером/u);
  app.choose();
  assert.match(notes(),/Около часа вместе с дорогой/u);
  assert.doesNotMatch(notes(),/компьютером/u);
  app.choose();
  assert.match(notes(),/Планирует посещать клуб один.*после работы за компьютером/u);
  for(let i=0;i<5;i++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,2);
  assert.equal(record.result.total,20);
  assert.equal(record.answers.at(-1).visitAgreement,'confirmed');
  app.click('#replay');
  assert.match(app.root.innerHTML,/коротко, я сейчас на работе/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home'); app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(call=>call.clientId)).size,4);
  assert.equal(shift.find(call=>call.clientId==='driver').contextIndex,2);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/);
});

test('Вечерняя ветка Максима раскрывает заметки и сохраняет контекст в звонке и смене',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'driver',practiceOpening:3});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.setIdentity('Марина','Люблино');
  app.practice('driver');
  assert.match(app.root.innerHTML,/Территория Фитнеса Люблино, менеджер Марина/u);
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/Раньше регулярно посещал бассейн/u);
  assert.doesNotMatch(notes(),/плавать и отдыхать|19:00/u);
  app.choose();
  assert.match(notes(),/Хочет плавать и отдыхать/u);
  assert.doesNotMatch(notes(),/19:00/u);
  app.choose();
  assert.match(notes(),/Планирует посещать клуб один.*после 19:00/u);
  for(let i=0;i<5;i++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,3);
  assert.equal(record.result.total,20);
  assert.match(record.answers.at(-1).reply,/^Да, завтра в 19:30/u);
  assert.equal(record.answers.at(-1).visitAgreement,'confirmed');
  app.click('#replay');
  assert.match(app.root.innerHTML,/давайте коротко, времени немного/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home'); app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(call=>call.clientId)).size,4);
  assert.equal(shift.find(call=>call.clientId==='driver').contextIndex,3);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Марина · Клуб: Люблино/u);
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/u);
});

test('Групповые занятия Елены раскрывают заметки, переигрываются и дают смену 80/80',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'woman',practiceOpening:2});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.setIdentity('Марина','Люблино');
  app.practice('woman');
  assert.match(app.root.innerHTML,/Территория Фитнеса Люблино, менеджер Марина/u);
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/Раньше посещала Pilates/u);
  assert.doesNotMatch(notes(),/подвижность|подругой/u);
  app.choose();
  assert.match(notes(),/Предпочитает невысокую интенсивность/u);
  assert.doesNotMatch(notes(),/подругой/u);
  app.choose();
  assert.match(notes(),/Возможно, будет посещать с подругой/u);
  for(let i=0;i<5;i++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,2);
  assert.equal(record.result.total,20);
  assert.match(record.answers.at(-1).reply,/^Да, завтра в 19:00 удобно\. Уточню у подруги/u);
  assert.equal(record.answers.at(-1).visitAgreement,'confirmed');
  app.click('#replay');
  assert.match(app.root.innerHTML,/Хотела бы уточнить, какие групповые программы/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home'); app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(call=>call.clientId)).size,4);
  assert.equal(shift.find(call=>call.clientId==='woman').contextIndex,2);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Марина · Клуб: Люблино/u);
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/u);
});

test('Персональный тренинг Елены раскрывает заметки, переигрывается и даёт смену 80/80',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'woman',practiceOpening:3});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.setIdentity('Марина','Люблино');
  app.practice('woman');
  assert.match(app.root.innerHTML,/Территория Фитнеса Люблино, менеджер Марина/u);
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/Раньше занималась с персональным тренером/u);
  assert.doesNotMatch(notes(),/стать сильнее|будние дни/u);
  app.choose();
  assert.match(notes(),/Хочет стать сильнее и улучшить форму/u);
  assert.doesNotMatch(notes(),/будние дни/u);
  app.choose();
  assert.match(notes(),/Планирует посещать клуб одна.*вечером в будние дни/u);
  for(let i=0;i<5;i++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,3);
  assert.equal(record.result.total,20);
  assert.match(record.answers.at(-1).reply,/^Да, в понедельник в 19:00 удобно/u);
  assert.equal(record.answers.at(-1).visitAgreement,'confirmed');
  app.click('#replay');
  assert.match(app.root.innerHTML,/сколько сейчас стоит годовая карта/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home'); app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(call=>call.clientId)).size,4);
  assert.equal(shift.find(call=>call.clientId==='woman').contextIndex,3);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Марина · Клуб: Люблино/u);
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/u);
});

test('Ветка снижения веса Ильи раскрывает заметки, переигрывается и входит в смену 80/80',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'novice',practiceOpening:2});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.setIdentity('Марина','Люблино');
  app.practice('novice');
  assert.match(app.root.innerHTML,/Территория Фитнеса Люблино, менеджер Марина/u);
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/Пробовал заниматься дома/u);
  assert.doesNotMatch(notes(),/снизить вес|посещать клуб один/u);
  app.choose();
  assert.match(notes(),/Хочет снизить вес, стать выносливее и энергичнее/u);
  assert.doesNotMatch(notes(),/посещать клуб один/u);
  app.choose();
  assert.match(notes(),/Планирует посещать клуб один/u);
  for(let i=0;i<5;i++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,2);
  assert.equal(record.result.total,20);
  assert.match(record.answers.at(-1).reply,/Да, завтра смогу\. В 18:30 удобно/u);
  assert.equal(record.answers.at(-1).visitAgreement,'confirmed');
  app.click('#replay');
  assert.match(app.root.innerHTML,/Я раньше особо не занимался/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home'); app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(call=>call.clientId)).size,4);
  assert.equal(shift.find(call=>call.clientId==='novice').contextIndex,2);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Марина · Клуб: Люблино/u);
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/u);
});

test('Силовой сценарий Ильи сохраняет заметки, контекст переигрывания и отчёт смены',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'novice',practiceOpening:3});
  const notes=()=>app.root.innerHTML.match(/<aside class="dossier">(.*?)<\/aside>/u)[1];
  app.setIdentity('Марина','Люблино');
  app.practice('novice');
  assert.match(app.root.innerHTML,/Территория Фитнеса Люблино, менеджер Марина/u);
  app.choose(); app.choose();
  assert.match(notes(),/Фиксируйте важные детали/u);
  app.choose();
  assert.match(notes(),/Занимался дома с гантелями по видео/u);
  assert.doesNotMatch(notes(),/мышечную массу|будет заниматься с другом/u);
  app.choose();
  assert.match(notes(),/набрать мышечную массу, стать сильнее и видеть прогресс/u);
  assert.doesNotMatch(notes(),/будет заниматься с другом/u);
  app.choose();
  assert.match(notes(),/Возможно, будет заниматься с другом. Друг пока не определился/u);
  for(let i=0;i<5;i++)app.choose();
  const [record]=app.history();
  assert.equal(record.contextIndex,3);
  assert.equal(record.result.total,20);
  assert.match(record.answers.at(-1).reply,/18:30 смогу.*Другу тоже предложу/u);
  assert.equal(record.answers.at(-1).visitAgreement,'confirmed');
  await app.click('#copy');
  assert.match(app.clipboard(),/20\/20/u);
  app.click('#replay');
  assert.match(app.root.innerHTML,/сколько стоит карта\? Хочу попробовать заниматься в тренажёрном зале/u);
  assert.match(notes(),/Фиксируйте важные детали/u);

  app.click('home'); app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const shift=app.history().slice(1);
  assert.equal(new Set(shift.map(call=>call.clientId)).size,4);
  assert.equal(shift.find(call=>call.clientId==='novice').contextIndex,3);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Марина · Клуб: Люблино/u);
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/u);
});

const c1Card=app=>app.root.innerHTML.match(/<h3>C1 · [\s\S]*?<\/article>/u)?.[0];

test('Правильное приветствие остаётся контекстом при одном обращении у Максима и Елены',async()=>{
  for(const clientId of ['driver','woman']){
    const app=loadApp(false,undefined,{practiceClient:clientId,practiceOpening:1});
    app.practice(clientId);
    for(let i=0;i<10;i++)app.choose(i===3?a=>a.id.endsWith('-C4-2'):'correct');
    const [record]=app.history();
    assert.equal(record.result.scores.C1,0);
    assert.equal(record.nameKnown,true);
    assert.equal(record.answers.filter(a=>a.addressedGuestByName).length,1);
    const card=c1Card(app);
    assert.match(card,/Приветствие в звонке:<\/b> Территория Фитнеса.*менеджер Анастасия/u);
    assert.match(card,/Корпоративное приветствие выполнено\. Имя клиента получено\. Обращений по имени: 1 из 2 необходимых\./u);
    assert.match(card,/Используй имя клиента естественно в ходе разговора/u);
    assert.doesNotMatch(card,/Почему это ошибка|Эталон из методички/u);
    await app.click('#copy');
    assert.match(app.clipboard(),/C1 Приветствие и имя: 0\/2\n  Корпоративное приветствие выполнено\..*Обращений по имени: 1 из 2 необходимых/u);
    assert.doesNotMatch(app.clipboard(),/C1 Приветствие и имя: 0\/2\n  Эталон:/u);
  }
});

test('C1 различает незапрошенное имя и недочёты представления',()=>{
  for(const [variant,omission,askedName] of [
    [1,'менеджер не назвал клуб и не представился',false],
    [2,'менеджер не представился',true],
    [3,'менеджер не назвал клуб',false]
  ]){
    const app=loadApp(false,undefined,{practiceOpening:1});
    app.practice();
    app.choose(a=>a.id===`analyst-C1-${variant}`);
    for(let i=1;i<10;i++)app.choose();
    const [record]=app.history();
    assert.equal(record.result.scores.C1,0);
    assert.equal(record.nameKnown,askedName);
    const card=c1Card(app);
    assert.ok(card.includes(`Корпоративное приветствие выполнено не полностью: ${omission}.`));
    if(askedName){
      assert.match(card,/Имя клиента получено/u);
      assert.doesNotMatch(card,/Имя клиента не было запрошено|Обращений по имени:/u);
    }else{
      assert.match(card,/Имя клиента не было запрошено/u);
      assert.doesNotMatch(card,/Обращений по имени:|Имя клиента не было получено/u);
    }
  }
});

test('C1 с нулём обращений объясняется, а при зачёте предупреждения нет',()=>{
  const timed=loadApp(true,undefined,{practiceOpening:1});
  timed.practice();
  timed.choose();
  timed.tick(33*5);
  const [incomplete]=timed.history();
  assert.equal(incomplete.answers.length,1);
  assert.equal(incomplete.result.scores.C1,0);
  assert.equal(incomplete.nameKnown,true);
  assert.match(c1Card(timed),/Имя клиента получено\. Обращений по имени: 0 из 2/u);

  const app=loadApp(false,undefined,{practiceOpening:1});
  app.practice();
  app.completeCall();
  const [record]=app.history();
  assert.equal(record.result.scores.C1,2);
  assert.ok(record.answers.filter(a=>a.addressedGuestByName).length>=2);
  assert.equal(c1Card(app),undefined);
  assert.equal(app.report.c1Feedback(record),null);
});

test('C1 в старых отчётах сообщает о недостающих данных без пересчёта истории',()=>{
  const summaries=[
    {type:'practice',clientName:'Максим',result:{scores:{C1:0},total:18}},
    {type:'practice',clientName:'Елена',result:{scores:{C1:0},total:18},answers:[
      {criterion:'C1',events:['C1'],asksGuestName:true,text:'Приветствие'},
      {criterion:'C2',addressedGuestByName:true,text:'Выбранный ответ'}
    ]},
    {type:'practice',clientName:'Алексей',result:{scores:{C1:0},total:18},answers:[
      {events:['C1'],asksGuestName:true,addressedGuestByName:false,text:'Приветствие'},
      {addressedGuestByName:true,text:'Выбранный ответ'}
    ]}
  ];
  const original=JSON.stringify(summaries);
  const storage=new Map([['tf-noir-training-v1',original]]);
  const app=loadApp(false,storage);
  const [missing,partial,available]=app.report.read();
  for(const summary of [missing,partial]){
    const detail=app.report.c1Feedback(summary);
    assert.match(detail.explanation,/Подробная причина незачёта C1 недоступна/u);
    assert.match(app.report.text(summary),/C1 Приветствие и имя: 0\/2[\s\S]*Подробная причина незачёта C1 недоступна/u);
    assert.doesNotMatch(detail.explanation,/Обращений по имени:|менеджер не представился/u);
  }
  assert.match(app.report.c1Feedback(available).explanation,/Корпоративное приветствие выполнено\. Имя клиента получено\. Обращений по имени: 1 из 2/u);
  assert.equal(storage.get('tf-noir-training-v1'),original);
});

test('Смена показывает и копирует причину незачёта C1 отдельно для нужного клиента',async()=>{
  const app=loadApp(false,undefined,{practiceClient:'driver',practiceOpening:1});
  app.click('#shift');
  for(let call=0;call<4;call++){
    const isDriver=app.root.innerHTML.includes('ТОРОПЫГА ЗА РУЛЁМ');
    for(let i=0;i<10;i++)app.choose(isDriver&&i===3?a=>a.id==='driver-C4-2':'correct');
  }
  assert.match(app.root.innerHTML,/76<small> \/ 80/u);
  assert.match(c1Card(app),/Обращений по имени: 1 из 2 необходимых/u);
  await app.click('#copy');
  const lines=app.clipboard().split('\n');
  const withExplanation=lines.filter(line=>line.includes('Обращений по имени'));
  assert.equal(withExplanation.length,1);
  assert.match(withExplanation[0],/^Торопыга за рулём: 16\/20.*C1: Корпоративное приветствие выполнено/u);
  assert.match(lines.join('\n'),/Итого 76\/80 · смена не зачтена/u);
});

test('Таймер — отдельные события, один интервал и одна запись после обрыва', async()=>{
  const app=loadApp(true);
  app.click('#shift');
  app.tick(32);
  assert.equal(app.node('#timer').textContent,'1');
  app.tick(1);
  assert.match(app.root.innerHTML,/очень ограничен/);
  app.tick(33);
  const staleTick=app.intervals.values().next().value;
  const staleClick=app.node(0).onclick;
  app.tick(99);
  assert.match(app.root.innerHTML,/ЗВОНОК 2 ИЗ 4/);
  staleTick();
  staleClick();
  const [first]=app.history();
  assert.equal(app.history().length,1);
  assert.equal(first.outcome,'hangup');
  assert.equal(first.answers.length,0);
  assert.deepEqual(first.timeouts,[50,42,34,26,18].map(trustBefore=>({criterion:'C1',trustBefore,trustAfter:trustBefore-8})));
  for(let call=0;call<3;call++)for(let move=0;move<10;move++)app.choose();
  assert.equal(app.intervals.size,0);
  assert.equal(app.history().length,4);
  assert.ok(app.history().slice(1).every(record=>!('timeouts' in record)));
  assert.match(app.root.innerHTML,/Истечения времени: 5\. Этапы: C1\./);
  await app.click('#copy');
  assert.match(app.clipboard(),/Истечения времени: 5\. Этапы: C1\./);
  assert.equal(app.clipboard().split('Истечения времени').length,2);
  app.click('#again');
  assert.equal(app.intervals.size,1);
  const beforeNavigation=app.intervals.values().next().value;
  app.click('profile');
  assert.equal(app.intervals.size,0);
  for(let i=0;i<33;i++)beforeNavigation();
  assert.equal(app.history().length,4);
  app.click('home');
  app.practice();
  for(let i=0;i<10;i++)app.choose();
  app.click('#replay');
  assert.equal(app.intervals.size,1);
  app.click('home');
  assert.equal(app.intervals.size,0);
});

test('В звонке звук нейтрален, оценки слышны в микроотработке',()=>{
  const app=loadApp(false);
  const tones=()=>app.tones.splice(0);
  app.click('#shift');
  app.choose();assert.deepEqual(tones(),[880]);
  app.choose('soft');assert.deepEqual(tones(),[880]);
  app.click('home');app.practice();
  app.choose();assert.deepEqual(tones(),[880]);
  app.choose('soft');assert.deepEqual(tones(),[880]);
  assert.equal(app.intervals.size,0);
  app.click('home');app.practice();
  for(let i=0;i<9;i++)app.choose();
  tones();app.choose();assert.deepEqual(tones(),[523,659,784]);
  app.click('#replay');
  app.choose('rough');tones();app.choose('rough');assert.deepEqual(tones(),[440,330,220]);
  app.click('profile');
  app.click('#weakDrill');
  app.choose();assert.deepEqual(tones(),[740,980]);
  app.click('#nextDrill');app.choose('soft');assert.deepEqual(tones(),[175]);
  app.click('#nextDrill');app.click('#soundToggle');app.choose();
  assert.deepEqual(tones(),[]);
  assert.equal(app.storage.get('tf-noir-sound-v1'),'false');
  app.click('#nextDrill');
  assert.match(app.root.innerHTML,/MICRO-DRILL · ЗАВЕРШЕНО/);
});

const historyKey='tf-noir-training-v1';
const identityKey='tf-noir-identity-v1';
const legacyCall={
  type:'shift',clientId:'analyst',clientName:'Аналитик',date:'2026-11-01T09:00:00.000Z',
  outcome:'iron',trust:74,earlyPriceLeak:false,answers:[],
  result:{outcome:'iron',passed:true,total:20,earlyPriceLeak:false,scores:Object.fromEntries(Array.from({length:10},(_,i)=>['C'+(i+1),2]))}
};
const savedHistory=app=>JSON.parse(JSON.stringify(app.report.summarizeHistory(app.history())));

test('Профиль группирует две полные, одну незавершённую и одну незачтённую смену', async()=>{
  const app=loadApp(false,new Map([[historyKey,JSON.stringify([legacyCall])],[identityKey,JSON.stringify({name:'Анна',club:'Южное Бутово'})]]));
  app.click('#shift');
  app.completeCall();
  app.report.saveIdentity({name:'Дмитрий',club:'Люблино'});
  for(let i=0;i<3;i++)app.completeCall();
  const first=app.history().slice(1,5);
  assert.equal(new Set(first.map(record=>record.shiftId)).size,1);
  assert.ok(first[0].shiftId);
  assert.deepEqual(first.map(record=>record.shiftCallIndex),[1,2,3,4]);
  assert.ok(first.every(record=>record.shiftSize===4 && record.identity.name==='Анна'&&record.identity.club==='Южное Бутово'));
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Анна · Клуб: Южное Бутово/);
  assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/);
  app.click('#profile');
  assert.match(app.root.innerHTML,/<b>1<\/b><span>ЗАВЕРШЁННЫЕ СМЕНЫ/);
  assert.equal(savedHistory(app).shiftCalls-savedHistory(app).legacyShiftCalls,4);

  app.click('home');
  app.setIdentity('Дмитрий','Люблино');
  app.click('#shift');
  for(let i=0;i<4;i++)app.completeCall();
  const second=app.history().slice(5,9);
  assert.ok(second.every(record=>record.shiftId===second[0].shiftId && record.identity.name==='Дмитрий'));
  assert.notEqual(second[0].shiftId,first[0].shiftId);
  assert.match(app.root.innerHTML,/>80<small> \/ 80/);
  app.click('#profile');
  assert.match(app.root.innerHTML,/<b>2<\/b><span>ЗАВЕРШЁННЫЕ СМЕНЫ/);
  assert.equal(savedHistory(app).shiftCalls-savedHistory(app).legacyShiftCalls,8);
  app.click('home');
  app.click('#shift');
  app.completeCall();app.completeCall();
  app.click('profile');
  const partial=app.history().slice(9);
  assert.equal(partial.length,2);
  assert.equal(partial[0].shiftId,partial[1].shiftId);
  assert.deepEqual(savedHistory(app),{completedShifts:2,passedShifts:2,incompleteShifts:1,shiftCalls:11,legacyShiftCalls:1,practices:0});
  assert.match(app.root.innerHTML,/<b>11<\/b><span>ВСЕГО ПОПЫТОК/);
  assert.match(app.root.innerHTML,/Звонки рабочих смен — 11.*Незавершённые смены — 1/);
  assert.match(app.root.innerHTML,/Старые звонки без привязки к смене — 1/);
  app.click('home');app.click('#shift');
  app.choose('rough');app.choose('rough');
  assert.match(app.root.innerHTML,/ЗВОНОК 2 ИЗ 4/);
  for(let i=0;i<3;i++)app.completeCall();
  const mixed=app.history().slice(11);
  assert.equal(mixed.length,4);
  assert.equal(mixed[0].outcome,'hangup');
  assert.notEqual(mixed[0].shiftId,partial[0].shiftId);
  assert.ok(mixed.every(record=>record.shiftId===mixed[0].shiftId));
  assert.match(app.root.innerHTML,/>60<small> \/ 80/);
  assert.match(app.root.innerHTML,/НЕ ЗАСЧИТАНО/);
  assert.deepEqual(savedHistory(app),{completedShifts:3,passedShifts:2,incompleteShifts:1,shiftCalls:15,legacyShiftCalls:1,practices:0});
  assert.deepEqual(app.history()[0],legacyCall);
});

test('Исторический отчёт использует снимок идентификации, фильтры сохраняют старую историю', async()=>{
  const storage=new Map([[historyKey,JSON.stringify([legacyCall])]]);
  const app=loadApp(false,storage);
  app.setIdentity('Анна','Южное Бутово');
  app.practice();app.completeCall();
  app.click('home');app.setIdentity('Дмитрий','Люблино');
  app.practice();app.completeCall();
  const [old,first,second]=app.history();
  assert.deepEqual(first.identity,{name:'Анна',club:'Южное Бутово'});
  assert.deepEqual(second.identity,{name:'Дмитрий',club:'Люблино'});
  assert.ok([first,second].every(record=>record.type==='practice' && !('shiftId' in record)));
  assert.match(app.report.text(first),/Менеджер: Анна\nКлуб: Южное Бутово/);
  assert.match(app.report.text(second),/Менеджер: Дмитрий\nКлуб: Люблино/);
  assert.match(app.report.text(old),/Менеджер: не указан\nКлуб: не указан/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Дмитрий\nКлуб: Люблино/);
  app.click('#replay');app.completeCall();
  assert.equal(app.history().at(-1).type,'practice');
  assert.equal(app.history().at(-1).shiftId,undefined);

  const reloaded=loadApp(false,storage);
  reloaded.click('profile');
  assert.deepEqual(reloaded.history()[0],legacyCall);
  assert.equal(reloaded.report.profile('all')[0].total,4);
  assert.equal(reloaded.report.profile('shift')[0].total,1);
  assert.equal(reloaded.report.profile('practice')[0].total,3);
  for(const filter of ['shift','practice','all']){
    reloaded.click('filter-'+filter);
    assert.match(reloaded.root.innerHTML,new RegExp('data-filter="'+filter+'" class="selected"'));
  }
  reloaded.click('#weakDrill');
  for(let i=0;i<3;i++){reloaded.choose();reloaded.click('#nextDrill')}
  assert.equal(reloaded.history().length,4);
  reloaded.click('#toProfile');
  reloaded.click('#clear');
  assert.deepEqual(reloaded.history(),[]);
  assert.equal(storage.has(historyKey),false);
  assert.equal(storage.has(identityKey),true);
});

test('Повторный порядковый номер не заменяет пропущенный звонок',()=>{
  const app=loadApp(false);
  const group=[1,2,2,4].map(shiftCallIndex=>({...legacyCall,shiftId:'duplicate',shiftSize:4,shiftCallIndex}));
  assert.equal(app.report.summarizeHistory(group).incompleteShifts,1);
  assert.equal(app.report.summarizeHistory(group).completedShifts,0);
  assert.equal(app.report.summarizeHistory([...group,{...group[0],shiftCallIndex:3}]).completedShifts,1);
});

test('При отказе записи итог, разбор, отчёт и переигрывание берутся из текущего звонка',async()=>{
  const old={...legacyCall,type:'practice',clientId:'driver',clientName:'СТАРЫЙ КЛИЕНТ',identity:{name:'Старый менеджер',club:'Старый клуб'}};
  const raw=JSON.stringify([old]);
  const storage=new Map([[historyKey,raw]]);
  const app=loadApp(false,storage,{beforeWrite:key=>{
    if(key===historyKey)throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});
  }});
  app.setIdentity('Анна','Южное Бутово');
  app.practice();app.completeCall();
  assert.match(app.root.innerHTML,/>20<small> \/ 20/);
  assert.match(app.root.innerHTML,/Душный скептик \/ Аналитик/);
  assert.match(app.root.innerHTML,/Результат не удалось сохранить в историю браузера/);
  assert.doesNotMatch(app.root.innerHTML,/СТАРЫЙ КЛИЕНТ/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Менеджер: Анна\nКлуб: Южное Бутово/);
  assert.match(app.clipboard(),/Душный скептик \/ Аналитик[\s\S]*Результат: 20\/20/);
  assert.doesNotMatch(app.clipboard(),/Старый менеджер|СТАРЫЙ КЛИЕНТ/);
  app.click('#replay');
  assert.match(app.root.innerHTML,/ДУШНЫЙ СКЕПТИК \/ АНАЛИТИК/);
  for(let i=0;i<7;i++)app.choose();
  app.choose(answer=>answer.earlyLeakKind==='price');
  app.choose();app.choose();
  assert.match(app.root.innerHTML,/Что ты выбрал:[\s\S]*89 100/);
  await app.click('#copy');
  assert.match(app.clipboard(),/Результат: 18\/20[\s\S]*ранняя утечка цены: да/i);
  assert.equal(storage.get(historyKey),raw);
  assert.match(app.report.text(old),/Менеджер: Старый менеджер\nКлуб: Старый клуб/);
});

test('Частичный и полный отказ записи смены сохраняют фактический итог и состав отчёта',async()=>{
  let failure='second';
  const attempted=[];
  const storage=new Map([[historyKey,JSON.stringify([legacyCall])]]);
  const app=loadApp(false,storage,{beforeWrite:(key,value)=>{
    if(key!==historyKey)return;
    const record=JSON.parse(value).at(-1);
    attempted.push(record.shiftId);
    if(failure==='all'||(failure==='second'&&record.shiftCallIndex===2))throw new Error('write failed');
  }});
  app.click('#shift');
  const play=()=>{for(let i=0;i<4;i++)app.completeCall()};
  const check=async count=>{
    assert.match(app.root.innerHTML,/>80<small> \/ 80/);
    assert.match(app.root.innerHTML,/outcome good/);
    assert.equal((app.root.innerHTML.match(/<strong>20\/20<\/strong>/g)||[]).length,4);
    await app.click('#copy');
    assert.equal((app.clipboard().match(/20\/20 · /g)||[]).length,4);
    assert.match(app.clipboard(),/Итого 80\/80 · смена зачтена/);
    if(count){
      assert.ok(app.root.innerHTML.includes('Не удалось сохранить в историю '+count+' из 4 звонков'));
      assert.ok(app.clipboard().includes('Не сохранено в истории браузера: '+count+' из 4 звонков'));
    }else{
      assert.doesNotMatch(app.root.innerHTML,/Не удалось сохранить в историю/);
      assert.doesNotMatch(app.clipboard(),/Не сохранено в истории/);
    }
  };
  play();await check(1);
  assert.deepEqual(app.history().slice(1).map(record=>record.shiftCallIndex),[1,3,4]);
  assert.equal(savedHistory(app).completedShifts,0);
  assert.equal(savedHistory(app).incompleteShifts,1);
  app.click('#again');
  failure='all';
  play();await check(4);
  assert.equal(app.history().length,4);
  app.click('#again');
  failure=null;
  play();await check(0);
  assert.equal(app.history().length,8);
  assert.equal(savedHistory(app).completedShifts,1);
  assert.deepEqual(app.history()[0],legacyCall);
  assert.equal(new Set(attempted).size,3);
});

test('Недоступная или повреждённая история не перезаписывается',()=>{
  for(const [raw,readError] of [[JSON.stringify([legacyCall]),'SecurityError'],['[{',null],['{}',null],['',null]]){
    const storage=new Map([[historyKey,raw]]);
    let writes=0;
    const app=loadApp(false,storage,{
      beforeRead:key=>{if(key===historyKey&&readError)throw Object.assign(new Error('read blocked'),{name:readError})},
      beforeWrite:key=>{if(key===historyKey)writes++}
    });
    app.practice();app.completeCall();
    assert.match(app.root.innerHTML,/>20<small> \/ 20/);
    assert.match(app.root.innerHTML,/Результат не удалось сохранить/);
    assert.equal(storage.get(historyKey),raw);
    assert.equal(writes,0);
  }
});

test('Подтверждение копирования зависит от результата API, при отказе выделяется ручной отчёт',async()=>{
  const rejected=async()=>{throw new Error('Clipboard denied')};
  const cases=[
    [{},true],
    [{clipboardUnavailable:true,fallback:()=>true},true],
    [{clipboard:rejected,fallback:()=>true},true],
    [{clipboardUnavailable:true},false],
    [{clipboard:rejected,fallback:()=>false},false],
    [{clipboard:rejected,fallback:()=>{throw new Error('copy failed')}},false]
  ];
  for(const [faults,copied] of cases){
    const app=loadApp(false,undefined,faults);
    app.practice();app.completeCall();
    await app.click('#copy');
    assert.equal(app.temporaryFields.size,0);
    assert.equal(app.node('#copy').disabled,false);
    assert.equal(app.node('#copy').textContent.includes('Отчёт скопирован'),copied);
    assert.equal(app.node('#manualReport').hidden,copied);
    const text=copied?app.clipboard():app.node('#reportText').value;
    assert.match(text,/Результат: 20\/20/);
    assert.match(text,/Автор: Павел Аринин/);
    assert.match(text,/обязательные этапы C4, C9, C10 закрыты/);
    if(!copied)assert.equal(app.node('#reportText').selected,true);
  }
});

test('После обрыва и отказа записи ручной отчёт содержит текущие тайм-ауты',async()=>{
  const app=loadApp(true,undefined,{
    beforeWrite:key=>{if(key===historyKey)throw new Error('write unavailable')},
    clipboardUnavailable:true
  });
  app.practice();app.tick(165);
  assert.match(app.root.innerHTML,/клиент бросил трубку/);
  await app.click('#copy');
  assert.match(app.node('#reportText').value,/Результат: 0\/20[\s\S]*hangup/);
  assert.match(app.node('#reportText').value,/Истечения времени: 5\. Этапы: C1\./);
  assert.equal(app.history().length,0);
});
