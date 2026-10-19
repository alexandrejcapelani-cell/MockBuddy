import type { QuestionView } from "./view.ts";

// Screen 4: the score and the per-topic breakdown, with the strongest topic flagged HOT
// and the weakest COLD.

export interface TopicRow {
  topic: string;
  questions: number;
  answered: number;
  correct: number;
  /** Marks available on the answered questions. */
  marks: number;
  awarded: number;
  /** awarded / marks over answered questions; null when none were answered. */
  accuracy: number | null;
  flag: "HOT" | "COLD" | null;
}

export interface Results {
  total: number;
  answered: number;
  correct: number;
  totalMarks: number;
  awardedMarks: number;
  /** Awarded over all marks in the exam: unanswered questions count as zero. */
  percent: number;
  topics: TopicRow[];
}

export function computeResults(views: QuestionView[]): Results {
  const topics = new Map<string, TopicRow>();
  for (const view of views) {
    const row = topics.get(view.topicLabel) ?? {
      topic: view.topicLabel,
      questions: 0,
      answered: 0,
      correct: 0,
      marks: 0,
      awarded: 0,
      accuracy: null,
      flag: null,
    };
    row.questions++;
    if (view.answer) {
      row.answered++;
      row.marks += view.marks;
      row.awarded += view.answer.awardedMarks;
      if (view.answer.isCorrect) row.correct++;
    }
    topics.set(view.topicLabel, row);
  }

  const rows = [...topics.values()].map((row) => ({ ...row, accuracy: row.marks > 0 ? row.awarded / row.marks : null }));
  const scored = rows.flatMap((row) => (row.accuracy === null ? [] : [row.accuracy]));
  // Flag only when there is a real spread: at least two topics with different accuracy.
  if (scored.length >= 2) {
    const best = Math.max(...scored);
    const worst = Math.min(...scored);
    if (best > worst) {
      for (const row of rows) {
        if (row.accuracy === best) row.flag = "HOT";
        if (row.accuracy === worst) row.flag = "COLD";
      }
    }
  }

  const totalMarks = views.reduce((sum, view) => sum + view.marks, 0);
  const awardedMarks = views.reduce((sum, view) => sum + (view.answer?.awardedMarks ?? 0), 0);
  return {
    total: views.length,
    answered: views.filter((view) => view.answer).length,
    correct: views.filter((view) => view.answer?.isCorrect).length,
    totalMarks,
    awardedMarks,
    percent: totalMarks > 0 ? (awardedMarks / totalMarks) * 100 : 0,
    topics: rows,
  };
}
