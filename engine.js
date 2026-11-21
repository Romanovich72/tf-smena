window.TrainingEngine = (() => {
  const mix = list => { const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  function start(client,mode='practice',startIndex=null){
    const context=client.starts[startIndex??Math.floor(Math.random()*client.starts.length)];
    return {mode,clientId:client.id,clientName:client.name,image:client.image,context,trust:50,roughRun:0,step:0,answers:[],done:false,outcome:null};
  }
  function options(session){ const step=session.context.steps?.[session.step]; return step?{criterion:step[0],prompt:step[1],answers:mix(step[2]).map((a,i)=>({...a,display:i+1}))}:null; }
  function choose(session,answer){
    if(session.done)return session;
    const next={...session,answers:[...session.answers,answer],trust:Math.max(0,Math.min(100,session.trust+answer.delta)),roughRun:answer.rough?session.roughRun+1:0,step:session.step+1};
    if(next.trust<=15||next.roughRun>=2){next.done=true;next.outcome='hangup';return next;}
    if(next.step>=session.context.steps.length){next.done=true;const r=result(next);next.outcome=r.passed?'iron':next.answers.some(a=>a.events.includes('C9'))?'cold':'think';}
    return next;
  }
  function score(s){const got=new Set(s.answers.flatMap(a=>a.events));return Object.fromEntries(window.TRAINING_DATA.checklist.map(c=>[c.id,got.has(c.id)?2:0]));}
  function result(s){const scores=score(s),total=Object.values(scores).reduce((a,b)=>a+b,0);return {scores,total,passed:total>=16&&scores.C4===2&&scores.C9===2&&scores.C10===2,outcome:s.outcome};}
  return {start,options,choose,score,result,mix};
})();
