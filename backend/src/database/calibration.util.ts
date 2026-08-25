export type CalibrationGrade = 'good' | 'garbage' | 'should-have-merged' | 'wrong-split';

export interface CalibrationGradeRecord {
  grade: CalibrationGrade;
  gradedAt: string;
}

export type CalibrationGradesFile = Record<string, CalibrationGradeRecord>;

export interface LessonReportRow {
  id: string;
  taskType: string;
  lessonText: string;
  confidenceScore: number;
  sourceCorrectionText: string;
  reinforcementCount: number;
  status: string;
  createdAt: string;
  tags: string[];
}

export interface ThresholdRecommendation {
  recommendedMinConfidence: number;
  garbageRateBelow: number;
  goodRateAbove: number;
  countBelow: number;
  countAbove: number;
  separationScore: number;
}

const GRADE_ALIASES: Record<string, CalibrationGrade> = {
  g: 'good',
  good: 'good',
  b: 'garbage',
  garbage: 'garbage',
  s: 'should-have-merged',
  'should-have-merged': 'should-have-merged',
  w: 'wrong-split',
  'wrong-split': 'wrong-split',
};

export function parseGradeInput(input: string): CalibrationGrade | null {
  const key = input.trim().toLowerCase();
  return GRADE_ALIASES[key] ?? null;
}

export function buildLessonTags(reinforcementCount: number, status: string): string[] {
  const tags: string[] = [];
  if (reinforcementCount > 1) {
    tags.push(`[MERGED x${reinforcementCount}]`);
  }
  if (status === 'needs_review') {
    tags.push('[NEEDS_REVIEW]');
  }
  return tags;
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatReportTable(rows: LessonReportRow[]): string {
  if (!rows.length) {
    return '';
  }

  const headers = [
    'tags',
    'confidence',
    'task_type',
    'lesson_text',
    'source_correction',
    'status',
    'reinforcement',
    'created_at',
    'id',
  ];

  const data = rows.map((row) => [
    row.tags.join(' '),
    row.confidenceScore.toFixed(3),
    row.taskType,
    row.lessonText,
    row.sourceCorrectionText,
    row.status,
    String(row.reinforcementCount),
    row.createdAt,
    row.id,
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...data.map((line) => line[index].length)),
  );

  const formatLine = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');

  return [formatLine(headers), formatLine(widths.map((w) => '-'.repeat(w))), ...data.map(formatLine)].join('\n');
}

export function rowsToCsv(rows: LessonReportRow[]): string {
  const headers = [
    'id',
    'task_type',
    'lesson_text',
    'confidence_score',
    'source_correction_text',
    'reinforcement_count',
    'status',
    'created_at',
    'tags',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      [
        row.id,
        row.taskType,
        row.lessonText,
        row.confidenceScore.toFixed(4),
        row.sourceCorrectionText,
        String(row.reinforcementCount),
        row.status,
        row.createdAt,
        row.tags.join(' '),
      ]
        .map(csvEscape)
        .join(','),
    ),
  ];

  return `${lines.join('\n')}\n`;
}

export function recommendMinConfidence(
  graded: Array<{ confidenceScore: number; grade: CalibrationGrade }>,
  minSamples = 15,
): ThresholdRecommendation | null {
  const labeled = graded.filter((row) => row.grade === 'good' || row.grade === 'garbage');
  if (labeled.length < minSamples) {
    return null;
  }

  const scores = [...new Set(labeled.map((row) => row.confidenceScore))].sort((a, b) => a - b);
  const candidates = new Set<number>();

  for (let step = 0.5; step <= 0.99; step += 0.01) {
    candidates.add(Number(step.toFixed(2)));
  }
  for (let i = 0; i < scores.length - 1; i++) {
    candidates.add(Number(((scores[i] + scores[i + 1]) / 2).toFixed(4)));
  }
  for (const score of scores) {
    candidates.add(Number(score.toFixed(4)));
  }

  let best: ThresholdRecommendation | null = null;

  for (const threshold of candidates) {
    const below = labeled.filter((row) => row.confidenceScore < threshold);
    const above = labeled.filter((row) => row.confidenceScore >= threshold);
    if (!below.length || !above.length) {
      continue;
    }

    const garbageBelow = below.filter((row) => row.grade === 'garbage').length / below.length;
    const goodAbove = above.filter((row) => row.grade === 'good').length / above.length;
    const separationScore = Math.min(garbageBelow, goodAbove);

    if (
      !best ||
      separationScore > best.separationScore ||
      (separationScore === best.separationScore && threshold > best.recommendedMinConfidence)
    ) {
      best = {
        recommendedMinConfidence: threshold,
        garbageRateBelow: garbageBelow,
        goodRateAbove: goodAbove,
        countBelow: below.length,
        countAbove: above.length,
        separationScore,
      };
    }
  }

  return best;
}

export function formatRecommendationText(
  recommendation: ThresholdRecommendation,
  currentMinConfidence: number,
): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const recommended = recommendation.recommendedMinConfidence.toFixed(2);
  const current = currentMinConfidence.toFixed(2);

  let comparison: string;
  if (recommendation.recommendedMinConfidence > currentMinConfidence + 0.02) {
    comparison = `Current setting (${current}) may be too permissive — consider tightening.`;
  } else if (recommendation.recommendedMinConfidence < currentMinConfidence - 0.02) {
    comparison = `Current setting (${current}) may be slightly conservative — you could loosen it.`;
  } else {
    comparison = `Current setting (${current}) is close to the recommended value.`;
  }

  return [
    `Lessons below confidence ${recommended} were graded garbage ${pct(recommendation.garbageRateBelow)} of the time (n=${recommendation.countBelow}).`,
    `Lessons at/above ${recommended} were graded good ${pct(recommendation.goodRateAbove)} of the time (n=${recommendation.countAbove}).`,
    `Recommend JARVIS_LESSONS_MIN_CONFIDENCE=${recommended}.`,
    comparison,
  ].join('\n');
}

export function formatMergeQualitativeNote(
  graded: Array<{ grade: CalibrationGrade }>,
): string | null {
  const shouldHaveMerged = graded.filter((row) => row.grade === 'should-have-merged').length;
  const wrongSplit = graded.filter((row) => row.grade === 'wrong-split').length;
  if (!shouldHaveMerged && !wrongSplit) {
    return null;
  }

  return [
    `${shouldHaveMerged} lesson(s) tagged should-have-merged; ${wrongSplit} tagged wrong-split.`,
    'Merge similarity scores were not logged at merge time, so a numeric MERGE_THRESHOLD recommendation is not available yet.',
    'Review [MERGED xN] and [NEEDS_REVIEW] rows manually, or add merge-similarity logging in a follow-up.',
  ].join(' ');
}
