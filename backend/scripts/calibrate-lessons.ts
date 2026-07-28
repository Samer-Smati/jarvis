#!/usr/bin/env ts-node
/**
 * Lessons calibration report — tune MIN_CONFIDENCE from real graded samples.
 *
 * Usage:
 *   npm run calibrate-lessons
 *   npm run calibrate-lessons -- --csv
 *   npm run calibrate-lessons -- --grade
 *   npm run calibrate-lessons -- --recommend
 *   npm run calibrate-lessons -- --include-archived
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { In } from 'typeorm';
import {
  buildLessonTags,
  formatMergeQualitativeNote,
  formatRecommendationText,
  formatReportTable,
  parseGradeInput,
  recommendMinConfidence,
  rowsToCsv,
  type CalibrationGradesFile,
  type CalibrationGrade,
  type LessonReportRow,
} from '../src/database/calibration.util';
import { createScriptDataSource } from '../src/database/script-data-source';
import { redactSensitive } from '../src/feedback/feedback-redact.util';
import { InteractionLogEntity } from '../src/feedback/entities/interaction-log.entity';
import { LessonEntity } from '../src/lessons/entities/lesson.entity';

const args = process.argv.slice(2);
const wantCsv = args.includes('--csv');
const wantGrade = args.includes('--grade');
const wantRecommend = args.includes('--recommend');
const includeArchived = args.includes('--include-archived');
const regrade = args.includes('--regrade');

const dataDir = join(process.cwd(), '..', 'data');
const gradesPath = join(dataDir, 'calibration-grades.json');
const csvPath = join(dataDir, 'lessons-calibration.csv');

function loadGrades(): CalibrationGradesFile {
  if (!existsSync(gradesPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(gradesPath, 'utf8')) as CalibrationGradesFile;
  } catch {
    return {};
  }
}

function saveGrades(grades: CalibrationGradesFile): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(gradesPath, `${JSON.stringify(grades, null, 2)}\n`, 'utf8');
}

function resolveSourceCorrection(
  lesson: LessonEntity,
  interaction?: InteractionLogEntity | null,
): string {
  if (interaction?.correction?.trim()) {
    return redactSensitive(interaction.correction.trim());
  }
  if (lesson.confidenceScore >= 0.999) {
    return `(explicit) ${redactSensitive(lesson.triggerContext.slice(0, 240))}`;
  }
  if (lesson.triggerContext?.trim()) {
    return `(no correction — inferred) ${redactSensitive(lesson.triggerContext.slice(0, 240))}`;
  }
  return '(no correction available)';
}

function toReportRow(lesson: LessonEntity, interaction?: InteractionLogEntity | null): LessonReportRow {
  return {
    id: lesson.id,
    taskType: lesson.taskType,
    lessonText: redactSensitive(lesson.lessonText),
    confidenceScore: lesson.confidenceScore,
    sourceCorrectionText: resolveSourceCorrection(lesson, interaction),
    reinforcementCount: lesson.reinforcementCount,
    status: lesson.status,
    createdAt: lesson.createdAt.toISOString(),
    tags: buildLessonTags(lesson.reinforcementCount, lesson.status),
  };
}

async function fetchLessonRows(includeArchivedRows: boolean): Promise<LessonReportRow[]> {
  const dataSource = await createScriptDataSource();
  try {
    const lessonRepo = dataSource.getRepository(LessonEntity);
    const interactionRepo = dataSource.getRepository(InteractionLogEntity);

    const where = includeArchivedRows ? {} : { status: In(['active', 'needs_review']) };
    let lessons: LessonEntity[];
    try {
      lessons = await lessonRepo.find({
        where,
        order: { confidenceScore: 'ASC', createdAt: 'ASC' },
      });
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('relation "lessons" does not exist') || message.includes('no such table: lessons')) {
        console.log('No lessons table found yet. Start the backend once so TypeORM can sync the schema, then retry.');
        return [];
      }
      throw error;
    }

    const interactionIds = lessons
      .map((lesson) => lesson.sourceInteractionId)
      .filter((id): id is string => !!id);

    const interactions =
      interactionIds.length > 0
        ? await interactionRepo.find({ where: { id: In(interactionIds) } })
        : [];

    const interactionById = new Map(interactions.map((row) => [row.id, row]));

    return lessons.map((lesson) =>
      toReportRow(lesson, lesson.sourceInteractionId ? interactionById.get(lesson.sourceInteractionId) : null),
    );
  } finally {
    await dataSource.destroy();
  }
}

function printReport(rows: LessonReportRow[]): void {
  if (!rows.length) {
    console.log('No lessons to calibrate yet.');
    return;
  }

  console.log(`Lessons calibration report (${rows.length} row(s), sorted by confidence ascending)\n`);
  console.log(formatReportTable(rows));
}

function exportCsv(rows: LessonReportRow[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(csvPath, rowsToCsv(rows), 'utf8');
  console.log(`\nCSV written to ${csvPath}`);
}

async function runGrading(rows: LessonReportRow[]): Promise<void> {
  if (!rows.length) {
    console.log('No lessons to grade.');
    return;
  }

  const grades = loadGrades();
  const rl = createInterface({ input, output });

  try {
    for (const row of rows) {
      if (grades[row.id] && !regrade) {
        continue;
      }

      console.log('\n────────────────────────────────────────');
      console.log(`${row.tags.join(' ')}`.trim());
      console.log(`ID: ${row.id}`);
      console.log(`Confidence: ${row.confidenceScore.toFixed(3)} | Task: ${row.taskType} | Status: ${row.status}`);
      console.log(`Lesson: ${row.lessonText}`);
      console.log(`Source correction: ${row.sourceCorrectionText}`);
      if (grades[row.id]) {
        console.log(`Current grade: ${grades[row.id].grade}`);
      }

      const answer = await rl.question(
        'Grade: (g)ood | (b)garbage | (s)hould-have-merged | (w)rong-split | (q)uit > ',
      );

      if (answer.trim().toLowerCase() === 'q') {
        break;
      }

      const grade = parseGradeInput(answer);
      if (!grade) {
        console.log('Invalid grade — skipped.');
        continue;
      }

      grades[row.id] = {
        grade,
        gradedAt: new Date().toISOString(),
      };
      saveGrades(grades);
      console.log(`Saved ${grade} for ${row.id}`);
    }
  } finally {
    rl.close();
  }

  const total = Object.keys(grades).length;
  console.log(`\nGrades saved to ${gradesPath} (${total} total).`);
}

function runRecommend(rows: LessonReportRow[]): void {
  const grades = loadGrades();
  const graded = rows
    .map((row) => {
      const record = grades[row.id];
      if (!record) {
        return null;
      }
      return {
        confidenceScore: row.confidenceScore,
        grade: record.grade,
      };
    })
    .filter((row): row is { confidenceScore: number; grade: CalibrationGrade } => !!row);

  const goodGarbageCount = graded.filter((row) => row.grade === 'good' || row.grade === 'garbage').length;
  if (goodGarbageCount < 15) {
    console.log(
      `Need at least 15 good/garbage grades before recommending (currently ${goodGarbageCount}). Run with --grade first.`,
    );
    return;
  }

  const recommendation = recommendMinConfidence(graded, 15);
  if (!recommendation) {
    console.log('Could not compute a confident threshold from current grades.');
    return;
  }

  const currentMin = Number(process.env.JARVIS_LESSONS_MIN_CONFIDENCE ?? 0.55);
  const currentMerge = Number(process.env.JARVIS_LESSONS_MERGE_THRESHOLD ?? 0.85);

  console.log('\nThreshold recommendation\n');
  console.log(formatRecommendationText(recommendation, currentMin));
  console.log(`\nCurrent JARVIS_LESSONS_MERGE_THRESHOLD=${currentMerge.toFixed(2)} (unchanged — no numeric recommendation).`);

  const mergeNote = formatMergeQualitativeNote(graded);
  if (mergeNote) {
    console.log(`\nMerge audit note: ${mergeNote}`);
  }

  console.log('\nApply any changes manually in backend/.env — this tool does not edit env files.');
}

async function main(): Promise<void> {
  const rows = await fetchLessonRows(includeArchived);

  if (!wantGrade && !wantRecommend) {
    printReport(rows);
    if (wantCsv && rows.length) {
      exportCsv(rows);
    }
  }

  if (wantGrade) {
    await runGrading(rows);
  }

  if (wantRecommend) {
    runRecommend(rows);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
