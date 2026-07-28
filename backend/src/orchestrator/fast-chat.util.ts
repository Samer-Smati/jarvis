/** Short greetings / acks — skip tool definitions on serverless for faster first token. */
export function isFastChatTurn(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 36) {
    return false;
  }
  if (
    /\b(search|verify|weather|calendar|remind|email|upgrade|update|deploy|github|code|fix|build|self.?improve|look up|check online|ranking|pricing)\b/i.test(
      t,
    )
  ) {
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
  if (isBrainConsolidateRequest(t)) {
    return false;
  }
  return /\b(graph|knowledge graph|mind map|link map|what(?:'s| is) linked|show.*(?:graph|links|brain)|visuali[sz]e.*(?:brain|graph)|brain map|my brain)\b/i.test(
    t,
  );
}

/** User wants real wiki edges written between brain pages — not just open the graph UI. */
export function isBrainConsolidateRequest(text: string): boolean {
  const t = text.trim();
  if (
    /\b(link (everything|all|them|those|nodes|pages|notes)|connect (everything|all|them|those|nodes|pages|notes)|wire|re-?wire|consolidate|mesh)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(scan|identify|find|analyze|analyse).{0,60}\b(connection|link|related|nodes?)\b/i.test(t)) {
    return true;
  }
  if (/\b(why|how).{0,50}\b(not|aren'?t|isn'?t|no).{0,30}\blink/i.test(t)) {
    return true;
  }
  if (/\b(nodes?|pages?|notes?).{0,40}\blink\b/i.test(t) && /\b(brain|graph|wiki|vault)\b/i.test(t)) {
    return true;
  }
  if (/\bstill the same\b/i.test(t) && /\b(picture|image|graph|link|node)/i.test(t)) {
    return true;
  }
  return false;
}

export function isSaveToBrainRequest(text: string): boolean {
  const t = text.trim();
  if (isExplicitLessonRequest(t)) {
    return false;
  }
  return /\b(save (that|this|it) (in|to) (your )?brain|remember that|file (that|this) in (your )?brain|save (that|this) (in|to) my brain)\b/i.test(
    t,
  );
}

/** Narrow correction pattern — experiential lesson, not a profile fact. */
export function isExplicitLessonRequest(text: string): boolean {
  const t = text.trim();
  if (!/\bremember\s+that\s+when\b/i.test(t)) {
    return false;
  }
  return /\b(i mean|use|refer to|should mean|means)\b/i.test(t);
}

export function extractExplicitLessonText(text: string): string | null {
  const t = text.trim();
  const match = t.match(/\bremember\s+that\s+when\s+(.+)/i);
  if (!match?.[1]) {
    return null;
  }
  let body = match[1].trim().replace(/\s+/g, ' ');
  body = body.replace(/^i\s+/i, 'When the user ');
  if (!/[.!?]$/.test(body)) {
    body += '.';
  }
  return body.slice(0, 220);
}

export function isAboutUserQuery(text: string): boolean {
  const t = text.trim();
  return /\b(what do you know about me|anything you know about me|what(?:'s| is) my profile|tell me about me|who am i)\b/i.test(
    t,
  );
}

export function isLinkProfileRequest(text: string): boolean {
  const t = text.trim();
  if (isBrainConsolidateRequest(t)) {
    return false;
  }
  return /\b(link (my )?profile|connect (my )?profile|profile.*linked.*jarvis|why.*profile.*not linked|add.*profile.*graph)\b/i.test(
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

export function isBrainCleanupRequest(text: string): boolean {
  const t = text.trim();
  return /\b(clean\s?up|clear|prune|fix)\b.*\b(brain|graph|wiki|vault)\b/i.test(t) ||
    /\b(brain|graph|wiki)\b.*\b(clean\s?up|clear|prune|fix)\b/i.test(t);
}

/** User asks how repo code/skills/schedulers work — must inspect before describing. */
export function isCodeArchitectureQuestion(text: string): boolean {
  const t = text.trim();
  if (isWebSearchMetaQuestion(t)) {
    return false;
  }
  if (
    /\b(that description is false|not in the code|do not describe capabilities|capabilities that aren't|you regressed|inspect failed)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(before i merge|walk me through|how does .{3,60} (work|trigger|run|schedule|wire)|quote the (exact )?lines?|paste .{0,20}verbatim|self_improve inspect|inspected directly)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(scheduler|schedulemodule|cron|skill\.yaml|skills\.module|vercel cron|daily on vercel|file list|where will .{3,40} live)\b/i.test(
      t,
    ) &&
    /\?|explain|describe|confirm|inspect|read |show me|what happens|can this run/i.test(t)
  ) {
    return true;
  }
  if (/\b(answer only from inspected|revise (the )?(plan|answer|file list)|still no (write|code|pr))\b/i.test(t)) {
    return true;
  }
  return false;
}

/** User wants a plan or architecture answer only — no write/PR this turn. */
export function isPlanOnlyRequest(text: string): boolean {
  const t = text.trim();
  return (
    /\b(no code|no write|no pr|don't write|do not write|plan only|still no write|before any code|until i say proceed|until i approve)\b/i.test(
      t,
    ) || /\brevise the (plan|file list|answers?) only\b/i.test(t)
  );
}

/** User asks whether a prior answer used web search / tools — not a request to search the web. */
export function isWebSearchMetaQuestion(text: string): boolean {
  const t = text.trim();
  if (
    /\b(did you|did that|did it|have you|was that|was it|does that|did this)\b.{0,80}\b(search|web search|look(ed)? up|use the web|training data|from memory|from your memory|tool call|tools?)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(confirm|verify|clarify|tell me honestly|be direct|be honest)\b.{0,60}\b(that you|whether you|if you|that answer|that response|that reply|did that|did you)\b/i.test(
      t,
    ) &&
    /\b(search|web search|training data|memory|tool|live data|live web)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(come from|came from|based on)\b.{0,50}\b(live web search|web search|training data|your training|memory|model knowledge)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\babout (your|the) (last|previous|prior|that) (answer|response|reply|turn)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** User explicitly instructs Jarvis to search or verify online before answering. */
export function isExplicitWebSearchRequest(text: string): boolean {
  if (isWebSearchMetaQuestion(text)) {
    return false;
  }
  const t = text.trim();
  if (
    /\b(search the web|search online|web search|google (this|it|for|that)|look (this|it|that) up|check online|browse the web|use the web)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bsearch\b.{0,48}\b(verify|before answering|online|on the web|web|and confirm)\b/i.test(t)) {
    return true;
  }
  if (/\b(verify|confirm|double[- ]check)\b.{0,48}\b(search|online|on the web|web|before answering)\b/i.test(t)) {
    return true;
  }
  if (/\b(find out|look up|fact[- ]check)\b.{0,32}\b(online|on the web|web)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Questions about live rankings, availability, or "best X in [year]" need fresh web data. */
export function isCurrentStateQuestion(text: string): boolean {
  const t = text.trim();
  const hasRecency =
    /\b(current|latest|today|now|right now|as of|still|this year|202[4-9]|203[0-9])\b/i.test(t);
  const hasRanking =
    /\b(best|top|ranking|rankings|ranked|#1|leading|fastest|cheapest|most popular|benchmark|leaderboard|sota|state of the art)\b/i.test(
      t,
    );
  if (hasRanking && (hasRecency || /\b(best .{3,80} (in|for) 20\d{2})\b/i.test(t))) {
    return true;
  }
  if (
    /\b(llm|model|ai|gpt|claude|gemini|groq|openai|anthropic|llama|mistral)\b/i.test(t) &&
    /\b(ranking|rankings|benchmark|leaderboard|best|top|compare|vs\.?|versus)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(price|pricing|cost|subscription|available|availability|access|waitlist|in stock|release date|launched|announced)\b/i.test(
      t,
    ) &&
    (hasRecency || /\b(how much|is .{2,60} available|can i (still )?get|do they still)\b/i.test(t))
  ) {
    return true;
  }
  return false;
}

export function requiresWebSearch(text: string, now: Date = new Date()): boolean {
  if (isWebSearchMetaQuestion(text)) {
    return false;
  }
  const explicit = isExplicitWebSearchRequest(text);
  const currentState = isCurrentStateQuestion(text);
  if (!explicit && !currentState) {
    return false;
  }
  if (explicit && !currentState && !hasMeaningfulSearchQueryExtract(text, now)) {
    return false;
  }
  return true;
}

/** True when extractWebSearchQuery stripped instruction fluff — not just echoed the user message. */
export function hasMeaningfulSearchQueryExtract(text: string, now: Date = new Date()): boolean {
  const extracted = extractWebSearchQuery(text, now);
  const normOrig = normalizeSearchCompare(text);
  const normExt = normalizeSearchCompare(extracted);
  if (normExt.length < 8) {
    return false;
  }
  if (normOrig === normExt) {
    return false;
  }
  const shorter = normOrig.length <= normExt.length ? normOrig : normExt;
  const longer = normOrig.length <= normExt.length ? normExt : normOrig;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.82) {
    return false;
  }
  return true;
}

function normalizeSearchCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractWebSearchQuery(text: string, now: Date = new Date()): string {
  const t = text.trim();
  let q = t
    .replace(/^(please |can you |could you |jarvis,? )/i, '')
    .replace(
      /\b(search the web (to )?(verify|and verify|before answering|for me)?|verify (this )?(online|on the web|before answering)|check online|look (this|it|that) up( for me)?|use the web to|find out online)\b/gi,
      ' ',
    )
    .replace(/\b(before answering|before you reply|and verify)\b/gi, ' ')
    .replace(/^[\s:,\-–]+|[\s:,\-–?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (q.length < 8) {
    q = t
      .replace(/\b(before answering|before you reply)\b/gi, ' ')
      .replace(/^[\s:,\-–]+|[\s:,\-–?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
  return injectSearchRecencyYear(t, q, now);
}

function injectSearchRecencyYear(sourceText: string, query: string, now: Date): string {
  const year = String(now.getFullYear());
  let q = query.replace(/\bthis year\b/gi, year).replace(/\s+/g, ' ').trim();

  if (/\b20\d{2}\b/.test(q)) {
    return q.slice(0, 200);
  }

  const needsYear =
    isCurrentStateQuestion(sourceText) ||
    /\b(right now|currently|current|latest|today|as of today|as of now)\b/i.test(sourceText);

  if (needsYear) {
    q = `${q} ${year}`.replace(/\s+/g, ' ').trim();
  }

  return q.slice(0, 200);
}

/** User asks for weather — call get_weather directly (no permission needed). */
export function isWeatherRequest(text: string): boolean {
  const t = text.trim();
  return /\b(weather|forecast|temperature|rain|météo|meteo|température|ta9es|t9es|t9os|jaw|الطقس|الجو|chnawa)\b/i.test(t);
}

export function extractWeatherLocation(text: string): string | null {
  const t = text.trim();
  const patterns = [
    /\b(?:weather|forecast|temperature|météo|meteo|ta9es|t9es|jaw)\s+(?:in|for|at|à|a|fi|f|en)\s+([^?.!,\n]+)/i,
    /\b(?:in|for|at|à|a|fi|f|en)\s+([^?.!,\n]+?)\s+(?:weather|forecast|météo|meteo|ta9es|jaw)\b/i,
    /\bwhat(?:'s| is|s)\s+(?:the\s+)?weather\s+(?:in|for|at|à|fi)\s+([^?.!,\n]+)/i,
    /\bhow(?:'s| is)\s+(?:the\s+)?weather\s+(?:in|for|at|à|fi)\s+([^?.!,\n]+)/i,
    /\bchnawa\s+(?:el\s+)?(?:ta9es|jaw|t9es)\s+(?:fi|f)\s+([^?.!,\n]+)/i,
    /\b(?:ta9es|jaw|t9es)\s+(?:fi|f)\s+([^?.!,\n]+)/i,
  ];
  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (match?.[1]) {
      return cleanWeatherPlace(match[1]);
    }
  }
  const cityMatch = t.match(
    /\b(Tunis|Tunisia|Sfax|Sousse|Paris|London|Berlin|New York|Dubai|Cairo|Algiers|Marseille|Lyon)\b/i,
  );
  if (cityMatch?.[1] && isWeatherRequest(t)) {
    return cityMatch[1];
  }
  return null;
}

function cleanWeatherPlace(raw: string): string {
  return raw
    .trim()
    .replace(/\s*(today|now|tawa|lyoum|please|sir|monsieur|siidi|\?|!)+$/i, '')
    .trim();
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
