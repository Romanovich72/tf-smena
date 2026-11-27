const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApp(pressure) {
  const storage = new Map([['tf-noir-pressure-v1', String(pressure)]]);
  const intervals = new Map();
  const tones = [];
  let nextInterval = 0;
  let buttons = new Map();
  let html = '';
  let clip = '';
  const node = key => {
    if (!buttons.has(key)) buttons.set(key, {setAttribute() {}});
    return buttons.get(key);
  };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; buttons = new Map(); },
    querySelector: node,
    querySelectorAll: selector => ({
      '[data-go]': [Object.assign(node('home'), {dataset:{go:'home'}}), Object.assign(node('profile'), {dataset:{go:'profile'}})],
      '[data-client]': [Object.assign(node('analyst'), {dataset:{client:'analyst'}})],
      '.choices .answer': [0,1,2,3].map(node)
    })[selector] || []
  };
  const env = {
    structuredClone, document:{querySelector:()=>root},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    navigator:{clipboard:{writeText:async text=>{clip=text}}},
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
  const click=key=>node(key).onclick({preventDefault(){},currentTarget:node(key)});
  const choose=(kind='correct')=>{
    const index=stage.answers.findIndex(a=>kind==='rough'?a.rough:kind==='correct'?a.events.includes(stage.criterion):!a.events.length&&!a.rough);
    assert.ok(index>=0);
    click(index);
  };
  const tick=count=>{
    for(let i=0;i<count;i++){
      assert.equal(intervals.size,1);
      intervals.values().next().value();
    }
  };
  return {click,choose,tick,intervals,tones,node,root,storage,history:()=>JSON.parse(storage.get('tf-noir-training-v1')||'[]'),clipboard:()=>clip,
    practice(){click('#free');click('analyst')}};
}

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
