/** Short greetings / acks — skip tool definitions on serverless for faster first token. */
export function isFastChatTurn(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 36) {
    return false;
  }
  if (/\b(search|weather|calendar|remind|email|upgrade|update|deploy|github|code|fix|build|self.?improve)\b/i.test(t)) {
    return false;
  }
  return /^(hey|hi|hello|yo|hiya|howdy|salut|bonjour|bonsoir|ahlan|marhaba|ca va|ça va|ok|okay|thanks|thank you|merci|good morning|good afternoon|good evening|what'?s up|sup)\b/i.test(
    t,
  );
}

export function isServerlessRuntime(): boolean {
  return !!process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1';
}

/** User asks what can be upgraded — status only, no inspect spam. */
export function isSelfImproveInfoQuery(text: string): boolean {
  const t = text.trim();
  if (isConcreteSelfImproveRequest(t)) {
    return false;
  }
  return /\b(what can you upgrade|what.*upgrade.*(yourself|first|now)|what updates|what do you need|upgrade yourself first|what can you change)\b/i.test(
    t,
  );
}

export function isBrainGraphRequest(text: string): boolean {
  const t = text.trim();
  return /\b(graph|knowledge graph|mind map|link map|connections|what(?:'s| is) linked|show.*(?:graph|links|brain)|visuali[sz]e.*(?:brain|graph)|brain map|my brain)\b/i.test(
    t,
  );
}

export function isSaveToBrainRequest(text: string): boolean {
  const t = text.trim();
  return /\b(save (that|this|it) (in|to) (your )?brain|remember that|file (that|this) in (your )?brain|save (that|this) (in|to) my brain)\b/i.test(
    t,
  );
}

export function isAboutUserQuery(text: string): boolean {
  const t = text.trim();
  return /\b(what do you know about me|anything you know about me|what(?:'s| is) my profile|tell me about me|who am i)\b/i.test(
    t,
  );
}

export function isLinkProfileRequest(text: string): boolean {
  const t = text.trim();
  return /\b(link (my )?profile|connect (my )?profile|profile.*linked.*jarvis|why.*not linked|add.*profile.*graph)\b/i.test(
    t,
  );
}

export function isShowBrainPageRequest(text: string): boolean {
  const t = text.trim();
  return /\b(show (the |me )?(exact )?markdown|show (me )?the (profile )?page|display (the )?markdown content)\b/i.test(
    t,
  );
}

export function isAffirmativeLinkProfile(text: string, recentContext: string): boolean {
  if (!/^(yes|yeah|yep|sure|ok|okay|do it|please|go ahead)\b/i.test(text.trim())) {
    return false;
  }
  return /\b(link.*profile|add.*link|profile.*jarvis|create.*profile page|dedicated.*profile)\b/i.test(recentContext);
}

/** User wants responsive/mobile UI — use apply_preset fast path on cloud. */
export function isResponsiveUpgradeRequest(text: string): boolean {
  const t = text.trim();
  const responsive =
    /\b(responsive|mobile|screen size|all screens|small screen|tablet|phone|viewport|media quer(y|ies)|scrollable|overflow-y)\b/i.test(
      t,
    );
  const uiTarget =
    /\b(ui|interface|chat|layout|design|frontend|message|container|css|scss|shell|composer|make|improve|upgrade|fix|adapt|implement)\b/i.test(
      t,
    );
  if (responsive && uiTarget) {
    return true;
  }
  return /\bresponsive\b/i.test(t) && /\b(chat|ui|css|scss|frontend|container)\b/i.test(t);
}

/** Skip filing raw upgrade/tool turns into the brain wiki. */
export function shouldSkipBrainLearning(userText: string, assistantText: string): boolean {
  const user = userText.trim();
  const assistant = assistantText.trim();
  if (isConcreteSelfImproveRequest(user) || isResponsiveUpgradeRequest(user)) {
    return true;
  }
  if (/^(choose|implement|upgrade|fix|make|open pr|just test)\b/i.test(user)) {
    return true;
  }
  if (/cloud time limit|pull request|self-improve|upgrade preset|test-dummy|writing test-/i.test(assistant)) {
    return true;
  }
  return false;
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, '')))];
}

/** User shared a URL to read or save. */
export function isUrlIngestTurn(text: string): boolean {
  const urls = extractUrls(text);
  if (!urls.length) {
    return false;
  }
  const rest = text.replace(/https?:\/\/[^\s<>"')\]]+/gi, '').trim();
  if (!rest) {
    return true;
  }
  return /\b(read|open|check|look at|this link|ingest|remember|save|add|summarize|summarise|tell me|what is|file|brain|learn)\b/i.test(
    text,
  );
}

/** User wants to upgrade the self_improve skill source itself. */
export function isSelfImproveSkillSourceRequest(text: string): boolean {
  const t = text.trim();
  return (
    /\bself[-_]?improve\b/i.test(t) &&
    /\b(skill|source|impl|\.ts|file|code)\b/i.test(t) &&
    /\b(upgrade|improve|fix|update|change|edit|refactor|modify)\b/i.test(t)
  );
}

/** User wants a real code change — inspect briefly then write + PR. */
export function isConcreteSelfImproveRequest(text: string): boolean {
  const t = text.trim();
  if (isResponsiveUpgradeRequest(t) || isSelfImproveSkillSourceRequest(t)) {
    return true;
  }
  return /\b(improve|upgrade|fix|update|make|change|responsive|refactor|redesign|add|implement)\b/i.test(t) &&
    /\b(ui|interface|chat|frontend|screen|mobile|layout|design|voice|skill|jarvis|yourself|code)\b/i.test(t);
}
