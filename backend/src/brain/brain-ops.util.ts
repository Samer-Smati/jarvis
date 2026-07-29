export type BrainMutatingAction = 'cleanup' | 'consolidate' | 'rehydrate_from_pg';

export const BRAIN_OPS_BLOCKED_MESSAGE =
  'Brain operations are paused, sir — cleanup, consolidate, and rehydrate are blocked until you resume. Say "resume brain operations" or use the settings toggle.';

export const BRAIN_MUTATING_ACTIONS = new Set<string>(['cleanup', 'consolidate', 'rehydrate_from_pg']);

export function isBrainMutatingAction(action: string): action is BrainMutatingAction {
  return BRAIN_MUTATING_ACTIONS.has(action.trim());
}

export function isBrainOpsVocabulary(text: string): boolean {
  return /\b(brain|graph|wiki|vault|notes?|pages?|links?|nodes?|cleanup|clean\s?up|consolidat|rehydrate|relational mapping)\b/i.test(
    text,
  );
}

export function isBrainOpsDenyOrComplaint(text: string): boolean {
  const t = text.trim();
  if (!isBrainOpsVocabulary(t)) {
    return false;
  }
  if (
    /\b(do not|don't|stop|halt|no more|never run|until i (review|approve|say)|why did you (run|do)|not respecting|concerned about|you ignored|you proceeded)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(do not run|don't run|stop running|halt)\b.{0,50}\b(cleanup|consolidate|rehydrate|brain ops?)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function isBrainOpsPauseRequest(text: string): boolean {
  if (isBrainOpsResumeRequest(text)) {
    return false;
  }
  const t = text.trim();
  if (/\b(pause brain|freeze brain|brain ops paused)\b/i.test(t)) {
    return true;
  }
  return isBrainOpsDenyOrComplaint(t) && /\b(do not|don't|stop|halt|no more|until i review|pause|freeze)\b/i.test(t);
}

export function isBrainOpsResumeRequest(text: string): boolean {
  const t = text.trim();
  return /\b(resume brain operations|unpause brain|enable brain ops|brain ops resume|resume brain ops)\b/i.test(t);
}

export function isMetaComplaintForFiling(text: string): boolean {
  const t = text.trim();
  if (isBrainOpsDenyOrComplaint(t)) {
    return true;
  }
  if (/\b(concerned about|not respecting|why did you|you ignored|stop running|do not run)\b/i.test(t)) {
    return true;
  }
  return false;
}
