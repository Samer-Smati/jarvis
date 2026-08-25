import {
  buildLessonTags,
  formatRecommendationText,
  parseGradeInput,
  recommendMinConfidence,
  rowsToCsv,
  type CalibrationGrade,
} from './calibration.util';

describe('calibration.util', () => {
  it('builds merge and review tags', () => {
    expect(buildLessonTags(3, 'active')).toEqual(['[MERGED x3]']);
    expect(buildLessonTags(1, 'needs_review')).toEqual(['[NEEDS_REVIEW]']);
    expect(buildLessonTags(4, 'needs_review')).toEqual(['[MERGED x4]', '[NEEDS_REVIEW]']);
  });

  it('parses grade aliases', () => {
    expect(parseGradeInput('g')).toBe('good');
    expect(parseGradeInput('garbage')).toBe('garbage');
    expect(parseGradeInput('s')).toBe('should-have-merged');
    expect(parseGradeInput('w')).toBe('wrong-split');
    expect(parseGradeInput('nope')).toBeNull();
  });

  it('recommends a separating confidence threshold', () => {
    const graded: Array<{ confidenceScore: number; grade: CalibrationGrade }> = [
      ...Array.from({ length: 8 }, () => ({ confidenceScore: 0.45, grade: 'garbage' as const })),
      ...Array.from({ length: 8 }, () => ({ confidenceScore: 0.75, grade: 'good' as const })),
    ];

    const recommendation = recommendMinConfidence(graded, 15);
    expect(recommendation).not.toBeNull();
    expect(recommendation!.recommendedMinConfidence).toBeGreaterThan(0.45);
    expect(recommendation!.recommendedMinConfidence).toBeLessThanOrEqual(0.75);
    expect(formatRecommendationText(recommendation!, 0.55)).toContain('Recommend JARVIS_LESSONS_MIN_CONFIDENCE=');
  });

  it('escapes csv values', () => {
    const csv = rowsToCsv([
      {
        id: '1',
        taskType: 'quick_qa',
        lessonText: 'Say "hello"',
        confidenceScore: 0.6,
        sourceCorrectionText: 'line1\nline2',
        reinforcementCount: 1,
        status: 'active',
        createdAt: '2026-07-28T00:00:00.000Z',
        tags: [],
      },
    ]);
    expect(csv).toContain('"Say ""hello"""');
    expect(csv).toContain('"line1\nline2"');
  });
});
