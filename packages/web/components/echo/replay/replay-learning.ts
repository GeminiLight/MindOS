import type { ReplayScene, ReplayState, ReplayStep } from '@geminilight/mindos/knowledge/branch-replay';

/** Interpretations can only use quotations already revealed in this scene. */
export function learningForScene(scene:ReplayScene,state:ReplayState){
 const attempts=state.attempts.filter(attempt=>attempt.sceneId===scene.id);
 const steps:ReplayStep[]=attempts.flatMap(attempt=>scene.choices.find(c=>c.id===attempt.choiceId)?.outcome.steps.slice(0,attempt.visibleSteps)??[]);
 const references=steps.flatMap(step=>step.refs);
 const ready=attempts.length>1&&scene.reconsideration?.refs.every(ref=>references.some(seen=>seen.messageId===ref.messageId&&seen.quote.includes(ref.quote)));
 return {steps,attempts,prompt:ready?scene.reconsideration!.prompt:null,insight:ready?scene.reconsideration!.insight:null};
}
