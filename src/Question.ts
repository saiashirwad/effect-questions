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
 * Text or labeled JSON describing an option or outcome to the model. `null`
 * lets the option's name carry its meaning.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Description = Schema.NullOr(
  Schema.Union([Schema.String, Schema.JsonObject, Schema.Array(Schema.Json)]),
);

/**
 * A description accepted anywhere a question describes its options.
 *
 * @category models
 * @since 0.0.0
 */
export type Description = typeof Description.Type;

/**
 * A closed-choice definition with non-empty instructions and at least two options.
 *
 * @category schemas
 * @since 0.0.0
 */
export const ChoiceDefinition = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: Schema.NonEmptyString,
  criteria: Schema.Record(Schema.String, Description).check(Schema.isMinProperties(2)),
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
  criteria: Schema.optionalKey(Schema.Struct({ true: Description, false: Description })),
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
 * Constructs a question whose answer is one of the option keys.
 *
 * The keys are the alternatives offered to the model and the literal type of the
 * answer; each value describes its key. Option-count limits beyond the two-option
 * minimum belong to the provider.
 *
 * @example
 * ```ts
 * import { Question } from "effect-questions";
 *
 * const owner = Question.choice("Which team owns this issue?", {
 *   billing: "Invoices and charges",
 *   technical: { what: "API and integration errors", not: "Pricing questions" },
 * });
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const choice = <const Options extends Readonly<Record<string, Description>>>(
  instructions: string,
  options: Options,
): Question<Answer.Choice<keyof Options & string>> => ({
  definition: { type: "choice", instructions, criteria: options },
  answer: Answer.Choice(Record.keys(options) as ReadonlyArray<keyof Options & string>),
});

/**
 * Constructs a question over ordered levels. Its answer retains the full
 * distribution as well as a weighted, zero-based score and confidence.
 *
 * @param instructions - The property to evaluate against the rubric.
 * @param levels - Level descriptions in ascending order, starting at index zero.
 *
 * @example
 * ```ts
 * import { Question } from "effect-questions";
 *
 * const impact = Question.score("How disruptive is the issue?", [
 *   "Work continues",
 *   "Some work is impaired",
 *   "Production is blocked",
 * ]);
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const score = (
  instructions: string,
  levels: readonly [string, string, ...string[]],
): Question<Answer.Score> => ({
  definition: { type: "score", instructions, criteria: levels },
  answer: Answer.Score(levels),
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
  criteria?: { readonly true: Description; readonly false: Description; },
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
