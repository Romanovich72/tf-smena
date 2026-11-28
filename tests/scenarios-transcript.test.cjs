const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

global.window = global;
require('../scenarios.js');
require('../engine.js');

const expectedOrder = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C9', 'C7', 'C8', 'C10'];
const clients = window.TRAINING_DATA.clients;

function scoredAnswer(step) {
  const [criterion, , answers] = step;
  const scored = answers.filter(answer => answer.events.includes(criterion));
  assert.equal(scored.length, 1, `${criterion} must have exactly one scoring answer`);
  return scored[0];
}

function recoveryLead(clientId, failedCriterion, session) {
  if (failedCriterion === 'C3' && /(хотел[аи]? сначала рассказать|не успел[аи]? рассказать|хотел[аи]? рассказать.*опыт|не рассказал[аи].*опыт|мешало заниматься раньше)/i.test(session.lastClientReply || ''))
    return window.TRAINING_DATA.c4ExperienceRecoveryLead[clientId];
  if (failedCriterion === 'C5') {
    const reply=session.lastClientReply||'';
    const kind=/(супруг|муж|жен(?:а|у|ой|е)|коллег|друг|подруг|с семь)/i.test(reply)?'companion':/(знакомств|первого визит|встреч)/i.test(reply)?'visit':/(распис|график|слот|врем[яеи])/i.test(reply)?'schedule':/(карт|формат|тариф|стоим|цен|семейн)/i.test(reply)?'card':'other';
    return window.TRAINING_DATA.c5RecoveryCopy[clientId][kind];
  }
  if (failedCriterion === 'C8') {
    const reply=session.lastClientReply||'';
    const kind=/(перв.{0,12}плат|платеж|платёж|списан|автоспис)/i.test(reply)?'payment':/(прозрач|схема понятн|условия ясн|теперь понятн|всё понятн)/i.test(reply)?'clear':/(срав|только сразу|разн.{0,15}способ|распределить оплат)/i.test(reply)?'comparison':'default';
    return window.TRAINING_DATA.c8RecoveryCopy[clientId][kind];
  }
  if (failedCriterion === 'C4' && /(не решил[аи]?|не решила|не определил[аи]?|пока не решил|пока не решила|не объяснил[аи].*(?:результат|задач)|какой результат.*приоритет|какую задачу.*главн|трудно сформулировать результат|пока только присматриваюсь|не знаю.*присматриваюсь)/i.test(session.lastClientReply || ''))
    return window.TRAINING_DATA.c4PauseBridge;
  if (failedCriterion === 'C4' && /(плав|спин|энерг|восстан|тонус|выносл|переключ|дорог|маршрут|график|комфорт|перегруз|поддерж|регулярн|форму|заниматься.*после)/i.test(session.lastClientReply || ''))
    return window.TRAINING_DATA.c4AcknowledgedNeedRecovery[clientId];
  if (failedCriterion === 'C6') {
    if(/дорог|маршрут|сколько обычно занимает|время в пути|какой вечерний слот/i.test(session.lastClientReply||''))
      return window.TRAINING_DATA.c6ReplyRecovery.route[clientId];
    if(/сервис|сопровожд|встреч|очеред|по шагам|первые упражнения|тренер/i.test(session.lastClientReply||''))return window.TRAINING_DATA.c6ReplyRecovery.service[clientId];
    if(/не одному|не одна|вместе|друг|подруг|супруг|коллег|близк/i.test(session.lastClientReply||''))return window.TRAINING_DATA.c6ReplyRecovery.companion[clientId];
    const afterC6 = session.context.presentation?.afterC6;
    const motive = session.revealedClueIds.includes('C4');
    const experience = session.revealedClueIds.includes('C3');
    if (motive) return afterC6?.[experience?'both':'motive'] ?? window.TRAINING_DATA.c6NeedRecovery[clientId];
    if (experience) return afterC6?.experience ?? window.TRAINING_DATA.c6ExperienceRecovery[clientId];
    return window.TRAINING_DATA.c6GenericRecovery[clientId];
  }
  if (failedCriterion === 'C9') {
    const reply=session.lastClientReply||'';
    if (/(куда идти|не понять[, ]+куда|добрат|маршрут|вход|где меня встрет|подтвержден|подтверждён)/i.test(reply))return window.TRAINING_DATA.c9LogisticsRecovery[clientId];
    if (/(точн|дат[ауые]|врем[яеи]|слот|заранее|согласован|организован|не понят)/i.test(reply))return window.TRAINING_DATA.c9TimeRecovery[clientId];
  }
  return window.TRAINING_DATA.recoveryCopy[clientId][failedCriterion];
}

test('four archetypes produce coherent, non-repeating ideal call transcripts', () => {
  for (const client of clients) {
    const context = client.starts[0];
    assert.deepEqual(context.steps.map(step => step[0]), expectedOrder, `${client.id}: funnel order`);
    if(client.id==='woman')
      assert.ok(client.starts.every(start=>start.steps.every(([, ,answers])=>answers.every(answer=>!/не объяснил(?!а)/i.test(answer.reply)))),
        'woman customer reactions must use feminine first-person forms');

    for (const [contextIndex, variant] of client.starts.entries()) {
      const owner = new Map();
      for (const [criterion, , answers] of variant.steps) {
        assert.equal(answers.length, 4, `${client.id}/${contextIndex}/${criterion}: four choices`);
        assert.equal(new Set(answers.map(answer => answer.text.trim())).size, 4,
          `${client.id}/${contextIndex}/${criterion}: four distinct choices`);
        assert.ok(answers.every(answer => answer.reply?.trim()),
          `${client.id}/${contextIndex}/${criterion}: every choice has a client reaction`);
        if (criterion === 'C1') assert.equal(new Set(answers.map(answer => answer.reply)).size, 2);
        else assert.equal(new Set(answers.map(answer => answer.reply.trim())).size, 4,
          `${client.id}/${contextIndex}/${criterion}: reactions are answer-specific, not one repeated voice template`);
        if (criterion === 'C3') {
          const leakedExperience = /(раньше ходил|клубе рядом|переполн|очеред|пробк|не хватало|в зале шум|спина затека|плавать рядом)/i;
          for (const answer of answers.filter(item => !item.events.includes('C3'))) {
            assert.doesNotMatch(answer.reply, leakedExperience,
              `${client.id}/${contextIndex}/C3: an unscored question must not disclose the C3 clue`);
          }
        }
        if (criterion === 'C4') {
          const leakedMotive = /(спина|бассейн|поплав|очеред|внимательн|сервис|энерги|вынослив|начать постепенно|сравнения с другими)/i;
          for (const answer of answers.filter(item => !item.events.includes('C4'))) {
            assert.doesNotMatch(answer.reply, leakedMotive,
              `${client.id}/${contextIndex}/C4: an unscored question must not disclose the C4 motive`);
          }
        }
        for (const answer of answers) {
          const earlierStage = owner.get(answer.text.trim());
          assert.equal(earlierStage, undefined,
            `${client.id}/${contextIndex}: button text repeats at ${earlierStage} and ${criterion}: ${answer.text}`);
          owner.set(answer.text.trim(), criterion);
        }
      }
    }

    const answerOwner = new Map();
    const ideal = context.steps.map(step => {
      const [criterion, , answers] = step;
      assert.equal(answers.length, 4, `${client.id}/${criterion}: four choices`);
      assert.equal(new Set(answers.map(answer => answer.text.trim())).size, 4,
        `${client.id}/${criterion}: choices are distinct within the stage`);

      for (const answer of answers) {
        const previousCriterion = answerOwner.get(answer.text.trim());
        assert.equal(previousCriterion, undefined,
          `${client.id}: button text repeats at ${previousCriterion} and ${criterion}: ${answer.text}`);
        answerOwner.set(answer.text.trim(), criterion);
      }

      const answer = scoredAnswer(step);
      return {criterion, manager: answer.text, client: answer.reply};
    });

    const reply = criterion => ideal.find(turn => turn.criterion === criterion).client;
    const guestName = {analyst:'Алексей', driver:'Максим', woman:'Елена', novice:'Илья'}[client.id];
    assert.ok(reply('C1').includes(guestName), `${client.id}: C1 reply recognizes the guest's name`);
    assert.match(reply('C2'), /(цен|стоим)/i, `${client.id}: client remains focused on price at C2`);
    assert.match(reply('C3'), /(был в клубе|опыт|занимал|ходил|пробовал)/i,
      `${client.id}: guarded C3 reply responds to the experience question`);
    assert.match(reply('C5'), /(один|одна|супруг|семь|друг|коллег)/i,
      `${client.id}: C5 reply describes who may attend`);
    assert.match(reply('C6'), /(подход|подойд|устраивает|нравится|комфорт|близок)/i,
      `${client.id}: C6 confirms the format is relevant`);
    assert.match(reply('C6'), /(врем|трат|дорог|тороп|уверен|решиться|выделить|поезд)/i,
      `${client.id}: C6 expresses hesitation about spending time`);
    if (client.id === 'driver') {
      const presentation = ideal.find(turn => turn.criterion === 'C6').manager;
      assert.match(presentation, /(маршрут|парковк|дорог)/i, 'driver C6 uses the disclosed route/time need');
      assert.doesNotMatch(presentation, /(бассейн|спин)/i, 'driver C6 does not assume a pool or back-pain need');
    }
    assert.doesNotMatch(reply('C6'), /(приеду|готов приехать|запишите|когда посмотреть)/i,
      `${client.id}: C6 must not accept a visit before C9`);

    assert.match(reply('C9'), /(стоим|цен|сколько.*карт|сумм)/i,
      `${client.id}: C9 asks for price`);
    assert.match(reply('C9'), /(не поед|не приед|до визита|пока не знаю|пока не понимаю|без цены|сначала.*цен|сначала.*стоим|порядок цены|порядок стоимости)/i,
      `${client.id}: C9 withholds visit agreement until price is known`);
    const invite = ideal.find(turn => turn.criterion === 'C9').manager;
    assert.match(invite, /(10 минут|7.?10 минут)/i, `${client.id}: C9 offers a short visit`);
    assert.match(invite, /(загруз|маршрут|зон|сервис|покаж|встрет|с чего начать|атмосфер|комфорт)/i,
      `${client.id}: C9 invitation explains client value`);
    if (client.id === 'novice') {
      assert.match(invite, /комфорт|атмосфер/i, 'novice C9 invites a calm assessment of comfort and atmosphere');
      assert.match(invite, /без давления|без обязательств/i, 'novice C9 preserves a no-pressure decision');
      assert.match(invite, /решени[ея].*сам|решить самому|самому.*решени|сами примете взвешенное решение/i,
        'novice C9 leaves the final choice to the client');
    }
    assert.match(reply('C7'), /(оплат|помесяч|ежемесяч|списан)/i,
      `${client.id}: C7 leads into payment terms`);
    const priceOffer = ideal.find(turn => turn.criterion === 'C7').manager;
    assert.doesNotMatch(priceOffer, /89\s?100\s?₽/i, `${client.id}: C7 states the annual price in rubles`);
    assert.match(priceOffer, /в среднем от 4\s?000\s?₽ в месяц/i, `${client.id}: C7 includes the monthly equivalent`);
    assert.match(priceOffer, /(ценност|бассейн|комфорт|тишин|врем|поддерж|начать|после работы)/i,
      `${client.id}: C7 connects price to client value`);
    assert.match(priceOffer, /12 месяцев/i,
      `${client.id}: C7 names payment formats`);
    assert.match(priceOffer, /встреч[^?]*\?/i,
      `${client.id}: C7 closes with the agreed choice question`);
    assert.doesNotMatch(priceOffer, /замороз/i, `${client.id}: C7 does not ask about freezing`);
    assert.match(reply('C7'), /помесячн.*(как устроен|сколько|внести)/i,
      `${client.id}: C7 reply asks about monthly payment details in plain language`);
    assert.doesNotMatch(reply('C7'), /рекуррент/i,
      `${client.id}: C7 customer reply must not use the manager's C8 terminology`);
    const c8Choices=context.steps.find(step=>step[0]==='C8')[2];
    assert.ok(c8Choices.every(choice=>/(подума|взвеш|перезвон|свяжусь.*позже|наберу)/i.test(choice.reply)),
      `${client.id}: every C8 reaction should make the C10 think-and-call transition coherent`);
    assert.match(reply('C8'), /(подума|перезвон|свяжусь.*позже|позвоню.*позже)/i,
      `${client.id}: C8 introduces the think-and-call objection`);
    assert.match(reply('C10'), /(завтра|встреч|подходит|договорились|пришлите)/i,
      `${client.id}: C10 confirms the fixed visit`);
    const fixedTime = ideal.find(turn => turn.criterion === 'C10').manager.match(/завтра[^\d]*(\d{1,2}:\d{2})/i)?.[1];
    assert.ok(fixedTime, `${client.id}: C10 manager must offer an exact time`);
    assert.ok(reply('C10').includes(fixedTime),
      `${client.id}: C10 confirmation must match the manager's ${fixedTime} slot`);

    console.log(`\n=== ${client.name} ===`);
    console.log(`Клиент начинает: ${context.prompt}`);
    for (const turn of ideal) {
      console.log(`${turn.criterion} МЕНЕДЖЕР: ${turn.manager}`);
      console.log(`${turn.criterion} КЛИЕНТ: ${turn.client}`);
    }
  }
});

test('C6 route questions are acknowledged before the visit invitation', () => {
  const client=clients.find(item=>item.id==='driver');
  let session=TrainingEngine.start(client,'practice',0);
  for(const criterion of ['C1','C2','C3','C4','C5']){
    const answer=TrainingEngine.options(session).answers.find(option=>option.events.includes(criterion));
    session=TrainingEngine.choose(session,{...answer,criterion});
  }
  const c6=TrainingEngine.options(session).answers.find(option=>/обычно занимает дорога/i.test(option.reply));
  assert.ok(c6,'driver C6 includes a reply asking how long the route takes');
  session=TrainingEngine.choose(session,{...c6,criterion:'C6'});
  const c9=TrainingEngine.options(session);
  assert.ok(c9.answers.every(option=>option.text.startsWith('Понял, сначала коротко сориентирую по маршруту и времени в пути')),
    'driver C9 choices acknowledge the route/time question before moving to the visit');
});

test('C5 reactions answer their paired questions and C6 companion copy requires a spoken companion', () => {
  const guests={analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'};
  for (const client of clients) {
    const [, , choices]=client.starts[0].steps.find(step=>step[0]==='C5');
    assert.equal(choices.length,4);
    for (const choice of choices) {
      const asksCompanion=/(один|одна|с кем|близк|поддерж|кто ещё|вместе)/i.test(choice.text);
      const asksCard=/карт|формат карты|семейн/i.test(choice.text);
      const asksSchedule=/расписан|график|время/i.test(choice.text);
      if (asksCard || asksSchedule)
        assert.doesNotMatch(choice.reply, /коллег|супруг|муж(?:а|у|ем)?|жен(?:а|у|ой|е)|друг(?:а|у|ом|е)?|подруг|семь/i,
          `${client.id}: C5 card/schedule question must not get a companion answer: ${choice.text} → ${choice.reply}`);
      if (asksCompanion)
        assert.match(choice.reply, /один|одна|супруг|коллег|друг|семь|пока не знаю|не уверен|не решила/i,
          `${client.id}: C5 companion question receives a direct answer`);
    }

    let session=TrainingEngine.start(client,'practice',0);
    for (const criterion of ['C1','C2','C3','C4']) {
      const answer=TrainingEngine.options(session).answers.find(option=>option.events.includes(criterion));
      session=TrainingEngine.choose(session,{...answer,criterion});
    }
    const c5=TrainingEngine.options(session).answers.find(option=>option.events.includes('C5'));
    session=TrainingEngine.choose(session,{...c5,reply:'Пока выбираю только карту для себя.',criterion:'C5'});
    assert.ok(!/коллег|супруг|супруг|муж|жен|друг|подруг/i.test(session.lastClientReply));
    const c6WithoutCompanion=TrainingEngine.options(session).answers.find(option=>option.events.includes('C6'));
    assert.ok(c6WithoutCompanion);
    assert.equal(c6WithoutCompanion.companionContext,undefined,
      `${client.id}: C5 score alone must not imply a companion`);
    assert.doesNotMatch(c6WithoutCompanion.text,/(?<![а-яё])(?:коллег|супруг|муж|жен|друг|подруг)/iu);

    let spoken=TrainingEngine.start(client,'practice',0);
    for (const criterion of ['C1','C2','C3','C4']) {
      const answer=TrainingEngine.options(spoken).answers.find(option=>option.events.includes(criterion));
      spoken=TrainingEngine.choose(spoken,{...answer,criterion});
    }
    const companionAnswer=TrainingEngine.options(spoken).answers.find(option=>option.events.includes('C5'));
    spoken=TrainingEngine.choose(spoken,{...companionAnswer,reply:'Иногда со мной приходит коллега.',criterion:'C5'});
    assert.equal(TrainingEngine.options(spoken).answers.find(option=>option.events.includes('C6')).companionContext,true,
      `${client.id}: an explicitly spoken companion unlocks the C6 lead`);
  }
});

test('C7 customer replies use plain language and C3 recovery reopens experience on C4', () => {
  for (const client of clients) {
    const steps=client.starts[0].steps;
    const beforeC8=steps.slice(0,steps.findIndex(step=>step[0]==='C8'));
    assert.ok(beforeC8.every(([, ,answers])=>answers.every(answer=>!/рекуррент/i.test(answer.reply))),
      `${client.id}: customer must not use C8 terminology before it is introduced`);
    const c7=steps.find(step=>step[0]==='C7')[2];
    assert.match(c7.find(answer=>answer.events.includes('C7')).reply,/помесячн.*как устроен|помесячн.*сколько/i,
      `${client.id}: customer asks naturally about monthly payments`);

    let session=TrainingEngine.start(client,'practice',0);
    for (const criterion of ['C1','C2']) {
      const answer=TrainingEngine.options(session).answers.find(option=>option.events.includes(criterion));
      session=TrainingEngine.choose(session,{...answer,criterion});
    }
    const c3Miss=TrainingEngine.options(session).answers.find(option=>!option.events.includes('C3')&&!option.rough);
    assert.ok(c3Miss,`${client.id}: C3 has a soft miss path`);
    session=TrainingEngine.choose(session,{...c3Miss,reply:'Я хотел сначала рассказать о своём опыте.',criterion:'C3'});
    const c4=TrainingEngine.options(session);
    const c4Standard=c4.answers.find(option=>option.events.includes('C4'));
    if(client.id==='novice'){
      assert.match(c4Standard.text,/раньше вы не занимались|первой тренировк/i,
        'novice recovery respects that the customer has no past club experience');
      assert.match(c4Standard.reply,/раньше не занимал|перв|тренер|перегруз/i);
    } else {
      assert.match(c4Standard.text,/согласен|согласна/i,`${client.id}: manager acknowledges the customer's request to share experience`);
      assert.match(c4Standard.text,/опыт важен.*расскажите коротко/i);
      assert.match(c4Standard.text,/какую задачу хотите решить сейчас|какой первый результат/i);
      assert.match(c4Standard.reply,/раньше|прошл|прежн|мешал|не хватал|не устроил|не занимал|отнимал|дорог|шумн|переполн/i,
      `${client.id}: next client reply answers the repaired experience question`);
    }

    if(client.id==='novice'){
      let disclosed=TrainingEngine.start(client,'practice',0);
      for(const criterion of ['C1','C2','C3']){
        const answer=TrainingEngine.options(disclosed).answers.find(option=>option.events.includes(criterion));
        disclosed=TrainingEngine.choose(disclosed,{...answer,criterion});
      }
      const c4AfterNoExperience=TrainingEngine.options(disclosed).answers;
      assert.ok(c4AfterNoExperience.every(option=>!/(учитывая|с учётом) ваш(?:его)? прошл(?:ого)? опыт/i.test(option.text)),
        'novice C4 must not imply the customer has prior fitness experience');
    }
  }
});

test('C7 stop phrase only flags unscored price answers', () => {
  for (const client of clients) {
    const [, , answers] = client.starts[0].steps.find(step => step[0] === 'C7');
    const correct = answers.find(answer => answer.events.includes('C7'));
    const barePrice = answers.find(answer => !answer.events.includes('C7') && /89\s?100\s?рублей/i.test(answer.text));
    assert.ok(barePrice, `${client.id}: has an unscored bare-price / defer-price C7 option`);
    assert.equal(window.TRAINING_DATA.findStopPhrase(correct, 'C7'), null,
      `${client.id}: the scored C7 answer must not trigger the price stop phrase`);
    assert.equal(window.TRAINING_DATA.findStopPhrase(barePrice, 'C7')?.phrase, '89 100 рублей.',
      `${client.id}: an unscored price answer still triggers the stop phrase`);
  }
});

test('C4 and C6 choices adapt to the clues actually revealed', () => {
  const select = (session, criterion, predicate) => {
    const options = TrainingEngine.options(session);
    assert.equal(options.criterion, criterion, `expected ${criterion} options`);
    const answer = options.answers.find(predicate);
    assert.ok(answer, `${criterion} has a selectable answer for the test path`);
    return TrainingEngine.choose(session, answer);
  };
  const correct = (answer, criterion) => answer.events.includes(criterion);
  const softError = answer => answer.events.length === 0 && !answer.rough;

  for (const client of clients) {
    let closed = TrainingEngine.start(client, 'practice', 0);
    closed = select(closed, 'C1', answer => correct(answer, 'C1'));
    closed = select(closed, 'C2', answer => correct(answer, 'C2'));
    closed = select(closed, 'C3', softError);

    let c4 = TrainingEngine.options(closed);
    assert.equal(c4.criterion, 'C4');
    assert.equal(c4.answers.length, 4);
    assert.ok(c4.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
      `${client.id}: C4 must not invent a pool or back-pain request when C3 is closed`);

    const guardedC4 = TrainingEngine.options(closed);
    assert.match(guardedC4.prompt, /(пока не раскрыл|не раскрыл|не рассказал|сдержан|личн|закрыт)/i,
      `${client.id}: C4 prompt should handle a guarded C3 answer`);
    closed = select(closed, 'C4', softError);
    closed = select(closed, 'C5', answer => correct(answer, 'C5'));
    const blindC6 = TrainingEngine.options(closed);
    assert.equal(blindC6.criterion, 'C6');
    assert.equal(blindC6.answers.length, 4);
    assert.ok(blindC6.answers.every(answer => !answer.events.includes('C6')),
      `${client.id}: blind presentation cannot score C6`);
    assert.ok(blindC6.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
      `${client.id}: blind C6 choices cannot claim a pool/back-pain need`);
    assert.ok(blindC6.answers.every(answer => !answer.returnTo),
      `${client.id}: blind C6 must continue forward instead of returning to an earlier criterion`);
    assert.ok(blindC6.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
      `${client.id}: blind C6 must not claim a need the client has not disclosed`);

    let known = TrainingEngine.start(client, 'practice', 0);
    known = select(known, 'C1', answer => correct(answer, 'C1'));
    known = select(known, 'C2', answer => correct(answer, 'C2'));
    known = select(known, 'C3', answer => correct(answer, 'C3'));
    const disclosedC4 = TrainingEngine.options(known);
    assert.match(disclosedC4.prompt, client.id==='novice'?/раньше не занимался/i:/(опыт|рассказ|прежн)/i,
      `${client.id}: C4 prompt reflects whether previous experience was disclosed`);
    assert.ok(disclosedC4.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
      `${client.id}: C4 asks about motive without asserting an unspoken zone or pain`);
    known = select(known, 'C4', softError);
    known = select(known, 'C5', answer => correct(answer, 'C5'));
    const addressedC6 = TrainingEngine.options(known);
    assert.ok(addressedC6.answers.some(answer => correct(answer, 'C6')),
      `${client.id}: one C3 clue unlocks the authored C6 presentation`);

    let motiveKnown = TrainingEngine.start(client, 'practice', 0);
    motiveKnown = select(motiveKnown, 'C1', answer => correct(answer, 'C1'));
    motiveKnown = select(motiveKnown, 'C2', answer => correct(answer, 'C2'));
    motiveKnown = select(motiveKnown, 'C3', softError);
    motiveKnown = select(motiveKnown, 'C4', answer => correct(answer, 'C4'));
    motiveKnown = select(motiveKnown, 'C5', answer => correct(answer, 'C5'));
    const c4OnlyPresentation = TrainingEngine.options(motiveKnown);
    assert.ok(c4OnlyPresentation.answers.some(answer => correct(answer, 'C6')),
      `${client.id}: a C4 clue alone unlocks the authored C6 presentation`);

    const blindChoice = blindC6.answers[0];
    const recovered = TrainingEngine.choose(closed, blindChoice);
    assert.equal(recovered.context.steps[recovered.step][0], 'C9', `${client.id}: blind C6 continues to the visit step`);
    assert.equal(TrainingEngine.result(recovered).scores.C6, 0, `${client.id}: blind presentation does not score C6`);
  }
});

test('every missed criterion produces a persona-aware recovery answer on the next step', () => {
  const order = expectedOrder;
  const expectedSignals = {
    'C6>C9': /(10 минут|7.?10 минут)/i,
    'C9>C7': /(точн(ые|ый|ого)|дату|время|слот|закрепим)/i,
    'C7>C8': /в среднем от 4\s?000\s?₽ в месяц/i
  };
  const chooseFor = (session, criterion, predicate) => {
    const stage = TrainingEngine.options(session);
    assert.equal(stage.criterion, criterion);
    const answer = stage.answers.find(predicate);
    assert.ok(answer, `${session.clientId}/${criterion}: answer exists`);
    return TrainingEngine.choose(session, answer);
  };

  for (const client of clients) {
    for (let failedIndex = 0; failedIndex < order.length - 1; failedIndex++) {
      const failedCriterion = order[failedIndex];
      const nextCriterion = order[failedIndex + 1];
      for (const outcome of ['soft', 'hard']) {
        let session = TrainingEngine.start(client, 'practice', 0);
        for (let index = 0; index < failedIndex; index++) {
          const criterion = order[index];
          session = chooseFor(session, criterion, answer => answer.events.includes(criterion));
          assert.equal(session.lastOutcome, 'standard', `${client.id}/${criterion}: standard turn is retained`);
          assert.equal(session.lastFailedCriterion, null);
        }
        const error = outcome === 'hard'
          ? answer => answer.rough && !answer.events.includes(failedCriterion)
          : answer => !answer.rough && !answer.events.includes(failedCriterion) && answer.events.length === 0;
        if (outcome === 'hard' && !TrainingEngine.options(session).answers.some(error)) continue;
        session = chooseFor(session, failedCriterion, error);
        assert.equal(session.lastOutcome, outcome, `${client.id}/${failedCriterion}: outcome is retained`);
        assert.equal(session.lastFailedCriterion, failedCriterion);
        assert.ok(session.failedCriteria.includes(failedCriterion));
        assert.equal(session.lastClientReply, session.answers.at(-1).reply);

        const nextOptions = TrainingEngine.options(session);
        assert.equal(nextOptions.criterion, nextCriterion);
        assert.ok(nextOptions.prompt.includes(session.lastClientReply),
          `${client.id}/${failedCriterion}: next prompt includes the actual client reaction`);
        if (failedCriterion === 'C1' && !session.nameKnown) {
          const guestName = {analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'}[client.id];
          assert.ok(nextOptions.answers.every(answer => !answer.text.includes(`${guestName},`)),
            `${client.id}: C2 must not use a name that was not collected after a C1 miss`);
        }
        const recovered = nextOptions.answers.find(answer => answer.events.includes(nextCriterion));
        assert.ok(recovered, `${client.id}/${failedCriterion}: next standard answer exists`);
        assert.equal(recovered.recoveryFrom, failedCriterion,
          `${client.id}: ${nextCriterion} answer must show it used the prior miss`);
        assert.equal(recovered.recoveryOutcome, outcome);
        const expectedLead = recoveryLead(client.id, failedCriterion, session);
        if (!['C1','C2'].includes(failedCriterion)) assert.ok(recovered.text.includes(expectedLead),
          `${client.id}: next standard answer includes persona-specific recovery copy`);
        const signal = expectedSignals[`${failedCriterion}>${nextCriterion}`];
        if (signal && (failedCriterion !== 'C9' || /(точн|дат[ауые]|врем[яеи]|слот|заранее|согласован|организован|не понят)/i.test(session.lastClientReply)))
          assert.match(recovered.text, signal, `${client.id}: ${failedCriterion} recovery wording`);
        if(failedCriterion==='C8'&&/(перв.{0,12}плат|платеж|платёж|списан|автоспис)/i.test(session.lastClientReply))
          assert.match(recovered.text,/вступительн.*ежемесяч|ежемесяч.*вступительн/i,
            `${client.id}: C8 payment recovery clarifies the initial fee and monthly charges`);
        if (failedCriterion === 'C6') {
          if (session.revealedClueIds.includes('C4'))
            assert.match(recovered.text, /(плав|маршрут|дорог|тишин|сервис|комфорт|атмосфер|поддерж|начать)/i,
              `${client.id}: C9 ties the visit back to the disclosed motive`);
          else if (!session.revealedClueIds.includes('C3'))
            assert.match(recovered.text, /(общ|вводн|уточн)/i, `${client.id}: C9 stays generic while the need is undisclosed`);
        }
      }
    }
  }
});

test('all openings adapt all four next-step choices after every soft and hard answer', () => {
  const answerFor = (session, criterion, predicate) => {
    const options = TrainingEngine.options(session);
    assert.equal(options.criterion, criterion);
    const answer = options.answers.find(predicate);
    assert.ok(answer, `${session.clientId}/${criterion}: selectable answer exists`);
    return TrainingEngine.choose(session, {...answer, criterion});
  };
  const emit = (title, session) => {
    if (process.env.PRINT_SCENARIO_MATRIX !== '1') return;
    console.log(`\n=== ${title} ===`);
    console.log(`КЛИЕНТ НАЧИНАЕТ: ${session.context.prompt}`);
    session.answers.forEach((answer, index) => {
      const criterion = answer.criterion || session.context.steps[index]?.[0] || '—';
      console.log(`${criterion} МЕНЕДЖЕР: ${answer.text}`);
      console.log(`${criterion} КЛИЕНТ: ${answer.reply}`);
    });
  };
  let checkedBranches = 0;

  for (const client of clients) {
    for (const [contextIndex, context] of client.starts.entries()) {
      let ideal = TrainingEngine.start(client, 'practice', contextIndex);
      while (!ideal.done && ideal.step < ideal.context.steps.length) {
        const criterion = ideal.context.steps[ideal.step][0];
        ideal = answerFor(ideal, criterion, answer => answer.events.includes(criterion));
      }
      assert.equal(TrainingEngine.result(ideal).total, 20, `${client.id}/${contextIndex}: ideal route scores 20`);
      assert.equal(TrainingEngine.result(ideal).passed, true, `${client.id}/${contextIndex}: ideal route passes`);
      emit(`${client.id} / start ${contextIndex + 1} / ideal`, ideal);

      for (let failedIndex = 0; failedIndex < expectedOrder.length - 1; failedIndex++) {
        const failedCriterion = expectedOrder[failedIndex];
        const nextCriterion = expectedOrder[failedIndex + 1];
        let prefix = TrainingEngine.start(client, 'practice', contextIndex);
        for (let index = 0; index < failedIndex; index++) {
          const criterion = expectedOrder[index];
          prefix = answerFor(prefix, criterion, answer => answer.events.includes(criterion));
        }
        const options = TrainingEngine.options(prefix);
        assert.equal(options.criterion, failedCriterion);
        const mistakes = options.answers.filter(answer => !answer.events.includes(failedCriterion));
        assert.ok(mistakes.length, `${client.id}/${contextIndex}/${failedCriterion}: has a miss path`);

        for (const mistake of mistakes) {
          const outcome = mistake.rough ? 'hard' : 'soft';
          let session = TrainingEngine.choose(prefix, {...mistake, criterion:failedCriterion});
          assert.equal(session.lastOutcome, outcome);
          assert.equal(session.lastFailedCriterion, failedCriterion);
          assert.ok(session.lastClientReply, `${client.id}/${failedCriterion}: error has a client reaction`);
          assert.equal(session.done, false, `${client.id}/${failedCriterion}: one error does not end the call`);

          const next = TrainingEngine.options(session);
          assert.equal(next.criterion, nextCriterion, `${client.id}/${failedCriterion}: forward funnel transition`);
          assert.ok(next.prompt.includes(session.lastClientReply), `${client.id}/${failedCriterion}: latest reply is in context`);
          assert.equal(next.answers.length, 4);
          const spoken = [session.context.prompt,...session.answers.map(answer => answer.reply || '')].join(' ');
          if (!session.nameKnown) {
            const guestName={analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'}[client.id];
            assert.ok(next.answers.every(answer => !answer.text.includes(guestName)),
              `${client.id}/${failedCriterion}: manager does not use a name the client has not given`);
          }
          if (!/(бассейн|плав|водн)/i.test(spoken))
            assert.ok(next.answers.every(answer => !/(бассейн|взросл.{0,10}чаш|морск.{0,10}вод|плав(?!н))/i.test(answer.text)),
              `${client.id}/${failedCriterion}: next choices do not invent a water/pool interest`);
          if (!/спин/i.test(spoken))
            assert.ok(next.answers.every(answer => !/спин/i.test(answer.text)),
              `${client.id}/${failedCriterion}: next choices do not invent a back concern`);
          if (nextCriterion === 'C6' && !/(супруг|коллег|друг|подруг|жена|муж)/i.test(spoken))
            assert.ok(next.answers.every(answer => !/(супруг|коллег|друг|подруг|жена|муж)/i.test(answer.text)),
              `${client.id}/${failedCriterion}: C6 does not invent a companion`);
          for (const choice of next.answers) {
            assert.equal(choice.recoveryFrom, failedCriterion,
              `${client.id}/${failedCriterion}: every ${nextCriterion} option adapts to the last miss`);
            assert.equal(choice.recoveryOutcome, outcome);
            const expectedLead = recoveryLead(client.id, failedCriterion, session);
            const hasLead = !['C1','C2'].includes(failedCriterion) && (!['C3','C4','C5'].includes(failedCriterion) || choice.events.includes(nextCriterion));
            if(hasLead) assert.ok(choice.text.includes(expectedLead),
              `${client.id}/${failedCriterion}: every option acknowledges the prior turn`);
            assert.doesNotMatch(choice.text, /[а-яё]\.[А-ЯЁ]/,
              `${client.id}/${failedCriterion}: no sentence is glued to the next one`);
            if(hasLead) assert.equal(choice.text.split(expectedLead).length - 1, 1,
              `${client.id}/${failedCriterion}: recovery lead-in is not duplicated`);
          }
          if (failedCriterion === 'C4' && /(не решил[аи]?|не решила|не определил[аи]?|пока не решил|пока не решила|не объяснил[аи].*(?:результат|задач)|какой результат.*приоритет|какую задачу.*главн|трудно сформулировать результат|пока только присматриваюсь|не знаю.*присматриваюсь)/i.test(session.lastClientReply)) {
            assert.ok(next.answers.some(answer => /определиться на месте/i.test(answer.text)),
              `${client.id}: C5 bridges hesitation about the result before asking about companions`);
          }
          if (failedCriterion === 'C6' && !session.revealedClueIds.some(id => ['C3','C4'].includes(id))) {
            assert.ok(next.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
              `${client.id}: C9 after a blind presentation does not invent a need`);
          }
          if (failedCriterion === 'C9') {
            if (/(куда идти|не понять[, ]+куда|добрат|маршрут|вход|где меня встрет|подтвержден|подтверждён)/i.test(session.lastClientReply))
              assert.ok(next.answers.every(answer => /(встреч|схем|маршрут|вход)/i.test(answer.text)),
                `${client.id}: C7 answers the customer's arrival/location concern`);
            else if (/(точн|дат[ауые]|врем[яеи]|слот|заранее|согласован|организован|не понят)/i.test(session.lastClientReply))
              assert.ok(next.answers.every(answer => /(слот|врем|дат[ауые])/i.test(answer.text)),
                `${client.id}: C7 answers the request to fix an exact visit time`);
            else assert.ok(next.answers.every(answer => /сначала|не буду торопить|не нужно решать/i.test(answer.text)),
              `${client.id}: C7 respects a customer who is not ready to plan a visit`);
          }
          if (failedCriterion === 'C7') {
            assert.ok(next.answers.every(answer => /в среднем от 4\s?000\s?₽/.test(answer.text)),
              `${client.id}: C8 supplies the missing annual total before payment terms`);
          }

          // Continue the call on its standard route so the complete branch can be
          // emitted for manual transcript review when PRINT_SCENARIO_MATRIX=1.
          session = answerFor(session, nextCriterion, answer => answer.events.includes(nextCriterion));
          while (!session.done && session.step < session.context.steps.length) {
            const criterion = session.context.steps[session.step][0];
            session = answerFor(session, criterion, answer => answer.events.includes(criterion));
          }
          emit(`${client.id} / start ${contextIndex + 1} / miss ${failedCriterion} (${outcome}) / ${mistake.id}`, session);
          checkedBranches++;
        }
      }
    }
  }
  console.log(`Matrix branches checked: ${checkedBranches} (all starts, C1→C10 misses, every available soft/hard distractor).`);
  assert.ok(checkedBranches >= 160, `expected a broad transition matrix, checked ${checkedBranches} branches`);
});

test('several soft misses stay on the forward funnel and a hard-error pair still hangs up', () => {
  let hardPairChecked=0;
  for (const client of clients) {
    let session = TrainingEngine.start(client, 'practice', 0);
    for (const criterion of ['C1','C2']) {
      session = TrainingEngine.choose(session, {...TrainingEngine.options(session).answers.find(answer => answer.events.includes(criterion)),criterion});
    }
    for (const criterion of ['C3','C4','C5']) {
      const options = TrainingEngine.options(session);
      const miss = options.answers.find(answer => !answer.events.includes(criterion) && !answer.rough && answer.events.length === 0);
      assert.ok(miss, `${client.id}/${criterion}: a soft miss exists`);
      session = TrainingEngine.choose(session, {...miss,criterion});
      const nextCriterion = session.context.steps[session.step][0];
      assert.equal(nextCriterion, expectedOrder[expectedOrder.indexOf(criterion) + 1]);
      assert.equal(session.lastFailedCriterion, criterion);
      assert.ok(TrainingEngine.options(session).answers.every(answer => answer.recoveryFrom === criterion));
    }
    assert.deepEqual(session.failedCriteria.slice(-3), ['C3','C4','C5']);
    if (process.env.PRINT_SCENARIO_MATRIX === '1') {
      console.log(`\n=== ${client.id} / consecutive soft misses ===`);
      session.answers.forEach((answer,index)=>console.log(`${answer.criterion||expectedOrder[index]} МЕНЕДЖЕР: ${answer.text}\n${answer.criterion||expectedOrder[index]} КЛИЕНТ: ${answer.reply}`));
    }

    let rough = TrainingEngine.start(client, 'practice', 0);
    for (const criterion of ['C1','C2']) {
      rough = TrainingEngine.choose(rough, {...TrainingEngine.options(rough).answers.find(answer => answer.events.includes(criterion)),criterion});
    }
    for (const criterion of ['C3','C4']) {
      const options = TrainingEngine.options(rough);
      const hard = options.answers.find(answer => answer.rough && !answer.events.includes(criterion));
      if (!hard) continue;
      rough = TrainingEngine.choose(rough, {...hard,criterion});
    }
    if (rough.roughRun === 2) {
      hardPairChecked++;
      assert.equal(rough.done, true);
      assert.equal(rough.outcome, 'hangup');
      if (process.env.PRINT_SCENARIO_MATRIX === '1') {
        console.log(`\n=== ${client.id} / consecutive hard misses ===`);
        rough.answers.forEach((answer,index)=>console.log(`${answer.criterion||expectedOrder[index]} МЕНЕДЖЕР: ${answer.text}\n${answer.criterion||expectedOrder[index]} КЛИЕНТ: ${answer.reply}`));
      }
    }
  }
  assert.ok(hardPairChecked>0,'at least one hard-error pair must exercise the hangup path');
});

test('C5 disclosure is echoed in C6 and C4 hesitation is bridged before C5', () => {
  const choose = (session, criterion, predicate) => {
    const options = TrainingEngine.options(session);
    const answer = options.answers.find(predicate);
    assert.ok(answer, `${session.clientId}/${criterion}: answer exists`);
    return TrainingEngine.choose(session, {...answer,criterion});
  };

  for (const client of clients) {
    let session = TrainingEngine.start(client, 'practice', 0);
    for (const criterion of ['C1','C2','C3'])
      session = choose(session, criterion, answer => answer.events.includes(criterion));
    const c4 = TrainingEngine.options(session);
    const undecided = c4.answers.find(answer => !answer.events.includes('C4') && /не реш|приоритет|трудно сформулировать результат|присматриваюсь/i.test(answer.reply));
    assert.ok(undecided, `${client.id}: C4 includes an undecided-result reaction`);
    session = TrainingEngine.choose(session, {...undecided,criterion:'C4'});
    const c5 = TrainingEngine.options(session);
    assert.equal(c5.criterion, 'C5');
    assert.ok(c5.answers.some(answer => answer.text.includes(window.TRAINING_DATA.c4PauseBridge)),
      `${client.id}: all C5 choices acknowledge that the result can be defined at the visit`);

    let disclosed = TrainingEngine.start(client, 'practice', 0);
    for (const criterion of ['C1','C2','C3'])
      disclosed = choose(disclosed, criterion, answer => answer.events.includes(criterion));
    disclosed = choose(disclosed, 'C4', answer => !answer.events.includes('C4') && /не реш|приоритет|трудно сформулировать результат|присматриваюсь/i.test(answer.reply));
    disclosed = choose(disclosed, 'C5', answer => answer.events.includes('C5'));
    const c6 = TrainingEngine.options(disclosed);
    const best = c6.answers.find(answer => answer.events.includes('C6'));
    assert.ok(best, `${client.id}: a revealed need unlocks the standard C6 presentation`);
    assert.ok(best.companionContext, `${client.id}: C6 presentation acknowledges the company fact`);
    assert.match(best.text.slice(best.text.lastIndexOf('. ') + 2), /супруг|коллег|друг/i,
      `${client.id}: C6 includes the companion in the closing question`);
  }
});

test('manager buttons do not name undisclosed pool/back needs and stop phrase markup unwraps quotes', () => {
  for (const client of clients) {
    for (const [contextIndex] of client.starts.entries()) {
      let session = TrainingEngine.start(client, 'practice', contextIndex);
      for (const criterion of ['C1','C2'])
        session = TrainingEngine.choose(session, {...TrainingEngine.options(session).answers.find(answer => answer.events.includes(criterion)),criterion});
      session = TrainingEngine.choose(session, {...TrainingEngine.options(session).answers.find(answer => !answer.events.includes('C3')&&!answer.rough&&answer.events.length===0),criterion:'C3'});
      const c4 = TrainingEngine.options(session);
      assert.ok(c4.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
        `${client.id}/${contextIndex}: closed C4 asks without assuming zones or pain`);
      session = TrainingEngine.choose(session, {...c4.answers.find(answer => !answer.events.includes('C4')&&!answer.rough&&answer.events.length===0),criterion:'C4'});
      session = TrainingEngine.choose(session, {...TrainingEngine.options(session).answers.find(answer => answer.events.includes('C5')),criterion:'C5'});
      const blind = TrainingEngine.options(session);
      assert.equal(blind.criterion, 'C6');
      assert.ok(blind.answers.every(answer => !/(бассейн|спин)/i.test(answer.text)),
        `${client.id}/${contextIndex}: blind C6 does not invent a pool or back need`);
      assert.ok(blind.answers.every(answer => answer.events.length===0&&!answer.returnTo),
        `${client.id}/${contextIndex}: blind C6 is unscored and forward-only`);
    }
  }

  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(appSource, /plainStopPhrase\s*=\s*s\s*=>/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf("function call()"), appSource.indexOf("function finish()")), /stopword-feedback|esc\(opt.prompt\)/);
  assert.doesNotMatch(appSource, /«\$\{esc\(stopwordFeedback\.phrase\)\}»/);
});

test('C10 soft and hard misses are recorded for every client and opening', () => {
  for (const client of clients) {
    for (const [contextIndex] of client.starts.entries()) {
      const start = TrainingEngine.start(client, 'practice', contextIndex);
      let session = start;
      for (const criterion of expectedOrder.slice(0, -1)) {
        const answer = TrainingEngine.options(session).answers.find(option => option.events.includes(criterion));
        assert.ok(answer, `${client.id}/${contextIndex}/${criterion}: ideal prefix exists`);
        session = TrainingEngine.choose(session, {...answer,criterion});
      }
      const finalOptions = TrainingEngine.options(session);
      assert.equal(finalOptions.criterion, 'C10');
      for (const answer of finalOptions.answers.filter(option => !option.events.includes('C10'))) {
        const outcome = answer.rough ? 'hard' : 'soft';
        const finished = TrainingEngine.choose(session, {...answer,criterion:'C10'});
        assert.equal(finished.done, true);
        assert.equal(finished.lastOutcome, outcome);
        assert.equal(finished.lastFailedCriterion, 'C10');
        assert.equal(TrainingEngine.result(finished).scores.C10, 0);
        if (process.env.PRINT_SCENARIO_MATRIX === '1') {
          console.log(`\n=== ${client.id} / start ${contextIndex + 1} / C10 miss (${outcome}) ===`);
          finished.answers.forEach((turn,index)=>{
            const stepId=turn.criterion||finished.context.steps[index]?.[0]||'—';
            console.log(`${stepId} МЕНЕДЖЕР: ${turn.text}\n${stepId} КЛИЕНТ: ${turn.reply}`);
          });
        }
      }
    }
  }
});
test('Вопрос в каждом ходе, ценовой якорь и четыре уровня раскрытия', () => {
  const data = window.TRAINING_DATA;
  function check(answer, criterion) {
    assert.match(answer.text, /\?$/u, answer.text);
    if (answer.events.includes(criterion)) {
      assert.doesNotMatch(answer.text, /89\s*100|гадать по цифрам|состав сделки|порядок цены|сверить тарифы|с учётом вашего прошлого опыта|полная сумма/iu);
    }
    if (/89\s*100/u.test(answer.text)) {
      assert.equal(answer.earlyLeakKind, 'price');
      assert.equal(answer.events.length, 0);
    }
  }
  for (const client of data.clients) {
    for (const context of client.starts) {
      for (const [criterion, , answers] of context.steps) answers.forEach(answer => check(answer, criterion));
    }
    for (const missed of [[], ['C3'], ['C4'], ['C3', 'C4']]) {
      let session = TrainingEngine.start(client, 'practice', 0);
      while (!session.done) {
        const {criterion, answers} = TrainingEngine.options(session);
        answers.forEach(answer => check(answer, criterion));
        const best = answers.find(answer => answer.events.includes(criterion));
        const soft = answers.find(answer => !answer.events.length && !answer.rough && !answer.earlyLeakKind);
        for (const choice of answers) {
          const next = TrainingEngine.choose(session, choice);
          if (!next.done) {
            const options = TrainingEngine.options(next);
            options.answers.forEach(answer => check(answer, options.criterion));
          }
          if (choice.earlyLeakKind === 'price') assert.equal(next.earlyPriceLeak, true);
        }
        session = TrainingEngine.choose(session, missed.includes(criterion) ? soft : best || soft);
      }
      assert.equal(TrainingEngine.result(session).total, [20, 18, 14][missed.length]);
    }
  }
});
test('Заметки раскрываются по ходу звонка, C10 фиксирует визит одним вопросом', () => {
  for (const client of clients) {
    let session = TrainingEngine.start(client, 'practice', 0);
    const notes = [];
    while (!session.done) {
      assert.deepEqual(session.revealedClueIds, notes);
      const { criterion, answers } = TrainingEngine.options(session);
      const answer = answers.find(option => option.events.includes(criterion));
      if (criterion === 'C10') {
        assert.equal(answer.text.match(/\?/g)?.length, 1);
        for (const word of ['10 минут', 'без обязательств', 'у входа', 'WhatsApp']) assert.ok(answer.text.includes(word));
      }
      if (['C3', 'C4', 'C5'].includes(criterion)) notes.push(criterion);
      session = TrainingEngine.choose(session, answer);
    }
  }
});

test('C2 получает согласие, а C6 показывает два направления и завершает презентацию вопросом', () => {
  for (const client of clients) {
    const steps = client.starts[0].steps;
    const consent = steps.find(([id]) => id === 'C2')[2].find(a => a.events.includes('C2'));
    assert.match(consent.text, /пару|два/i);
    assert.match(consent.text, /вопрос/i);
    assert.match(consent.text, /формат карты/i);
    assert.match(consent.reply, /спрашивайте|давайте/i);
    for (const clues of [['C3'], ['C4'], ['C3', 'C4']]) {
      const session = TrainingEngine.start(client, 'practice', 0);
      session.step = steps.findIndex(([id]) => id === 'C6');
      session.revealedClueIds = clues;
      const offer = TrainingEngine.options(session).answers.find(a => a.events.includes('C6'));
      assert.match(offer.text, /^[^?]+\?$/u);
      if (clues.length === 2) {
        const features = {
          analyst: [/бассейн 25 метров/, /термальная зона/i],
          driver: [/парковка/i, /дублирующ.*тренажёр/i],
          woman: [/взрослая чаша/i, /личный менеджер/, /СПА/],
          novice: [/инструктаж/, /кардио-зон/]
        };
        for (const feature of features[client.id]) assert.match(offer.text, feature);
      }
      if (!clues.includes('C3')) assert.doesNotMatch(offer.text, /в прошлом|в прежнем|в старый зал/i);
    }
  }
});

test('Цена на C2 появляется только после вопроса клиента, на C3 нет общей приставки', () => {
  for (const c of clients) {
    for (const [opening] of c.starts.entries()) {
      let s = TrainingEngine.start(c, 'practice', opening);
      const price = /стоимост|сколько(?: у вас)? стоит|цен[ауеы]|89\s*100/iu;
      assert.doesNotMatch(s.context.prompt, price);
      const first = TrainingEngine.options(s);
      for (const option of first.answers) {
        assert.doesNotMatch(option.text, price);
        const next = TrainingEngine.choose(s, option);
        const options = TrainingEngine.options(next).answers;
        assert.equal(options.some(a => price.test(a.text)), price.test(next.lastClientReply));
        assert.ok(next.lastClientReply.endsWith(c.starts[opening].request));
        assert.equal(next.nameKnown, Boolean(option.asksGuestName));
        const standard = options.find(a => a.events.includes('C2'));
        assert.equal(price.test(standard.text), price.test(c.starts[opening].request));
        if (opening === 1) assert.match(standard.text, /Спасибо.*подобрать формат.*пару коротких вопросов\?/u);
        for (const miss of options.filter(a => !a.events.length)) {
          const after = TrainingEngine.choose(next, miss);
          if (!after.done) {
            const questions = TrainingEngine.options(after).answers;
            assert.equal(new Set(questions.map(q => q.text.slice(0, 20))).size > 1, true);
          }
        }
      }
    }
  }
});

test('Имя распознаётся в косвенном падеже и запоминается с начала звонка', () => {
  const examples = {analyst:['Алексея','Алексеевич'],driver:['Максиму','максимальный'],woman:['Елене','зелени'],novice:['Ильёй','Васильев']};
  for (const c of clients) {
    const [form, unrelated] = examples[c.id];
    const start = TrainingEngine.start(c,'practice',0);
    const answer = TrainingEngine.options(start).answers[0];
    const choose = (s,reply) => TrainingEngine.choose(s,{...answer,reply});
    assert.equal(choose(start,unrelated).nameKnown,false);
    const introduced = choose(start,form);
    assert.equal(introduced.nameKnown,true);
    assert.equal(choose(introduced,'Спасибо.').nameKnown,true);
    assert.equal(TrainingEngine.start({...c,starts:[{...start.context,prompt:form}]},'practice',0).nameKnown,true);
  }
});

test('Штраф −8 учитывает сумму, этап и число раскрытых улик', () => {
  const start = TrainingEngine.start(clients[0],'practice',0);
  for (const [criterion, clues, text, leak] of [
    ['C2', [], '4 000 ₽ в месяц', true],
    ['C6', ['C3','C4'], '4 000 ₽ в месяц', false],
    ...['C7','C8','C9','C10'].flatMap(id => [
      [id, [], 'От 4 000 ₽ в месяц на 12 месяцев, визит в 19:00', false],
      [id, ['C3','C4'], '89 100 рублей', true]
    ]),
    ['C1', [], 'Зайдёте на 10 минут в 19:00?', false]
  ]) {
    const session = {...start,step:start.context.steps.findIndex(([id])=>id===criterion),revealedClueIds:clues};
    const next = TrainingEngine.choose(session,{text,delta:-2,rough:false,events:[],reply:'Понятно.'});
    assert.equal(next.answers.at(-1).earlyLeakTriggered,leak);
    assert.equal(next.trust,48-(leak?8:0));
  }
});

test('C1: сочетания приветствия и стартового запроса для всех контекстов', () => {
  const names = {analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'};
  for (const client of clients) {
    for (const [opening] of client.starts.entries()) {
      const session = TrainingEngine.start(client, 'practice', opening);
      const options = TrainingEngine.options(session);
      const greetings = [
        [options.answers.find(a => a.events.includes('C1')), true, true],
        [options.answers.find(a => a.rough), false, false],
        [options.answers.find(a => /Территорию Фитнеса/u.test(a.text)), true, false],
        [options.answers.find(a => /меня зовут Анастасия/u.test(a.text)), false, false]
      ];
      assert.equal(new Set(greetings.map(([answer]) => answer)).size, 4);
      for (const [answer, asksName, fullGreeting] of greetings) {
        const next = TrainingEngine.choose(session, answer);
        const name = names[client.id];
        const c2 = TrainingEngine.options(next);
        assert.equal(Boolean(answer.asksGuestName), asksName);
        assert.equal(/как (?:могу к вам|к вам) обращаться/iu.test(answer.text), asksName);
        assert.equal(next.lastClientReply.includes(name), asksName);
        assert.equal(next.nameKnown, asksName);
        assert.equal(answer.events.includes('C1'), fullGreeting);
        assert.equal(TrainingEngine.result(next).scores.C1, 0);
        assert.equal(c2.criterion, 'C2');
        const priceRequested = /стоимост|сколько(?: у вас)? стоит/iu.test(session.context.request);
        assert.equal(/цен[еу]|стоимост/iu.test(c2.answers.find(a => a.events.includes('C2')).text), priceRequested);
        if (asksName && priceRequested) {
          assert.ok(c2.answers.find(a => a.events.includes('C2')).text.includes(name));
        }
        let continuing = next;
        while (!continuing.done) {
          const stage = TrainingEngine.options(continuing);
          if (!asksName) assert.ok(stage.answers.every(a => !a.text.includes(name)));
          continuing = TrainingEngine.choose(continuing, stage.answers.find(a => a.events.includes(stage.criterion)));
        }
        const namedTurns = continuing.answers.filter(a => a.addressedGuestByName).length;
        assert.equal(namedTurns >= 2, asksName);
        assert.equal(TrainingEngine.result(continuing).scores.C1, fullGreeting ? 2 : 0);
      }
    }
  }
});

test('C1 оценивает обращения в отдельных выбранных ходах и сохраняет порог зачёта', () => {
  const client = clients.find(c => c.id === 'analyst');
  const neutral = 'Удобно обсудить детали?';
  const address = 'Алексей, удобно обсудить детали?';
  function run(greeting, lines, introduction) {
    let session = TrainingEngine.start(client, 'practice', 0);
    const first = TrainingEngine.options(session).answers.find(greeting);
    session = TrainingEngine.choose(session, introduction === undefined ? first : {...first, reply: introduction});
    let i = 0;
    while (!session.done) {
      const {criterion, answers} = TrainingEngine.options(session);
      const standard = answers.find(a => a.events.includes(criterion));
      session = TrainingEngine.choose(session, {...standard, text: lines[i++] ?? neutral});
    }
    return TrainingEngine.result(session);
  }
  const corporate = a => a.events.includes('C1');
  const incomplete = a => /Территорию Фитнеса/u.test(a.text);
  for (const [count, expected] of [[0,0], [1,0], [2,2], [3,2]]) {
    const result = run(corporate, Array(count).fill(address));
    assert.equal(result.scores.C1, expected);
    assert.equal(result.total, 18 + expected);
    assert.equal(result.passed, true);
  }
  for (const count of [2,3]) assert.equal(run(incomplete, Array(count).fill(address)).scores.C1, 0);
  assert.equal(run(corporate, ['Алексей, уточню, Алексей, удобно?']).scores.C1, 0);
  assert.equal(run(corporate, ['Похоже, это Алексеевич?', 'Сравните с предложением Алексея?']).scores.C1, 0);
  assert.equal(run(corporate, [address, address], 'Можно узнать стоимость?').scores.C1, 0);
  assert.equal(run(corporate, [address, 'Подходит ли вам такой вариант, Алексей?']).scores.C1, 2);

  let unnamed = TrainingEngine.start(client, 'practice', 0);
  const greeting = TrainingEngine.options(unnamed).answers.find(corporate);
  unnamed = TrainingEngine.choose(unnamed, {...greeting, text:address, reply:'Я Алексей.'});
  assert.equal(unnamed.answers.at(-1).addressedGuestByName, false);
  const firstNamed = TrainingEngine.options(unnamed).answers.find(a => a.events.includes('C2'));
  unnamed = TrainingEngine.choose(unnamed, {...firstNamed, text:address});
  assert.equal(TrainingEngine.result(unnamed).scores.C1, 0);
});

test('C6 сохраняет четыре состояния раскрытия во всех контекстах', () => {
  const data = window.TRAINING_DATA;
  const recap = {
    analyst: [/раньше.*тесно/i, /плавать в своём темпе.*спину/i],
    driver: [/раньше.*дорог/i, /успевать в зал после работы/i],
    woman: [/в прежнем клубе.*шум и очереди/i, /поплавать и переключиться/i],
    novice: [/первый опыт/i, /выносливость без перегруза/i]
  };
  const names = {analyst:'Алексей', driver:'Максим', woman:'Елена', novice:'Илья'};
  let longestStandards = 0;

  for (const client of clients) {
    for (const [opening] of client.starts.entries()) {
      const presentation = client.starts[opening].presentation;
      const family = presentation?.company;
      const strength = presentation && !family;
      const facts = family
        ? [/из-за семейного графика.*оставили зал/i, /хотите вернуться без разъездов/i]
        : strength
        ? [/раньше.*ждать стойку/i, /вернуть силу и выносливость/i]
        : recap[client.id];
      for (const missed of [[], ['C3'], ['C4'], ['C3','C4']]) {
        let session = TrainingEngine.start(client, 'practice', opening);
        while (TrainingEngine.options(session).criterion !== 'C6') {
          const {criterion, answers} = TrainingEngine.options(session);
          const answer = missed.includes(criterion)
            ? answers.find(a => a.id.endsWith('-2'))
            : answers.find(a => a.events.includes(criterion));
          session = TrainingEngine.choose(session, answer);
        }

        assert.deepEqual(session.revealedClueIds, ['C3','C4','C5'].filter(id => !missed.includes(id)));
        const {answers} = TrainingEngine.options(session);
        assert.equal(answers.length, 4);
        assert.equal(new Set(answers.map(a => a.reply)).size, 4);
        const standards = answers.filter(a => a.events.includes('C6'));
        assert.equal(standards.length, missed.length === 2 ? 0 : 1);

        for (const a of answers) {
          assert.match(a.text, /^[^?]+\?$/u);
          assert.ok(a.reply.trim());
          const next = TrainingEngine.choose(session, a);
          assert.equal(next.lastClientReply, a.reply);
          assert.equal(TrainingEngine.score(next).C6, a.events.includes('C6') ? 2 : 0);
          assert.equal(next.trust - session.trust, a.delta - (next.answers.at(-1).earlyLeakTriggered ? 8 : 0));
          if (!next.done) assert.equal(TrainingEngine.options(next).criterion, 'C9');
        }

        if (missed.length === 0) {
          const standard = standards[0];
          const summary = standard.text.split('. ')[0];
          for (const fact of facts) assert.match(summary, fact);
          assert.equal(standard.companionContext, true);
          if (family) assert.match(standard.text, /сын.*школ[ае] плавания.*технику с тренером/iu);
          else assert.ok(standard.text.endsWith(data.c6CompanionTail[client.id] + '?'));
          const lengths = answers.map(a => a.text.length);
          assert.ok(Math.max(...lengths) / Math.min(...lengths) <= 1.5);
          if (standard.text.length === Math.max(...lengths)) longestStandards++;
        } else if (missed.length === 1) {
          const unknown = facts[missed[0] === 'C3' ? 0 : 1];
          assert.ok(answers.every(a => !unknown.test(a.text)));
        } else {
          assert.ok(answers.every(a => !/(бассейн|спин|выносливост)/iu.test(a.text)));
        }

        if (strength) {
          const pool = /бассейн|плаван|спин|термальн/iu;
          const privateExperience = /занят[а-яё]* стойк|стойк[а-яё]* занят|собственным весом/iu;
          const privateMotive = /выносливост|после перерыва|вернуть силу/iu;
          assert.ok(answers.every(a => !pool.test(a.text+' '+a.reply)));
          if (missed.length === 2) assert.ok(answers.every(a => !/Hammer Strength|Concept2/iu.test(a.text)));
          else assert.match(standards[0].text, /Life Fitness.*функциональн/iu);
          let call = session;
          while (!call.done) {
            const stage = TrainingEngine.options(call);
            assert.ok(stage.answers.every(a => !pool.test(a.text+' '+a.reply)));
            if (missed.includes('C3')) assert.ok(stage.answers.every(a => !privateExperience.test(a.text)));
            if (missed.includes('C4')) assert.ok(stage.answers.every(a => !privateMotive.test(a.text)));
            const answer = stage.answers.find(a => a.events.includes(stage.criterion))
              ?? stage.answers.find(a => a.id.endsWith('-C6-list'));
            call = TrainingEngine.choose(call, answer);
          }
          assert.equal(TrainingEngine.result(call).total, [20,18,14][missed.length]);
        }

        const withoutName = TrainingEngine.options({...session, nameKnown:false});
        assert.ok(withoutName.answers.every(a => !a.text.includes(names[client.id])));
      }

      let recovering = TrainingEngine.start(client, 'practice', opening);
      while (TrainingEngine.options(recovering).criterion !== 'C5') {
        const {criterion, answers} = TrainingEngine.options(recovering);
        recovering = TrainingEngine.choose(recovering, answers.find(a => a.events.includes(criterion)));
      }
      for (const missedC5 of TrainingEngine.options(recovering).answers.filter(a => !a.events.includes('C5'))) {
        const next = TrainingEngine.choose(recovering, missedC5);
        const standard = TrainingEngine.options(next).answers.find(a => a.events.includes('C6'));
        assert.equal(standard.recoveryFrom, 'C5');
        for (const fact of facts) assert.match(standard.text.split('. ')[0], fact);
        const lead = recoveryLead(client.id, 'C5', next);
        assert.ok(Object.values(data.c5RecoveryCopy[client.id]).includes(lead));
        assert.equal(standard.text.split(lead).length, 2);
        assert.equal(standard.text.split(names[client.id]+',').length, 2);
        if (lead === data.c6CompanionTail[client.id]) {
          assert.ok(standard.text.endsWith(lead + '?'));
        }
      }
    }
  }
  assert.ok(longestStandards <= 4, 'the standard is not consistently the longest choice');
});

test('Семейный Алексей выпадает случайно, а восемь сочетаний C3–C5 сохраняют границы известных фактов', () => {
  const analyst = clients.find(client => client.id === 'analyst');
  assert.equal(clients.length,4);
  assert.equal(analyst.starts.length,4);
  const family = analyst.starts[3];
  const random = Math.random;
  try {
    for (let index=0; index<4; index++) {
      Math.random=()=>(index+0.5)/4;
      assert.equal(TrainingEngine.start(analyst).context,analyst.starts[index]);
    }
  } finally {
    Math.random=random;
  }

  const childDetails = /(?<![а-яё])сын(?:а|у|ом)?(?![а-яё])|восемь лет|8 лет|плаван|бассейн|после школы/iu;
  const notFamily = /супруг|термальн|морск.{0,10}вод|спин/iu;
  const prerequisites = ['C3','C4','C5'];
  for (let mask=0; mask<8; mask++) {
    const missed=prerequisites.filter((_,index)=>mask&(1<<index));
    let call=TrainingEngine.start(analyst,'practice',3);
    while (!call.done) {
      const {criterion,answers}=TrainingEngine.options(call);
      const best=answers.find(a=>a.events.includes(criterion));
      assert.equal(answers.length,4);
      for (const answer of answers) {
        assert.match(answer.text,/\?$/u);
        assert.doesNotMatch(answer.text+' '+answer.reply,notFamily);
        if (!call.revealedClueIds.includes('C5')) {
          assert.doesNotMatch(answer.text,childDetails);
          if (criterion!=='C5'||!answer.events.includes('C5')) assert.doesNotMatch(answer.reply,childDetails);
        }
        if (criterion==='C6') {
          const next=TrainingEngine.choose(call,answer);
          assert.equal(TrainingEngine.score(next).C6,answer.events.includes('C6')?2:0);
          assert.equal(next.trust-call.trust,answer.delta-(next.earlyPriceLeak?8:0));
          if (!next.done && !answer.events.includes('C6')) {
            const recovery=TrainingEngine.options(next);
            assert.equal(recovery.criterion,'C9');
            assert.ok(recovery.answers.every(a=>a.recoveryFrom==='C6'));
            if (missed.includes('C5')) assert.ok(recovery.answers.every(a=>!childDetails.test(a.text)));
          }
        }
      }
      if (criterion==='C6' && !best) assert.ok(missed.includes('C3')&&missed.includes('C4'));
      if (criterion==='C5') assert.match(best.text,/Вы упомянули ребёнка/u);
      if (criterion==='C6' && best && !missed.includes('C5')) assert.match(best.text,/школ[ае] плавания.*технику с тренером/u);
      if (criterion==='C6' && missed.length===0) {
        for (const [pattern, events, trust, rough] of [
          [/отрабатывать технику/u, ['C6'], 3, false],
          [/выбрать аквакомплекс/u, [], -18, true],
          [/оснащение зала и детские программы/u, [], 0, false],
          [/Могу отправить расписание/u, [], -2, false]
        ]) {
          const answer=answers.find(a=>pattern.test(a.text));
          assert.ok(answer);
          assert.deepEqual([answer.events,answer.delta,answer.rough],[events,trust,rough]);
          assert.equal(TrainingEngine.choose(call,answer).earlyPriceLeak,false);
        }
        assert.ok(best.text.length<Math.max(...answers.map(a=>a.text.length)));
      }
      if (criterion==='C6' && best && missed.includes('C4')) assert.doesNotMatch(best.text,/без разъездов|вернуться к занятиям/u);
      if (criterion==='C6' && best && missed.includes('C3')) assert.doesNotMatch(best.text,/семейный график|семейного графика/u);
      if (criterion==='C9') assert.doesNotMatch(best.text,/\b\d{1,2}:\d{2}\b/u);
      if (criterion==='C7') {
        const [value, price] = best.text.split('При карте на 12 месяцев');
        assert.match(value,/на встрече.*(?:час|время)/iu);
        assert.match(price,/в среднем от 4 000 ₽ в месяц.*за год или помесячный вариант\?$/u);
        if (missed.includes('C4')) assert.doesNotMatch(value,/вернуться|без лишних поездок/u);
        assert.match(best.reply,/Помесячно мне удобнее.*внести сначала.*списывать оплату\?/u);
        const payment=TrainingEngine.options(TrainingEngine.choose(call,best)).answers.find(a=>a.events.includes('C8'));
        assert.match(payment.text,/вступительным взносом и ежемесячным автосписанием/u);
      }
      if (criterion==='C10') {
        assert.ok(!call.answers.some(a=>a.visitAgreement));
        assert.match(best.text,/встретить вас лично у входа.*WhatsApp — сможете заглянуть завтра в 18:30[^?]*\?$/u);
        assert.match(best.reply,/^Да, завтра в 18:30 смогу\./u);
        assert.equal(TrainingEngine.choose(call,best).answers.at(-1).visitAgreement,'confirmed');
        assert.ok(answers.filter(a=>a!==best).every(a=>!a.visitAgreement));
      }
      const answer=missed.includes(criterion)?answers.find(a=>a.id.endsWith('-2')):
        best??answers.find(a=>a.id.endsWith('-C6-list'));
      call=TrainingEngine.choose(call,answer);
    }
    const result=TrainingEngine.result(call);
    const blind=missed.includes('C3')&&missed.includes('C4');
    assert.equal(result.total,20-2*(missed.length+Number(blind)));
    assert.equal(result.passed,!missed.includes('C4'));
    assert.equal(result.outcome,result.passed?'iron':'cold');
    assert.equal(call.context,family);
  }

  let neutral=TrainingEngine.start(analyst,'practice',3);
  const greeting=TrainingEngine.options(neutral).answers.find(a=>a.events.includes('C1'));
  neutral=TrainingEngine.choose(neutral,{...greeting,reply:'Хотел бы узнать об условиях.'});
  while (TrainingEngine.options(neutral).criterion!=='C5') {
    const {criterion,answers}=TrainingEngine.options(neutral);
    neutral=TrainingEngine.choose(neutral,answers.find(a=>a.events.includes(criterion)));
  }
  const neutralC5=TrainingEngine.options(neutral).answers.find(a=>a.events.includes('C5'));
  assert.match(neutralC5.text,/для себя или кто-то из близких/u);
  assert.doesNotMatch(neutralC5.text,/ребёнка|Алексей/u);
});

test('Фактическое согласие на визит и зачёт звонка определяются отдельно', () => {
  function play(client, opening, select, initialTrust=50) {
    let call={...TrainingEngine.start(client,'practice',opening),trust:initialTrust};
    while(!call.done){
      const {criterion,answers}=TrainingEngine.options(call);
      const answer=select(criterion,answers) || answers.find(a=>a.events.includes(criterion));
      assert.ok(answer);
      call=TrainingEngine.choose(call,answer);
    }
    return call;
  }
  for(const client of clients)for(const opening of client.starts.keys()){
    const ideal=play(client,opening,()=>null);
    const result=TrainingEngine.result(ideal);
    assert.deepEqual([result.total,result.scores.C1,result.scores.C6,result.outcome,result.passed],[20,2,2,'iron',true]);
    assert.equal(ideal.answers.find(a=>a.events.includes('C9')).visitAgreement,undefined);
    assert.equal(ideal.answers.at(-1).visitAgreement,'confirmed');
    const hangup=TrainingEngine.result({...ideal,outcome:'hangup'});
    assert.deepEqual([hangup.total,hangup.outcome,hangup.passed],[20,'hangup',false]);

    const noConfirmation=play(client,opening,(id,answers)=>id==='C10'?answers.find(a=>!a.events.length&&!a.rough):null);
    assert.deepEqual([noConfirmation.outcome,TrainingEngine.result(noConfirmation).passed],['think',false]);
    const accepted={...noConfirmation,answers:noConfirmation.answers.map((a,i)=>i===noConfirmation.answers.length-1?{...a,visitAgreement:'accepted'}:a)};
    assert.deepEqual([TrainingEngine.result(accepted).outcome,TrainingEngine.result(accepted).passed],['cold',false]);

    const missedInvite=play(client,opening,(id,answers)=>id==='C9'?answers.find(a=>!a.events.length&&!a.rough):null);
    assert.equal(missedInvite.lastClientReply,ideal.lastClientReply);
    assert.deepEqual([TrainingEngine.result(missedInvite).total,missedInvite.outcome,TrainingEngine.result(missedInvite).passed],[18,'cold',false]);

    const forbidden=play(client,opening,(id,answers)=>id==='C7'?answers.find(a=>/89 100/u.test(a.text)):null);
    assert.equal(forbidden.earlyPriceLeak,true);
    assert.equal(TrainingEngine.result(forbidden).passed,false);
  }
  const client=clients[0];
  const rough=(criterion,answers)=>answers.find(a=>a.rough);
  const low=play(client,0,rough,30);
  assert.deepEqual([low.answers.length,low.outcome,TrainingEngine.result(low).passed],[1,'hangup',false]);
  const twice=play(client,0,rough);
  assert.deepEqual([twice.answers.length,twice.roughRun,twice.outcome,TrainingEngine.result(twice).passed],[2,2,'hangup',false]);
});

test('Тайм-ауты учитывают только время и доверие, сохраняя выбранные ходы', () => {
  const client=clients[0];
  let call=TrainingEngine.start(client,'practice',0);
  for(let i=0;i<3;i++){
    const {criterion,answers}=TrainingEngine.options(call);
    call=TrainingEngine.choose(call,answers.find(a=>a.events.includes(criterion)));
  }
  const before=TrainingEngine.result(call);
  const timed=TrainingEngine.timeout(TrainingEngine.timeout(call));
  assert.deepEqual(timed.timeouts,[
    {criterion:'C4',trustBefore:call.trust,trustAfter:call.trust-8},
    {criterion:'C4',trustBefore:call.trust-8,trustAfter:call.trust-16}
  ]);
  assert.strictEqual(timed.answers,call.answers);
  assert.strictEqual(timed.revealedClueIds,call.revealedClueIds);
  assert.equal(timed.step,call.step);
  assert.equal(timed.roughRun,call.roughRun);
  assert.deepEqual(TrainingEngine.result(timed),before);
  assert.equal(call.timeouts,undefined);
  const terminal=TrainingEngine.timeout({...timed,trust:23});
  assert.deepEqual([terminal.trust,terminal.done,terminal.outcome],[15,true,'hangup']);
  assert.strictEqual(TrainingEngine.timeout(terminal),terminal);
  assert.equal(TrainingEngine.result(terminal).total,before.total);
  assert.equal(TrainingEngine.result(terminal).passed,false);
});
