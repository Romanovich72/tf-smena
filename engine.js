window.TrainingEngine = (() => {
  const mix = list => { const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  function start(client,mode='practice',startIndex=null){
    const context=client.starts[startIndex??Math.floor(Math.random()*client.starts.length)];
    return {mode,clientId:client.id,clientName:client.name,image:client.image,context,trust:50,roughRun:0,revealedClues:0,revealedClueIds:[],earlyPriceLeak:false,step:0,answers:[],lastOutcome:null,lastFailedCriterion:null,failedCriteria:[],lastClientReply:'',done:false,outcome:null};
  }
  function clueIdsFor(session){return new Set([...(session.revealedClueIds||[]),...session.answers.flatMap(answer=>answer.events||[]).filter(id=>['C3','C4','C5'].includes(id))])}
  function options(session){
    const step=session.context.steps?.[session.step];
    if(!step)return null;
    const [criterion,stepPrompt,stepAnswers]=step;
    const clues=clueIdsFor(session);
    let prompt=stepPrompt,answers=stepAnswers;
    if(criterion==='C4'){
      const context=window.TRAINING_DATA.c4Context?.[session.clientId];
      const variant=clues.has('C3')?context?.afterExperience:context?.closed;
      if(variant){prompt=variant.prompt;answers=stepAnswers.map((answer,index)=>({...answer,text:variant.choices[index]??answer.text}))}
    }
    if(criterion==='C7'&&!clues.has('C3')&&!clues.has('C4')){
      const context=window.TRAINING_DATA.c7Context?.[session.clientId];
      if(context){prompt=context.prompt;answers=stepAnswers.map((answer,index)=>index===0?{...answer,text:context.text}:answer)}
    }
    if(criterion==='C6'&&!clues.has('C3')&&!clues.has('C4')){
      const blind=window.TRAINING_DATA.blindC6?.[session.clientId];
      if(blind){prompt=blind.prompt;answers=blind.answers}
    }
    if(['soft','hard'].includes(session.lastOutcome)&&session.lastFailedCriterion){
      const recovery=window.TRAINING_DATA.recoveryCopy?.[session.clientId]?.[session.lastFailedCriterion];
      if(criterion==='C2'&&session.lastFailedCriterion==='C1'){
        const guestName={analyst:'Алексей',driver:'Максим',woman:'Елена',novice:'Илья'}[session.clientId];
        answers=answers.map(answer=>({...answer,text:answer.text.replace(`${guestName}, `,'')}));
      }
      const standardIndex=answers.findIndex(answer=>answer.events?.includes(criterion));
      if(recovery&&standardIndex>=0){
        const standard=answers[standardIndex];
        const apology=session.lastOutcome==='hard'
          ? (window.TRAINING_DATA.recoveryHardLead?.[session.clientId]||'Извините, я ответил не по сути. ')
          : '';
        let lead=recovery;
        if(session.lastFailedCriterion==='C7'&&criterion==='C8')lead=`${lead}Помесячный формат — альтернатива оплате годовой карты сразу; `;
        answers=answers.map((answer,index)=>index===standardIndex?{
          ...answer,
          text:`${apology}${lead}${standard.text}`,
          recoveryFrom:session.lastFailedCriterion,
          recoveryOutcome:session.lastOutcome
        }:answer);
        prompt=`${prompt} Учтите последнюю реплику клиента: «${session.lastClientReply}»`;
      }
    }
    return {criterion,prompt,answers:mix(answers).map((a,i)=>({...a,display:i+1}))};
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
    const turnOutcome=answer.events.includes(criterion)?'standard':answer.rough?'hard':'soft';
    const failedCriteria=turnOutcome==='standard'?(session.failedCriteria||[]):[...new Set([...(session.failedCriteria||[]),criterion])];
    const trustDelta=answer.delta-(earlyLeakTriggered?8:0);
    const nextStep=answer.returnTo?session.context.steps.findIndex(step=>step[0]===answer.returnTo):session.step+1;
    const next={...session,answers:[...session.answers,trackedAnswer],trust:Math.max(0,Math.min(100,session.trust+trustDelta)),roughRun:answer.rough?session.roughRun+1:0,revealedClues:clueIds.size,revealedClueIds:[...clueIds],earlyPriceLeak:session.earlyPriceLeak||earlyLeakTriggered,step:nextStep>=0?nextStep:session.step+1,lastOutcome:turnOutcome,lastFailedCriterion:turnOutcome==='standard'?null:criterion,failedCriteria,lastClientReply:trackedAnswer.reply||''};
    if(next.trust<=15||next.roughRun>=2){next.done=true;next.outcome='hangup';return next;}
    if(next.step>=session.context.steps.length){next.done=true;const r=result(next);next.outcome=r.passed?'iron':next.answers.some(a=>a.events.includes('C9'))?'cold':'think';}
    return next;
  }
  function score(s){const got=new Set(s.answers.flatMap(a=>a.events));return Object.fromEntries(window.TRAINING_DATA.checklist.map(c=>[c.id,got.has(c.id)?2:0]));}
  function result(s){const scores=score(s),total=Object.values(scores).reduce((a,b)=>a+b,0);return {scores,total,earlyPriceLeak:Boolean(s.earlyPriceLeak),passed:!s.earlyPriceLeak&&total>=16&&scores.C4===2&&scores.C9===2&&scores.C10===2,outcome:s.outcome};}
  return {start,options,choose,score,result,mix};
})();
