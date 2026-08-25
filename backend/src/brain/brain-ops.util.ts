export type BrainMutatingAction = 'cleanup' | 'consolidate' | 'rehydrate_from_pg';

export const BRAIN_OPS_BLOCKED_MESSAGE =
  'Brain operations are paused, sir — cleanup, consolidate, and rehydrate are blocked until you resume. Say "resume brain operations" or use the settings toggle.';

export const BRAIN_MUTATING_ACTIONS = new Set<string>(['cleanup', 'consolidate', 'rehydrate_from_pg']);

const BRAIN_MUTATION_OPS =
  /\b(cleanup|clean\s?up|consolidate|consolidation|rehydrate|brain ops?|relational mapping)\b/i;

export function isBrainMutatingAction(action: string): action is BrainMutatingAction {
  return BRAIN_MUTATING_ACTIONS.has(action.trim());
}

export function isBrainOpsVocabulary(text: string): boolean {
  return /\b(brain|graph|wiki|vault|notes?|pages?|links?|nodes?|cleanup|clean\s?up|consolidat|rehydrate|relational mapping|deleted|removed)\b/i.test(
    text,
  );
}

export function isBrainUiDenyRequest(text: string): boolean {
  const t = text.trim();
  if (/\b(do not|don't|stop)\b.{0,30}\b(show|open|display)\b.{0,30}\b(graph|brain graph|knowledge graph)\b/i.test(t)) {
    return true;
  }
  if (/\b(do not|don't)\b.{0,40}\b(change the subject|go off topic|change topic)\b/i.test(t)) {
    return true;
  }
  if (/\bstop opening (the )?graph\b/i.test(t)) {
    return true;
  }
  return false;
}

export function isBrainOpsMetaQuestion(text: string): boolean {
  const t = text.trim();
  if (isBrainOpsResumeRequest(t)) {
    return false;
  }
  if (
    /\b(does a|is there a|do you have a)\b.{0,40}\b(deletion|cleanup|removal|audit)\b.{0,30}\b(log|trail|record|history)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(what pages were removed|list (the )?removed|which pages were deleted|what was deleted)\b/i.test(t)) {
    return true;
  }
  if (!isBrainOpsVocabulary(t)) {
    return false;
  }
  if (
    /\b(you did not answer|didn't answer|did you actually|why did you|what happened to|you ignored|twice now|never received|never got)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(deletion log|removed pages|deleted pages|audit trail|11 deleted|pages removed|cleanup removed)\b/i.test(t)) {
    return true;
  }
  if (/\b(did you|have you|was there)\b.{0,60}\b(cleanup|remove|delete|rehydrate|consolidate|pause|brain ops)\b/i.test(t)) {
    return true;
  }
  return false;
}

function isBrainOpsMutationHaltPhrase(text: string): boolean {
  const t = text.trim();
  if (/\b(do not run|don't run|stop running|halt)\b.{0,50}\b(cleanup|consolidate|rehydrate|brain ops?)\b/i.test(t)) {
    return true;
  }
  if (/\b(do not|don't|stop|halt|no more)\b.{0,40}\b(run|execute|perform)\b.{0,30}\b(cleanup|consolidate|rehydrate|brain ops?)\b/i.test(t)) {
    return true;
  }
  if (/\buntil i (review|approve|say)\b/i.test(t) && BRAIN_MUTATION_OPS.test(t)) {
    return true;
  }
  if (
    /\b(why did you (run|do)|not respecting|concerned about|you ignored|you proceeded|never run)\b/i.test(t) &&
    BRAIN_MUTATION_OPS.test(t)
  ) {
    return true;
  }
  return false;
}

export function isBrainOpsDenyOrComplaint(text: string): boolean {
  const t = text.trim();
  if (!isBrainOpsVocabulary(t)) {
    return false;
  }
  if (isBrainUiDenyRequest(t) || isBrainOpsMetaQuestion(t)) {
    return false;
  }
  return isBrainOpsMutationHaltPhrase(t);
}

export function isBrainOpsPauseRequest(text: string): boolean {
  if (isBrainOpsResumeRequest(text)) {
    return false;
  }
  const t = text.trim();
  if (isBrainOpsMetaQuestion(t) || isBrainUiDenyRequest(t)) {
    return false;
  }
  if (/\b(pause brain|freeze brain|brain ops paused)\b/i.test(t)) {
    return true;
  }
  if (/\b(pause|freeze)\b.{0,30}\b(brain ops?|cleanup|consolidate|rehydrate)\b/i.test(t)) {
    return true;
  }
  return isBrainOpsMutationHaltPhrase(t);
}

export function isBrainOpsResumeRequest(text: string): boolean {
  const t = text.trim();
  return /\b(resume brain operations|unpause brain|enable brain ops|brain ops resume|resume brain ops)\b/i.test(t);
}

export function isMetaComplaintForFiling(text: string): boolean {
  const t = text.trim();
  if (isBrainOpsDenyOrComplaint(t) || isBrainOpsMetaQuestion(t)) {
    return true;
  }
  if (/\b(concerned about|not respecting|why did you|you ignored|stop running|do not run)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function isMetaFactPageTitle(title: string): boolean {
  return /^User: (concerned|worried|upset|frustrated|complaining|annoyed)\b/i.test(title.trim());
}
