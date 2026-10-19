/** One rubric point of a marked short answer. */
export interface RubricMark {
  point: string;
  marks: number;
  awarded: number;
  reason: string;
}
