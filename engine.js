window.TrainingEngine = (() => {
  const mix = list => { const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const joinRecovery=(lead,line)=>`${lead}${/[.!?…]\s*$/u.test(lead)?String(line).replace(/^([а-яё])/u,letter=>letter.toLocaleUpperCase('ru')):line}`;
  function start(client,mode='practice',startIndex=null){
    const context=client.starts[startIndex??Math.floor(Math.random()*client.starts.length)];
    return {mode,clientId:client.id,clientName:client.name,image:client.image,context,trust:50,roughRun:0,revealedClues:0,revealedClueIds:[],earlyPriceLeak:false,step:0,answers:[],lastOutcome:null,lastFailedCriterion:null,failedCriteria:[],lastClientReply:'',nameKnown:false,done:false,outcome:null};
  }
  function clueIdsFor(session){return new Set([...(session.revealedClueIds||[]),...session.answers.flatMap(answer=>answer.events||[]).filter(id=>['C3','C4','C5'].includes(id))])}
  function options(session){
    const step=session.context.steps?.[session.step];
    if(!step)return null;
    const [criterion,stepPrompt,stepAnswers]=step;
    const clues=clueIdsFor(session);
    const companyDisclosed=/(^|[^а-яё])(?:супруг(?:а|у|ом|е|ой)?|муж(?:а|у|ем)?|жен(?:а|у|ой|е)?|коллег(?:а|у|ой|и|ами)?|друг(?:а|у|ом|е|ьями)?|подруг(?:а|у|ой|и|ами)?|с семь(?:ёй|е|ёй))(?=$|[^а-яё])/i.test(session.lastClientReply||'');
    let prompt=stepPrompt,answers=stepAnswers;
    if(criterion==='C4'){
      const context=window.TRAINING_DATA.c4Context?.[session.clientId];
      const variant=clues.has('C3')?context?.afterExperience:context?.closed;
      if(variant){prompt=variant.prompt;answers=stepAnswers.map((answer,index)=>({...answer,text:variant.choices[index]??answer.text}))}
    }
    if(criterion==='C7'&&!clues.has('C4')){
      const context=window.TRAINING_DATA.c7Context?.[session.clientId];
      if(context){prompt=context.prompt;answers=stepAnswers.map((answer,index)=>index===0?{...answer,text:context.text}:answer)}
    }
    if(criterion==='C6'&&!clues.has('C3')&&!clues.has('C4')){
      const blind=window.TRAINING_DATA.blindC6?.[session.clientId];
      if(blind){prompt=blind.prompt;answers=blind.answers}
    }
    if(criterion==='C6'&&(clues.has('C3')||clues.has('C4'))){
      const choices=window.TRAINING_DATA.knownC6Choices?.[session.clientId];
      const reactions=window.TRAINING_DATA.knownC6Replies?.[session.clientId];
      if(choices)answers=answers.map((answer,index)=>({...answer,text:choices[index]??answer.text,reply:reactions?.[index]??answer.reply}));
    }
    if(criterion==='C9'&&!clues.has('C3')&&!clues.has('C4')){
      const closed=window.TRAINING_DATA.c9Closed?.[session.clientId];
      if(closed){prompt=closed.prompt;answers=stepAnswers.map((answer,index)=>({...answer,text:closed.choices[index]??answer.text}))}
    }

    const recoveringC5=session.lastOutcome&&session.lastFailedCriterion==='C5'&&criterion==='C6';
    if(criterion==='C6'&&companyDisclosed&&!recoveringC5){
      const companyLead=window.TRAINING_DATA.c6CompanionLead?.[session.clientId];
      if(companyLead){
        const standardIndex=answers.findIndex(answer=>answer.events?.includes('C6'));
        if(standardIndex>=0)answers=answers.map((answer,index)=>index===standardIndex?{...answer,text:`${companyLead}${answer.text}`,companionContext:true}:answer);
        else answers=answers.map((answer,index)=>index===0?{...answer,text:`${companyLead}${answer.text}`,companionContext:true}:answer);
      }
    }
    if(['soft','hard'].includes(session.lastOutcome)&&session.lastFailedCriterion){
      let recovery=window.TRAINING_DATA.recoveryCopy?.[session.clientId]?.[session.lastFailedCriterion];
      if(session.lastFailedCriterion==='C5'&&criterion==='C6'){
        const reply=session.lastClientReply||'';
        const kind=companyDisclosed?'companion':/(знакомств|первого визит|встреч)/i.test(reply)?'visit':/(распис|график|слот|врем[яеи])/i.test(reply)?'schedule':/(карт|формат|тариф|стоим|цен|семейн)/i.test(reply)?'card':'other';
        recovery=window.TRAINING_DATA.c5RecoveryCopy?.[session.clientId]?.[kind]||recovery;
      }
      if(session.lastFailedCriterion==='C8'&&criterion==='C10'){
        const reply=session.lastClientReply||'';
        const kind=/(перв.{0,12}плат|платеж|платёж|списан|автоспис)/i.test(reply)?'payment':/(прозрач|схема понятн|условия ясн|теперь понятн|всё понятн)/i.test(reply)?'clear':/(срав|только сразу|разн.{0,15}способ|распределить оплат)/i.test(reply)?'comparison':'default';
        recovery=window.TRAINING_DATA.c8RecoveryCopy?.[session.clientId]?.[kind]||recovery;
      }
      const reopensExperience=criterion==='C4'&&session.lastFailedCriterion==='C3'&&/(хотел[аи]? сначала рассказать|не успел[аи]? рассказать|хотел[аи]? рассказать.*опыт|не рассказал[аи].*опыт|мешало заниматься раньше)/i.test(session.lastClientReply||'');
      if(reopensExperience){
        const repair=window.TRAINING_DATA.c4ExperienceRecoveryChoices?.[session.clientId];
        if(repair?.length===answers.length){
          const apology=session.lastOutcome==='hard'?(window.TRAINING_DATA.recoveryHardLead?.[session.clientId]||'Извините, я ответил не по сути. '):'';
          answers=answers.map((answer,index)=>({...answer,text:`${apology}${repair[index].text}`,reply:repair[index].reply,recoveryFrom:session.lastFailedCriterion,recoveryOutcome:session.lastOutcome}));
          prompt=`${prompt} Учтите последнюю реплику клиента: «${session.lastClientReply}»`;
          recovery=null;
        }
      }
      if(session.lastFailedCriterion==='C6'&&criterion==='C9'){
        const reply=session.lastClientReply||'';
        if(/дорог|маршрут|сколько обычно занимает|время в пути|какой вечерний слот/i.test(reply))recovery=window.TRAINING_DATA.c6ReplyRecovery?.route?.[session.clientId]||recovery;
        else if(/сервис|сопровожд|встреч|очеред|по шагам|первые упражнения|тренер/i.test(reply))recovery=window.TRAINING_DATA.c6ReplyRecovery?.service?.[session.clientId]||recovery;
        else if(/не одному|не одна|вместе|друг|подруг|супруг|коллег|близк/i.test(reply))recovery=window.TRAINING_DATA.c6ReplyRecovery?.companion?.[session.clientId]||recovery;
        else {
          const recoverySet=clues.has('C4')?window.TRAINING_DATA.c6NeedRecovery:clues.has('C3')?window.TRAINING_DATA.c6ExperienceRecovery:window.TRAINING_DATA.c6GenericRecovery;
          recovery=recoverySet?.[session.clientId]||recovery;
        }
      }
      if(session.lastFailedCriterion==='C9'&&criterion==='C7'){
        const reply=session.lastClientReply||'';
        if (/(куда идти|не понять[, ]+куда|добрат|маршрут|вход|где меня встрет|подтвержден|подтверждён)/i.test(reply))
          recovery=window.TRAINING_DATA.c9LogisticsRecovery?.[session.clientId]||recovery;
        else if (/(точн|дат[ауые]|врем[яеи]|слот|заранее|согласован|организован|не понят)/i.test(reply))
          recovery=window.TRAINING_DATA.c9TimeRecovery?.[session.clientId]||recovery;
      }
      if(session.lastFailedCriterion==='C4'&&criterion==='C5'){
        const reply=session.lastClientReply||'';
        if (/(не решил[аи]?|не решила|не определил[аи]?|пока не решил|пока не решила|не объяснил[аи].*(?:результат|задач)|какой результат.*приоритет|какую задачу.*главн|трудно сформулировать результат|пока только присматриваюсь|не знаю.*присматриваюсь)/i.test(reply))
          recovery=window.TRAINING_DATA.c4PauseBridge||recovery;
        else if (/(плав|спин|энерг|восстан|тонус|выносл|переключ|дорог|маршрут|график|комфорт|перегруз|поддерж|регулярн|форму|заниматься.*после)/i.test(reply))
          recovery=window.TRAINING_DATA.c4AcknowledgedNeedRecovery?.[session.clientId]||recovery;
      }
      if(criterion==='C2'&&session.lastFailedCriterion==='C1'){
        const guestName={analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'}[session.clientId];
        answers=answers.map(answer=>({...answer,text:answer.text.replace(`${guestName}, `,'')}));
      }
      if(recovery){
        const apology=session.lastOutcome==='hard'
          ? (window.TRAINING_DATA.recoveryHardLead?.[session.clientId]||'Извините, я ответил не по сути. ')
          : '';
        const lead=joinRecovery(apology,recovery);
        answers=answers.map(answer=>({
          ...answer,
          text:joinRecovery(lead,answer.text),
          recoveryFrom:session.lastFailedCriterion,
          recoveryOutcome:session.lastOutcome
        }));
        prompt=`${prompt} Учтите последнюю реплику клиента: «${session.lastClientReply}»`;
      }
    }
    if(!session.nameKnown){
      const guestName={analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'}[session.clientId];
      if(guestName)answers=answers.map(answer=>({...answer,text:answer.text.replaceAll(`${guestName}, `,'')}));
    }
    return {criterion,prompt,answers:mix(answers).map((a,i)=>({...a,text:String(a.text).replace(/^([а-яё])/u,letter=>letter.toLocaleUpperCase('ru')),display:i+1}))};
  }
  function choose(session,answer){
    if(session.done)return session;
    const criterion=session.context.steps?.[session.step]?.[0];
    const earlyStage=['C1','C2','C3','C4','C5','C6'].includes(criterion);
    const earlyLeakTriggered=Boolean(answer.earlyLeakKind)&&earlyStage&&(session.revealedClues||0)<2;
    const clueIds=clueIdsFor(session);
    answer.events.filter(id=>['C3','C4','C5'].includes(id)).forEach(id=>clueIds.add(id));
    const trackedAnswer={...answer,earlyLeakTriggered};
    if((session.earlyPriceLeak||earlyLeakTriggered)&&answer.pricePressureReply)trackedAnswer.reply=answer.pricePressureReply;
    const guestName={analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'}[session.clientId];
    const nameSpoken=guestName&&new RegExp(`(^|[^а-яё])${guestName}($|[^а-яё])`,'i').test(trackedAnswer.reply||'');
    const nameKnown=Boolean(session.nameKnown||answer.events.includes('C1')||nameSpoken);
    const turnOutcome=answer.events.includes(criterion)?'standard':answer.rough?'hard':'soft';
    const failedCriteria=turnOutcome==='standard'?(session.failedCriteria||[]):[...new Set([...(session.failedCriteria||[]),criterion])];
    const trustDelta=answer.delta-(earlyLeakTriggered?8:0);
    const nextStep=answer.returnTo?session.context.steps.findIndex(step=>step[0]===answer.returnTo):session.step+1;
    const next={...session,answers:[...session.answers,trackedAnswer],trust:Math.max(0,Math.min(100,session.trust+trustDelta)),roughRun:answer.rough?session.roughRun+1:0,revealedClues:clueIds.size,revealedClueIds:[...clueIds],earlyPriceLeak:session.earlyPriceLeak||earlyLeakTriggered,step:nextStep>=0?nextStep:session.step+1,lastOutcome:turnOutcome,lastFailedCriterion:turnOutcome==='standard'?null:criterion,failedCriteria,lastClientReply:trackedAnswer.reply||'',nameKnown};
    if(next.trust<=15||next.roughRun>=2){next.done=true;next.outcome='hangup';return next;}
    if(next.step>=session.context.steps.length){next.done=true;const r=result(next);next.outcome=r.passed?'iron':next.answers.some(a=>a.events.includes('C9'))?'cold':'think';}
    return next;
  }
  function score(s){const got=new Set(s.answers.flatMap(a=>a.events));return Object.fromEntries(window.TRAINING_DATA.checklist.map(c=>[c.id,got.has(c.id)?2:0]));}
  function result(s){const scores=score(s),total=Object.values(scores).reduce((a,b)=>a+b,0);return {scores,total,earlyPriceLeak:Boolean(s.earlyPriceLeak),passed:!s.earlyPriceLeak&&total>=16&&scores.C4===2&&scores.C9===2&&scores.C10===2,outcome:s.outcome};}
  return {start,options,choose,score,result,mix};
})();
