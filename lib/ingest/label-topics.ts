import "server-only";
import { type CallMetrics, generateValidatedJson, schemaText } from "@/lib/ai/call";
import type { ApiKey } from "@/lib/api-key";
import { TopicLabelsSchema } from "@/lib/schemas";
import {
  type ChunkForLabelling,
  LABEL_BATCH_SIZE,
  normalizeTopicLabel,
  TOPIC_LABEL_SYSTEM,
  topicLabelIssues,
  topicLabelPrompt,
} from "./topic-labels";

/**
 * Labels chunks in batches of LABEL_BATCH_SIZE. Batches run one after another so each sees
 * the labels the previous one chose, which keeps one topic from getting two names.
 */
export async function labelTopics(
  chunks: ChunkForLabelling[],
  existingLabels: string[],
  context: { materialId: string; deadlineAt?: number; apiKey: ApiKey },
): Promise<{ labels: Map<number, string>; calls: CallMetrics[] }> {
  const labels = new Map<number, string>();
  const calls: CallMetrics[] = [];
  const known = new Set(existingLabels);

  for (let start = 0; start < chunks.length; start += LABEL_BATCH_SIZE) {
    const batch = chunks.slice(start, start + LABEL_BATCH_SIZE);
    const indexes = batch.map((chunk) => chunk.index);
    const result = await generateValidatedJson(
      {
        context: { label: "topic_labels", materialId: context.materialId, firstChunk: indexes[0] },
        schema: TopicLabelsSchema,
        system: [{ type: "text", text: TOPIC_LABEL_SYSTEM }],
        messages: [{ role: "user", content: topicLabelPrompt(batch, [...known].sort(), schemaText(TopicLabelsSchema)) }],
        task: "topicLabels",
        deadlineAt: context.deadlineAt,
        apiKey: context.apiKey,
      },
      (response) => topicLabelIssues(response, indexes),
    );
    calls.push(...result.calls);
    for (const { index, topic_label } of result.data.labels) {
      const label = normalizeTopicLabel(topic_label);
      labels.set(index, label);
      known.add(label);
    }
  }
  return { labels, calls };
}
