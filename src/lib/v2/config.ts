// The one place that chooses the pipeline version and the models for each v2 stage.
// v1 stays the default; v2 is selected with BAYYINAH_PIPELINE=v2.

import { chatModel } from "../openai.ts";

export type PipelineVersion = "v1" | "v2";

export function pipelineVersion(): PipelineVersion {
  return process.env.BAYYINAH_PIPELINE === "v2" ? "v2" : "v1";
}

export type ReviewerProvider = "anthropic" | "google" | "openai-standin";

export const V2_MODELS = {
  /** Question analysis, per-source analysis and writing: the same model family as v1 */
  planner: () => process.env.V2_PLANNER_MODEL || chatModel(),
  grader: () => process.env.V2_GRADER_MODEL || chatModel(),
  analyst: () => process.env.V2_ANALYST_MODEL || chatModel(),
  writer: () => process.env.V2_WRITER_MODEL || chatModel(),
  /**
   * The support reviewer must be another model family. Until a key for one is configured, a
   * stronger OpenAI model stands in for development, and answers are then never shown as verified.
   */
  reviewer: (): { provider: ReviewerProvider; model: string } => {
    if (process.env.ANTHROPIC_API_KEY) return { provider: "anthropic", model: process.env.V2_REVIEWER_MODEL || "claude-haiku-4-5-20251001" };
    if (process.env.GEMINI_API_KEY) return { provider: "google", model: process.env.V2_REVIEWER_MODEL || "gemini-3.8-flash" };
    return { provider: "openai-standin", model: process.env.V2_STANDIN_REVIEWER_MODEL || "gpt-5.4" };
  },
};

/** True only when the reviewer is a different model family from the writer. */
export function reviewerIsCrossFamily(): boolean {
  return V2_MODELS.reviewer().provider !== "openai-standin";
}

export const V2_LIMITS = {
  /** Candidates kept per source after fusion (before grading) */
  candidatesPerSource: 24,
  /** Shortlist per source after grading (review breadth, not a citation quota) */
  shortlistPerSource: 7,
  shortlistQuran: 10,
  /** Sentences of context on each side of a cited span shown to the reviewer */
  reviewContext: 2,
  maxSubQuestions: 4,
};
