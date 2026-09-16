import { Record, Schema } from "effect";
import * as Answer from "./Answer.ts";

export const ChoiceDefinition = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.Record(Schema.String, Schema.NullOr(Schema.String)).check(
    Schema.isMinProperties(2),
  ),
});

export const ScoreDefinition = Schema.Struct({
  type: Schema.Literal("score"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.Array(Schema.String).check(Schema.isMinLength(2)),
});

export const BooleanDefinition = Schema.Struct({
  type: Schema.Literal("boolean"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.optionalKey(Schema.Struct({ true: Schema.String, false: Schema.String })),
});

export const Definition = Schema.Union([ChoiceDefinition, ScoreDefinition, BooleanDefinition]);

export interface Question<A> {
  readonly definition: typeof Definition.Type;
  readonly answer: Schema.Codec<A>;
}

export const choice = <const Options extends ReadonlyArray<string>>(
  options: Schema.Literals<Options>,
  config: {
    readonly instructions: string;
    readonly criteria: { readonly [K in NoInfer<Options[number]>]: string | null; };
  },
): Question<Answer.Choice<Options[number]>> => ({
  definition: { type: "choice", ...config },
  answer: Answer.Choice(options),
});

export const score = (config: {
  readonly instructions: string;
  readonly criteria: readonly [string, string, ...string[]];
}): Question<Answer.Score> => ({
  definition: { type: "score", ...config },
  answer: Answer.Score(config.criteria),
});

export const boolean = (
  instructions: string,
  criteria?: { readonly true: string; readonly false: string; },
): Question<Answer.Boolean> => ({
  definition: { type: "boolean", instructions, ...(criteria === undefined ? {} : { criteria }) },
  answer: Answer.Boolean,
});

export type Questions = Record.ReadonlyRecord<string, Question<unknown>>;

export type Answers<Q extends Questions> = {
  readonly [K in keyof Q]: Q[K]["answer"]["Type"];
};

export const Answers = <Q extends Questions>(questions: Q): Schema.Codec<Answers<Q>> =>
  Schema.Struct(Record.map(questions, (question) => question.answer)) as Schema.Codec<Answers<Q>>;
