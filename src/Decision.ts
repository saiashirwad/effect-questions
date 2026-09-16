import { Effect, Schema } from "effect";
import * as Question from "./Question.ts";

export class UncertainDecision
  extends Schema.TaggedError<UncertainDecision>()("UncertainDecision", {
    confidence: Question.Probability,
    minimum: Question.Probability,
  })
{}

export const requireConfidence = <A extends { readonly confidence: number; }>(
  answer: A,
  minimum: number,
): Effect.Effect<A, UncertainDecision> =>
  answer.confidence >= minimum
    ? Effect.succeed(answer)
    : Effect.fail(new UncertainDecision({ confidence: answer.confidence, minimum }));
