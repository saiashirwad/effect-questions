import { Array, Order, Record, Schema } from "effect";
import { dual } from "effect/Function";

export const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const Choice = <const Options extends ReadonlyArray<string>>(
  options: Schema.Literals<Options>,
) =>
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: options,
    probabilities: Schema.Record(options, Probability),
    confidence: Probability,
  });

export type Choice<A extends string> = ReturnType<typeof Choice<ReadonlyArray<A>>>["Type"];

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

export type Score = ReturnType<typeof Score>["Type"];

export const Boolean = Schema.Struct({
  type: Schema.Literal("boolean"),
  probability: Probability,
});

export type Boolean = typeof Boolean.Type;

export interface Distribution<A extends string> {
  readonly probabilities: Readonly<Partial<Record<A, number>>>;
}

export interface Ranked<A extends string> {
  readonly value: A;
  readonly probability: number;
}

const entries = <A extends string>(self: Distribution<A>): Array<Ranked<A>> =>
  (Object.keys(self.probabilities) as Array<A>).flatMap((value) => {
    const probability = self.probabilities[value];
    return probability === undefined ? [] : [{ value, probability }];
  });

export const fromBoolean = (self: Boolean): Distribution<"true" | "false"> => ({
  probabilities: { true: self.probability, false: 1 - self.probability },
});

export const probabilityOf: {
  <A extends string>(predicate: (value: A) => boolean): (self: Distribution<A>) => number;
  <A extends string>(self: Distribution<A>, predicate: (value: NoInfer<A>) => boolean): number;
} = dual(
  2,
  <A extends string>(self: Distribution<A>, predicate: (value: A) => boolean) =>
    entries(self).reduce((sum, entry) => sum + (predicate(entry.value) ? entry.probability : 0), 0),
);

export const rank = <A extends string>(self: Distribution<A>): Array<Ranked<A>> =>
  Array.sort(
    entries(self),
    Order.mapInput(Order.flip(Order.Number), (entry: Ranked<A>) => entry.probability),
  );

export const topK: {
  (count: number): <A extends string>(self: Distribution<A>) => Array<Ranked<A>>;
  <A extends string>(self: Distribution<A>, count: number): Array<Ranked<A>>;
} = dual(
  2,
  <A extends string>(self: Distribution<A>, count: number) => Array.take(rank(self), count),
);

export const margin = <A extends string>(self: Distribution<A>): number => {
  const [first, second] = topK(self, 2);
  return (first?.probability ?? 0) - (second?.probability ?? 0);
};

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

export const expectedValue: {
  <A extends string>(value: (outcome: A) => number): (self: Distribution<A>) => number;
  <A extends string>(self: Distribution<A>, value: (outcome: NoInfer<A>) => number): number;
} = dual(
  2,
  <A extends string>(self: Distribution<A>, value: (outcome: A) => number) =>
    entries(self).reduce((sum, entry) => sum + entry.probability * value(entry.value), 0),
);
