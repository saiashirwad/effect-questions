import { Record, Schema } from "effect";

export const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export interface Question<A> {
  readonly definition: typeof Definition.Type;
  readonly answer: Schema.Codec<A>;
}

const Criteria = Schema.Record(Schema.String, Schema.NullOr(Schema.String)).check(
  Schema.isMinProperties(2),
  Schema.isMaxProperties(255),
);

export const Definition = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: Schema.NonEmptyString,
    criteria: Criteria,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    instructions: Schema.NonEmptyString,
    criteria: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(255)),
  }),
  Schema.Struct({
    type: Schema.Literal("noul"),
    instructions: Schema.NonEmptyString,
    criteria: Schema.optionalKey(Schema.Struct({
      true: Schema.String,
      false: Schema.String,
    })),
  }),
]);

export const choice = <const L extends readonly [string, string, ...string[]]>(
  options: Schema.Literals<L>,
  config: {
    readonly instructions: string;
    readonly criteria: { readonly [K in L[number]]: string | null; };
  },
) => ({
  definition: { type: "choice" as const, ...config },
  answer: Schema.Struct({
    type: Schema.Literal("choice"),
    choice: options,
    probabilities: Schema.Record(options, Probability),
    confidence: Probability,
  }),
});

export const score = (config: {
  readonly instructions: string;
  readonly criteria: readonly [string, string, ...string[]];
}) => {
  const levels = Schema.Literals(config.criteria.map((_, index) => String(index)));
  return {
    definition: { type: "score" as const, ...config },
    answer: Schema.Struct({
      type: Schema.Literal("score"),
      score: Schema.Finite.check(Schema.isBetween({
        minimum: 0,
        maximum: config.criteria.length - 1,
      })),
      probabilities: Schema.Record(levels, Probability),
      confidence: Probability,
      legend: Schema.Record(levels, Schema.String),
    }),
  };
};

export const Noul = Schema.Struct({ type: Schema.Literal("noul"), noul: Probability });
export type Noul = typeof Noul.Type;

export const noul = (
  instructions: string,
  criteria?: { readonly true: string; readonly false: string; },
): Question<Noul> => ({
  definition: { type: "noul", instructions, ...(criteria === undefined ? {} : { criteria }) },
  answer: Noul,
});

export type Questions = Record.ReadonlyRecord<string, Question<unknown>>;
export type Answers<Q extends Questions> = {
  readonly [K in keyof Q]: Q[K]["answer"]["Type"];
};

export const Answers = <Q extends Questions>(questions: Q): Schema.Codec<Answers<Q>> =>
  Schema.Struct(Record.map(questions, (question) => question.answer)) as Schema.Codec<Answers<Q>>;
