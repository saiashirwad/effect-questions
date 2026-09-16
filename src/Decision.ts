/**
 * Explicit policies for turning probabilistic evidence into typed control flow.
 *
 * Confidence requirements and expected-loss decisions are separate operations.
 * Both preserve evidence for the caller; only `match` invokes an action handler.
 *
 * @since 0.0.0
 */
import { Array, Effect, Order, pipe, Predicate, Record, Schema } from "effect";
import { dual } from "effect/Function";
import * as Answer from "./Answer.ts";

/**
 * A confidence policy rejected an otherwise successful model answer.
 * Recover with `Effect.catchTag("UncertainDecision", ...)` at the boundary that
 * owns the fallback behavior.
 *
 * @category errors
 * @since 0.0.0
 */
export class UncertainDecision
  extends Schema.TaggedError<UncertainDecision>()("UncertainDecision", {
    /** Confidence supplied by the answer. */
    confidence: Answer.Probability,
    /** The caller's required lower bound. */
    minimum: Answer.Probability,
  })
{}

/**
 * Requires confidence greater than or equal to `minimum`, preserving the exact
 * answer on success. Neither the answer nor the threshold is changed.
 *
 * Invalid confidence or threshold values fail with `SchemaError`; insufficient
 * confidence fails with `UncertainDecision`. Supports both calling styles.
 *
 * @example
 * ```ts
 * import { Effect } from "effect";
 * import { Decision } from "effect-questions";
 *
 * const program = Effect.succeed({ choice: "technical" as const, confidence: 0.9 }).pipe(
 *   Effect.flatMap(Decision.requireConfidence(0.8)),
 *   Effect.catchTag("UncertainDecision", () =>
 *     Effect.succeed({ choice: "clarify" as const, confidence: 0 })
 *   ),
 * );
 * ```
 *
 * @category combinators
 * @since 0.0.0
 */
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

/**
 * The cost of an action under each possible outcome.
 *
 * A number is constant cost, a record is a complete outcome-to-cost table, and
 * a pure function computes cost from an outcome. All costs must be finite and
 * comparable in the same units. Negative costs can represent rewards.
 *
 * @category models
 * @since 0.0.0
 */
export type Loss<Outcome extends string> =
  | number
  | Readonly<Record<Outcome, number>>
  | ((outcome: Outcome) => number);

/**
 * Named available actions and their loss models. Different actions may use
 * different representations. Obtain external cost inputs with ordinary Effects
 * before constructing this record, and exclude unavailable actions from it.
 *
 * @category models
 * @since 0.0.0
 */
export type Costs<Outcome extends string, Action extends string = string> = Readonly<
  Record<Action, Loss<Outcome>>
>;

/**
 * Constructs a schema for an action identifier and its finite expected loss.
 * The `choice` field allows selected risks to compose directly with `match`.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Risk = <const Actions extends ReadonlyArray<string>>(
  actions: Schema.Literals<Actions>,
) => Schema.Struct({ choice: actions, expectedLoss: Schema.Finite });

/**
 * An available action paired with its probability-weighted cost.
 *
 * @category models
 * @since 0.0.0
 */
export type Risk<Action extends string> = ReturnType<typeof Risk<ReadonlyArray<Action>>>["Type"];

/**
 * A non-empty set of evaluated actions, in cost-record enumeration order.
 *
 * @category models
 * @since 0.0.0
 */
export type Risks<Action extends string> = Array.NonEmptyReadonlyArray<Risk<Action>>;

/**
 * The selected action and expected loss, retaining every evaluated alternative.
 *
 * @category models
 * @since 0.0.0
 */
export type Selection<Action extends string> = Risk<Action> & {
  /** All evaluated actions, including the selected one, in their original order. */
  readonly alternatives: Risks<Action>;
};

/** Prevents curried policies from accepting evidence outside their outcome domain. */
type FromEvidence<Outcome extends string, A> = <Evidence extends Answer.Distribution<Outcome>>(
  evidence: Evidence & (keyof Evidence["probabilities"] extends Outcome ? unknown : never),
) => Effect.Effect<A, Schema.SchemaError>;

/** Rejects empty, invalid, and zero-mass evidence without imposing a rounding tolerance. */
const Probabilities = Schema.Record(Schema.String, Answer.Probability).check(
  Schema.isMinProperties(1),
  Schema.makeFilter((probabilities) =>
    Object.values(probabilities).some((probability) => probability > 0)
    || "At least one outcome must have positive probability"
  ),
);

/**
 * Evaluates every available action's expected loss without selecting an action.
 *
 * Constants, complete tables, and pure functions may be mixed in one cost model.
 * Functions run once per represented outcome, including zero-probability outcomes.
 * Missing table entries and non-finite costs fail even when their outcome has no
 * mass. Exceptions thrown by a cost function remain defects in that function.
 *
 * Fails with `SchemaError` for invalid probabilities, empty or zero-mass evidence,
 * an empty action set, missing costs, or non-finite costs or computed losses.
 * Probabilities are used as supplied: normalization is neither checked nor applied.
 * They must already represent a distribution for results to be expected losses.
 *
 * Use this operation for custom tie-breaking, switching costs, or inspecting
 * alternatives before deciding. Supports data-first and data-last invocation;
 * the data-first form provides outcome inference for inline cost functions.
 *
 * @example
 * ```ts
 * import { Decision } from "effect-questions";
 *
 * const evaluated = Decision.risks(
 *   { probabilities: { billing: 0.7, technical: 0.3 } },
 *   {
 *     billing: { billing: 0, technical: 2 },
 *     technical: (outcome) => outcome === "technical" ? 0 : 3,
 *     clarify: 1,
 *   },
 * );
 * ```
 *
 * @category decisions
 * @since 0.0.0
 */
export const risks: {
  <Action extends string>(
    costs: Readonly<Record<Action, number>>,
  ): FromEvidence<string, Risks<Action>>;
  <Outcome extends string, Action extends string>(
    costs: Costs<Outcome, Action>,
  ): FromEvidence<Outcome, Risks<Action>>;
  <Outcome extends string, Action extends string>(
    evidence: Answer.Distribution<Outcome>,
    costs: Costs<NoInfer<Outcome>, Action>,
  ): Effect.Effect<Risks<Action>, Schema.SchemaError>;
} = dual(
  2,
  Effect.fnUntraced(function*<Outcome extends string, Action extends string>(
    evidence: Answer.Distribution<Outcome>,
    costs: Costs<Outcome, Action>,
  ) {
    const probabilities = yield* Schema.decodeUnknownEffect(Probabilities)(evidence.probabilities);
    const outcomes = Record.keys(probabilities) as Array<Outcome>;
    const Loss = Schema.Union([
      Schema.Finite,
      Schema.Record(Schema.Literals(outcomes), Schema.Finite),
    ]);
    const Evaluated = Schema.NonEmptyArray(Risk(Schema.Literals(Record.keys(costs))));

    return yield* pipe(
      costs,
      Record.toEntries,
      Effect.forEach(([choice, cost]) =>
        pipe(
          Predicate.isFunction(cost)
            ? Record.fromEntries(outcomes.map((outcome) => [outcome, cost(outcome)] as const))
            : cost,
          Schema.decodeUnknownEffect(Loss),
          Effect.map((loss) => ({
            choice,
            expectedLoss: Answer.expectedValue(
              evidence,
              (outcome) => Predicate.isNumber(loss) ? loss : loss[outcome],
            ),
          })),
        )
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(Evaluated)),
    );
  }),
);

/**
 * Selects the action with the lowest expected loss and retains all alternatives.
 *
 * Uses `risks` for evaluation and validation. Exact ties favor the first action in
 * record enumeration order. This is a one-step decision: supplied costs must
 * account for any consequences the application wants to consider. No action is
 * executed by this function.
 *
 * Supports data-first and data-last invocation. The latter constructs a reusable
 * policy; typed tables must cover the outcomes of evidence passed to that policy.
 *
 * @example
 * ```ts
 * import { Console, Effect } from "effect";
 * import { Answer, Decision } from "effect-questions";
 *
 * const decide = Decision.minimizeLoss({
 *   recommend: { true: 0, false: 10 },
 *   investigateFurther: 1,
 * });
 *
 * const program = Effect.gen(function*() {
 *   const decision = yield* decide(
 *     Answer.fromBoolean({ type: "boolean", probability: 0.97 }),
 *   );
 *   return yield* Decision.match(decision, {
 *     recommend: ({ expectedLoss }) => Console.log("Recommend", expectedLoss),
 *     investigateFurther: () => Console.log("Investigate further"),
 *   });
 * });
 * ```
 *
 * @category decisions
 * @since 0.0.0
 */
export const minimizeLoss: {
  <Action extends string>(
    costs: Readonly<Record<Action, number>>,
  ): FromEvidence<string, Selection<Action>>;
  <Outcome extends string, Action extends string>(
    costs: Costs<Outcome, Action>,
  ): FromEvidence<Outcome, Selection<Action>>;
  <Outcome extends string, Action extends string>(
    evidence: Answer.Distribution<Outcome>,
    costs: Costs<NoInfer<Outcome>, Action>,
  ): Effect.Effect<Selection<Action>, Schema.SchemaError>;
} = dual(
  2,
  Effect.fnUntraced(function*<Outcome extends string, Action extends string>(
    evidence: Answer.Distribution<Outcome>,
    costs: Costs<Outcome, Action>,
  ) {
    const alternatives = yield* risks(evidence, costs);
    const selected = Array.min(
      alternatives,
      Order.mapInput(Order.Number, (risk) => risk.expectedLoss),
    );
    return { ...selected, alternatives };
  }),
);

/**
 * Dispatches a choice to an exhaustive record of lazy Effect handlers.
 *
 * The selected handler receives the full evidence with `choice` narrowed to its
 * key. The returned Effect preserves the union of handler results, errors, and
 * service requirements. Handlers are not invoked until the Effect executes.
 *
 * Accepts model choices, selected candidates, and `minimizeLoss` results. Apply
 * `requireConfidence` before dispatch if the application needs a confidence gate.
 *
 * @category control flow
 * @since 0.0.0
 */
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
