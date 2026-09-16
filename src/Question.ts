/**
 * Provider-neutral question definitions paired with their answer schemas.
 *
 * Construct independent questions as a record and evaluate them against shared
 * state through `QuestionModel`. Constructors do not perform inference.
 *
 * @since 0.0.0
 */
import { Record, Schema } from "effect";
import * as Answer from "./Answer.ts";

/**
 * A closed-choice definition with non-empty instructions and at least two options.
 * A null description allows an option's name to supply its meaning.
 *
 * @category schemas
 * @since 0.0.0
 */
export const ChoiceDefinition = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.Record(Schema.String, Schema.NullOr(Schema.String)).check(
    Schema.isMinProperties(2),
  ),
});

/**
 * An ordered rubric definition containing at least two level descriptions.
 *
 * @category schemas
 * @since 0.0.0
 */
export const ScoreDefinition = Schema.Struct({
  type: Schema.Literal("score"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.Array(Schema.String).check(Schema.isMinLength(2)),
});

/**
 * A yes/no question with optional descriptions of both outcomes.
 *
 * @category schemas
 * @since 0.0.0
 */
export const BooleanDefinition = Schema.Struct({
  type: Schema.Literal("boolean"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.optionalKey(Schema.Struct({ true: Schema.String, false: Schema.String })),
});

/**
 * The provider-neutral question algebra. Providers translate these definitions
 * into their own protocols and enforce any additional capability limits.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Definition = Schema.Union([ChoiceDefinition, ScoreDefinition, BooleanDefinition]);

/**
 * A declarative judgment and a codec describing its normalized answer.
 *
 * @category models
 * @since 0.0.0
 */
export interface Question<A> {
  /** Instructions and the finite options or rubric sent to a provider. */
  readonly definition: typeof Definition.Type;
  /** Validates the provider-normalized answer and supplies its TypeScript type. */
  readonly answer: Schema.Codec<A>;
}

/**
 * Constructs a question whose selected answer is one of the supplied literals.
 *
 * Criteria must describe every option. The constructor preserves literal types;
 * providers validate the definition when evaluating it. Option-count limits
 * beyond the two-option minimum belong to the provider.
 *
 * @example
 * ```ts
 * import { Schema } from "effect";
 * import { Question } from "effect-questions";
 *
 * const route = Question.choice(Schema.Literals(["billing", "technical"]), {
 *   instructions: "Which team owns this issue?",
 *   criteria: { billing: "Invoices and charges", technical: "API and integration errors" },
 * });
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const choice = <const Options extends ReadonlyArray<string>>(
  options: Schema.Literals<Options>,
  config: {
    /** The specific judgment to make against the evaluation state. */
    readonly instructions: string;
    /** Descriptions keyed by the same literals as `options`. */
    readonly criteria: { readonly [K in NoInfer<Options[number]>]: string | null; };
  },
): Question<Answer.Choice<Options[number]>> => ({
  definition: { type: "choice", ...config },
  answer: Answer.Choice(options),
});

/**
 * Constructs a question over ordered levels. Its answer retains the full
 * distribution as well as a weighted, zero-based score and confidence.
 *
 * @example
 * ```ts
 * import { Question } from "effect-questions";
 *
 * const impact = Question.score({
 *   instructions: "How disruptive is the issue?",
 *   criteria: ["Work continues", "Some work is impaired", "Production is blocked"],
 * });
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const score = (config: {
  /** The property to evaluate against the rubric. */
  readonly instructions: string;
  /** Level descriptions in ascending score order, starting at index zero. */
  readonly criteria: readonly [string, string, ...string[]];
}): Question<Answer.Score> => ({
  definition: { type: "score", ...config },
  answer: Answer.Score(config.criteria),
});

/**
 * Constructs a question returning P(true), without a separate confidence field.
 *
 * @param instructions - A specific yes/no question about the evaluation state.
 * @param criteria - Optional descriptions clarifying both outcomes.
 *
 * @example
 * ```ts
 * import { Question } from "effect-questions";
 *
 * const supported = Question.boolean("Does the supplied passage support the claim?");
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const boolean = (
  instructions: string,
  criteria?: { readonly true: string; readonly false: string; },
): Question<Answer.Boolean> => ({
  definition: { type: "boolean", instructions, ...(criteria === undefined ? {} : { criteria }) },
  answer: Answer.Boolean,
});

/**
 * Named questions to evaluate independently against one shared state.
 *
 * @category models
 * @since 0.0.0
 */
export type Questions = Record.ReadonlyRecord<string, Question<unknown>>;

/**
 * Preserves the answer type associated with each key in a question batch.
 *
 * @category models
 * @since 0.0.0
 */
export type Answers<Q extends Questions> = {
  readonly [K in keyof Q]: Q[K]["answer"]["Type"];
};

/**
 * Builds a response schema requiring the corresponding answer for every question.
 * The type assertion restores the per-key correlation lost by record mapping.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Answers = <Q extends Questions>(questions: Q): Schema.Codec<Answers<Q>> =>
  Schema.Struct(Record.map(questions, (question) => question.answer)) as Schema.Codec<Answers<Q>>;
