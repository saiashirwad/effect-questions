/**
 * Schemas and pure operations for probabilistic evidence.
 *
 * Distribution operations preserve the supplied probability mass. They neither
 * normalize it nor infer independence between answers. Decode external data with
 * a schema before using the operations below.
 *
 * @since 0.0.0
 */
import { Array, Order, Record, Schema } from "effect";
import { dual } from "effect/Function";

/**
 * A finite number in the inclusive interval [0, 1].
 *
 * @category schemas
 * @since 0.0.0
 */
export const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

/**
 * Constructs the answer schema for a closed set of string options.
 *
 * Requires a selected option, a probability for every option, and the provider's
 * confidence. It validates membership and ranges, but does not recompute the
 * winner, confidence, or normalization of the distribution.
 *
 * @example
 * ```ts
 * import { Schema } from "effect";
 * import { Answer } from "effect-questions";
 *
 * const Route = Answer.Choice(Schema.Literals(["billing", "technical"]));
 * const answer = Route.make({
 *   type: "choice",
 *   choice: "technical",
 *   probabilities: { billing: 0.1, technical: 0.9 },
 *   confidence: 0.8,
 * });
 * ```
 *
 * @category schemas
 * @since 0.0.0
 */
export const Choice = <const Options extends ReadonlyArray<string>>(
  options: Schema.Literals<Options>,
) =>
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: options,
    probabilities: Schema.Record(options, Probability),
    confidence: Probability,
  });

/**
 * A choice answer retaining its literal option type and complete distribution.
 *
 * @category models
 * @since 0.0.0
 */
export type Choice<A extends string> = ReturnType<typeof Choice<ReadonlyArray<A>>>["Type"];

/**
 * Constructs an answer schema for an ordered rubric with at least two levels.
 *
 * The score is a probability-weighted, zero-based index, so a three-level rubric
 * produces values in [0, 2]. Probabilities and legend entries use stringified
 * indices. The schema checks bounds and required entries, not the arithmetic
 * relationship between the score and its distribution.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Score = (levels: readonly [string, string, ...string[]]) => {
  const indices = Schema.Literals(levels.map((_, index) => String(index)));
  return Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: levels.length - 1 })),
    probabilities: Schema.Record(indices, Probability),
    confidence: Probability,
    legend: Schema.Record(indices, Schema.String),
  });
};

/**
 * A weighted rubric score with its distribution, legend, and confidence.
 *
 * @category models
 * @since 0.0.0
 */
export type Score = ReturnType<typeof Score>["Type"];

/**
 * The schema for P(true). Boolean answers have no separate confidence field.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Boolean = Schema.Struct({
  type: Schema.Literal("boolean"),
  probability: Probability,
});

/**
 * A probabilistic answer to a yes/no question.
 *
 * @category models
 * @since 0.0.0
 */
export type Boolean = typeof Boolean.Type;

/**
 * Evidence over named outcomes. Absent outcomes carry no probability mass.
 *
 * Choice and score answers satisfy this interface. Aggregation may produce a
 * sparse distribution with no selected outcome or confidence statistic.
 *
 * @category models
 * @since 0.0.0
 */
export interface Distribution<A extends string> {
  /** Probability mass assigned to each present outcome. */
  readonly probabilities: Readonly<Partial<Record<A, number>>>;
}

/**
 * An outcome paired with its probability, as returned by ranking operations.
 *
 * @category models
 * @since 0.0.0
 */
export interface Ranked<A extends string> {
  /** The original outcome key. */
  readonly value: A;
  /** The probability assigned to this outcome. */
  readonly probability: number;
}

/** Enumerates present outcomes without adding mass for missing entries. */
const entries = <A extends string>(self: Distribution<A>): Array<Ranked<A>> =>
  (Object.keys(self.probabilities) as Array<A>).flatMap((value) => {
    const probability = self.probabilities[value];
    return probability === undefined ? [] : [{ value, probability }];
  });

/**
 * Expands P(true) into complementary `"true"` and `"false"` outcomes.
 *
 * @example
 * ```ts
 * import { Answer } from "effect-questions";
 *
 * const evidence = Answer.fromBoolean({ type: "boolean", probability: 0.9 });
 * const supported = Answer.probabilityOf(evidence, (outcome) => outcome === "true");
 * ```
 *
 * @category conversions
 * @since 0.0.0
 */
export const fromBoolean = (self: Boolean): Distribution<"true" | "false"> => ({
  probabilities: { true: self.probability, false: 1 - self.probability },
});

/**
 * Sums the probability mass of outcomes satisfying a pure predicate.
 *
 * An empty distribution or an event containing no present outcomes has mass zero.
 * Supports data-first and data-last invocation.
 *
 * @category combinators
 * @since 0.0.0
 */
export const probabilityOf: {
  <A extends string>(predicate: (value: A) => boolean): (self: Distribution<A>) => number;
  <A extends string>(self: Distribution<A>, predicate: (value: NoInfer<A>) => boolean): number;
} = dual(
  2,
  <A extends string>(self: Distribution<A>, predicate: (value: A) => boolean) =>
    entries(self).reduce((sum, entry) => sum + (predicate(entry.value) ? entry.probability : 0), 0),
);

/**
 * Returns a new array of outcomes ordered by descending probability.
 * Equal probabilities preserve the record's enumeration order.
 *
 * @category ordering
 * @since 0.0.0
 */
export const rank = <A extends string>(self: Distribution<A>): Array<Ranked<A>> =>
  Array.sort(
    entries(self),
    Order.mapInput(Order.flip(Order.Number), (entry: Ranked<A>) => entry.probability),
  );

/**
 * Returns the first `count` ranked outcomes, using Effect Array's `take` semantics.
 * Supports data-first and data-last invocation; the input is never mutated.
 *
 * @category ordering
 * @since 0.0.0
 */
export const topK: {
  (count: number): <A extends string>(self: Distribution<A>) => Array<Ranked<A>>;
  <A extends string>(self: Distribution<A>, count: number): Array<Ranked<A>>;
} = dual(
  2,
  <A extends string>(self: Distribution<A>, count: number) => Array.take(rank(self), count),
);

/**
 * Returns the difference between the two highest probabilities.
 *
 * A missing first or second outcome contributes zero. This is a separation
 * statistic, not the provider's confidence or the probability of correctness.
 *
 * @category statistics
 * @since 0.0.0
 */
export const margin = <A extends string>(self: Distribution<A>): number => {
  const [first, second] = topK(self, 2);
  return (first?.probability ?? 0) - (second?.probability ?? 0);
};

/**
 * Groups outcomes and sums their probabilities into broader categories.
 *
 * Only observed categories appear in the result. The original choice and
 * confidence are deliberately omitted: aggregation changes the distribution.
 * Supports data-first and data-last invocation.
 *
 * @example
 * ```ts
 * import { Answer } from "effect-questions";
 *
 * const departments = Answer.coarsen(
 *   { probabilities: { invoice: 0.36, refund: 0.34, integration: 0.3 } },
 *   (intent) => intent === "integration" ? "technical" : "billing",
 * );
 * const billing = Answer.probabilityOf(departments, (team) => team === "billing");
 * ```
 *
 * @category combinators
 * @since 0.0.0
 */
export const coarsen: {
  <A extends string, B extends string>(
    f: (value: A) => B,
  ): (self: Distribution<A>) => Distribution<B>;
  <A extends string, B extends string>(
    self: Distribution<A>,
    f: (value: NoInfer<A>) => B,
  ): Distribution<B>;
} = dual(
  2,
  <A extends string, B extends string>(
    self: Distribution<A>,
    f: (value: A) => B,
  ): Distribution<B> => {
    const groups = new Map<B, number>();
    for (const { value, probability } of entries(self)) {
      const group = f(value);
      groups.set(group, (groups.get(group) ?? 0) + probability);
    }
    return { probabilities: Record.fromEntries(groups) as Readonly<Partial<Record<B, number>>> };
  },
);

/**
 * Computes the sum of `probability * value(outcome)` over present outcomes.
 *
 * The callback is pure and is evaluated once per present outcome, including
 * outcomes with zero mass. No validation or normalization is performed here.
 * Use `Decision.risks` when cost validation belongs in the Effect error channel.
 * Supports data-first and data-last invocation.
 *
 * @category statistics
 * @since 0.0.0
 */
export const expectedValue: {
  <A extends string>(value: (outcome: A) => number): (self: Distribution<A>) => number;
  <A extends string>(self: Distribution<A>, value: (outcome: NoInfer<A>) => number): number;
} = dual(
  2,
  <A extends string>(self: Distribution<A>, value: (outcome: A) => number) =>
    entries(self).reduce((sum, entry) => sum + entry.probability * value(entry.value), 0),
);
