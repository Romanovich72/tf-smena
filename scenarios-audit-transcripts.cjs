const assert = require('node:assert/strict');

global.window = global;
require('../scenarios.js');
require('../engine.js');

const {TRAINING_DATA: data, TrainingEngine: engine} = global;
const branchNames = {A:'Идеальная ветка', B:'Пропуск C2–C4 и слепой C6', C:'Слабое приглашение C9 и слив в C10'};
const nextSeed = (clientId, branch) => [...clientId, ...branch].reduce((seed, char) => (seed * 31 + char.charCodeAt(0)) >>> 0, 17);

function setSeed(seed) {
  let state = seed || 1;
  Math.random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function pickAnswer(options, criterion, branch) {
  if (branch === 'B' && ['C2', 'C3', 'C4'].includes(criterion)) {
    return options.answers.find(answer => !answer.events.includes(criterion) && !answer.rough);
  }
  if (branch === 'B' && criterion === 'C6') {
    return options.answers.find(answer => answer.id.endsWith('-C6-list'));
  }
  if (branch === 'C' && criterion === 'C9') {
    return options.answers.find(answer => !answer.events.includes('C9') && !answer.rough);
  }
  if (branch === 'C' && criterion === 'C10') {
    return options.answers.find(answer => !answer.events.includes('C10') && /(WhatsApp|прайс|перезвон)/i.test(answer.text))
      || options.answers.find(answer => !answer.events.includes('C10'));
  }
  return options.answers.find(answer => answer.events.includes(criterion));
}

function runCall(client, branch, contextIndex) {
  setSeed(nextSeed(client.id, `${contextIndex}-${branch}`));
  let session = engine.start(client, 'practice', contextIndex);
  const output = [`\n${'='.repeat(96)}`, `${client.id.toUpperCase()} · КОНТЕКСТ ${contextIndex + 1} · ВЕТКА ${branch}: ${branchNames[branch]}`, `СТАРТ КЛИЕНТА: ${session.context.prompt}`];
  let turns = 0;

  while (!session.done) {
    assert.ok(++turns <= 20, `${client.id}/${branch}: no unbounded return routing`);
    const options = engine.options(session);
    assert.ok(options, `${client.id}/${branch}: options exist at turn ${turns}`);
    const criterion = options.criterion;
    const answer = pickAnswer(options, criterion, branch);
    assert.ok(answer, `${client.id}/${branch}/${criterion}: selected answer exists`);
    assert.equal(options.answers.length, 4, `${client.id}/${branch}/${criterion}: four choices rendered`);

    output.push(`\nКЛИЕНТ ДО ${criterion}: ${session.answers.at(-1)?.reply || session.context.prompt}`);
    output.push(`${criterion} · ${options.prompt}`);
    options.answers.forEach((choice, index) => output.push(`  ${index + 1}) ${choice.text}${choice.id === answer.id ? '  ← ВЫБРАНО' : ''}\n     ОЖИДАЕМАЯ РЕАКЦИЯ: ${choice.reply||choice.pricePressureReply||'—'}`));

    if (branch === 'A') {
      assert.ok(answer.events.includes(criterion), `${client.id}/${criterion}: ideal branch selects the standard answer`);
      assert.equal(data.findStopPhrase(answer, criterion), null,
        `${client.id}/${criterion}: ideal answer must not trigger a stop phrase`);
    }
    if (branch === 'B' && criterion === 'C6') {
      assert.ok(!session.revealedClueIds.includes('C3') && !session.revealedClueIds.includes('C4'),
        `${client.id}: blind C6 path has no C3/C4 clues`);
      assert.ok(!answer.events.includes('C6'), `${client.id}: blind presentation cannot score C6`);
      assert.doesNotMatch(answer.text, /(бассейн|спин)/i, `${client.id}: blind presentation does not invent pool/back pain`);
    }
    if (branch === 'B' && ['C7', 'C9'].includes(criterion)) {
      assert.ok(options.answers.every(choice => !/(бассейн|спин)/i.test(choice.text)),
        `${client.id}/${criterion}: no option assumes an undisclosed pool or back-pain need`);
    }
    if (branch === 'C' && criterion === 'C9') assert.ok(!answer.events.includes('C9'), `${client.id}: weak invite gets no C9 score`);
    if (branch === 'C' && criterion === 'C10') assert.ok(!answer.events.includes('C10'), `${client.id}: messenger escape gets no C10 score`);

    session = engine.choose(session, answer);
    if (branch === 'B' && criterion === 'C3') {
      assert.doesNotMatch(session.answers.at(-1).reply, /(клубе рядом|переполн|очеред|пробк|не хватало|в зале шум)/i,
        `${client.id}: missed C3 must not reveal the experience clue`);
    }
    if (branch === 'B' && criterion === 'C4') {
      assert.doesNotMatch(session.answers.at(-1).reply, /(спина|бассейн|поплав|очеред|сервис|энерги|вынослив)/i,
        `${client.id}: missed C4 must not reveal the true motive`);
    }
    output.push(`МЕНЕДЖЕР: ${answer.text}`);
    output.push(`КЛИЕНТ: ${session.answers.at(-1).reply || 'Клиент завершил разговор.'}`);
    if (session.done) break;
    const next = engine.options(session);
    output.push(`СЛЕДУЮЩИЙ ЭТАП: ${next.criterion} · ${next.prompt}`);
  }

  const result = engine.result(session);
  output.push(`\nФИНАЛ: ${session.outcome}; доверие ${session.trust}/100; балл ${result.total}/20; ${result.passed ? 'зачёт' : 'без зачёта'}`);
  const namedTurns = session.answers.filter(answer => answer.addressedGuestByName).length;
  output.push(`C1: ${result.scores.C1}/2; ходов с обращением по имени: ${namedTurns}`);
  if (branch === 'A') {
    assert.ok(namedTurns >= 2, `${client.id}: ideal route uses the name in separate turns`);
    assert.equal(result.scores.C1, 2);
    assert.equal(result.total, 20);
    assert.equal(result.earlyPriceLeak, false);
    assert.equal(result.passed, true, `${client.id}: ideal branch passes`);
  }
  if (branch === 'B') assert.equal(result.scores.C6, 0, `${client.id}: blind C6 has no score`);
  if (branch === 'C') {
    assert.equal(result.scores.C9, 0, `${client.id}: weak invite has no score`);
    assert.equal(result.scores.C10, 0, `${client.id}: missed close has no score`);
  }
  return output.join('\n');
}

const transcripts = [];
for (const clientId of ['analyst', 'driver', 'woman', 'novice']) {
  const client = data.clients.find(item => item.id === clientId);
  assert.ok(client, `client ${clientId} exists`);
  client.starts.forEach((_, contextIndex) => {
    for (const branch of ['A', 'B', 'C']) transcripts.push(runCall(client, branch, contextIndex));
  });
}

console.log(transcripts.join('\n'));
console.log(`\nAUDIT PASSED: ${transcripts.length} full reproducible transcripts across every opening context; four choices/reactions per stage, ideal stop phrase scan, blind C6 safeguards, and failure branch scoring.`);
