import { Array, Effect, Order, pipe, Record, Schema } from "effect";
import { dual } from "effect/Function";
import * as Answer from "./Answer.ts";

export class UncertainDecision
  extends Schema.TaggedError<UncertainDecision>()("UncertainDecision", {
    confidence: Answer.Probability,
    minimum: Answer.Probability,
  })
{}

export const requireConfidence: {
  (
    minimum: number,
  ): <A extends { readonly confidence: number; }>(
    answer: A,
  ) => Effect.Effect<A, UncertainDecision | Schema.SchemaError>;
  <A extends { readonly confidence: number; }>(
    answer: A,
    minimum: number,
  ): Effect.Effect<A, UncertainDecision | Schema.SchemaError>;
} = dual(
  2,
  Effect.fnUntraced(
    function*<A extends { readonly confidence: number; }>(answer: A, minimum: number) {
      yield* Schema.decodeUnknownEffect(Answer.Probability)(minimum);
      yield* Schema.decodeUnknownEffect(Answer.Probability)(answer.confidence);
      if (answer.confidence < minimum) {
        return yield* new UncertainDecision({ confidence: answer.confidence, minimum });
      }
      return answer;
    },
  ),
);

export const minimizeLoss = Effect.fnUntraced(
  function*<Outcome extends string, Action extends string>(
    evidence: Answer.Distribution<Outcome>,
    costs: Readonly<Record<Action, (outcome: NoInfer<Outcome>) => number>>,
  ) {
    const Risk = Schema.Struct({
      action: Schema.Literals(Record.keys(costs)),
      expectedLoss: Schema.Finite,
    });
    const risks = yield* pipe(
      costs,
      Record.toEntries,
      Array.map(([action, cost]) => ({
        action,
        expectedLoss: Answer.expectedValue(evidence, cost),
      })),
      Schema.decodeUnknownEffect(Schema.NonEmptyArray(Risk)),
    );
    const selected = Array.min(risks, Order.mapInput(Order.Number, (risk) => risk.expectedLoss));
    return { ...selected, alternatives: risks };
  },
);

export function match<
  A extends { readonly choice: string; },
  const Cases extends {
    readonly [K in A["choice"]]: (
      answer: A & { readonly choice: K; },
    ) => Effect.Effect<unknown, unknown, unknown>;
  },
>(
  answer: A,
  cases: Cases,
): Effect.Effect<
  Effect.Success<ReturnType<Cases[A["choice"]]>>,
  Effect.Error<ReturnType<Cases[A["choice"]]>>,
  Effect.Services<ReturnType<Cases[A["choice"]]>>
>;
export function match(
  answer: { readonly choice: string; },
  cases: Readonly<Record<string, (answer: never) => Effect.Effect<unknown, unknown, unknown>>>,
) {
  return Effect.suspend(() => cases[answer.choice]!(answer as never));
}
