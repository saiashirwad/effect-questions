/**
 * The provider-neutral service for evaluating semantic questions.
 *
 * Configure a provider layer once at the application boundary. Workflows depend
 * on this service and compose evaluations through ordinary Effects.
 *
 * @since 0.0.0
 */
import { Context, Effect, Schema } from "effect";
import * as Question from "./Question.ts";

/**
 * Shared evaluation context: text, a JSON object, or a JSON array.
 *
 * @category schemas
 * @since 0.0.0
 */
export const State = Schema.Union([Schema.String, Schema.JsonObject, Schema.Array(Schema.Json)]);

/**
 * Serializable context supplied to every question in an evaluation.
 *
 * @category models
 * @since 0.0.0
 */
export type State = typeof State.Type;

/**
 * Provider-normalized token usage, represented as non-negative integers.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Usage = Schema.Struct({
  inputTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  outputTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/**
 * Constructs a schema for a complete batch result: model identifier, typed
 * answers for every supplied question, and token usage.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Evaluation = <Q extends Question.Questions>(questions: Q) =>
  Schema.Struct({
    model: Schema.String,
    answers: Question.Answers(questions),
    usage: Usage,
  });

/**
 * The schema-derived result of evaluating a particular question batch.
 *
 * @category models
 * @since 0.0.0
 */
export type Evaluation<Q extends Question.Questions> = ReturnType<typeof Evaluation<Q>>["Type"];

/**
 * A provider could not encode, execute, or decode an evaluation.
 *
 * The original cause is preserved for inspection with the underlying library's
 * error guards. Uncertainty in a valid answer is not a `QuestionError`.
 *
 * @category errors
 * @since 0.0.0
 */
export class QuestionError extends Schema.TaggedError<QuestionError>()("QuestionError", {
  /** The provider that failed, such as `"Jev"`. */
  provider: Schema.String,
  /** The original HTTP, encoding, or schema failure. */
  cause: Schema.Defect(),
}) {}

/**
 * The service implemented by question-model providers.
 *
 * Implementations evaluate a non-empty question batch against shared state,
 * validate and normalize its answers, and retain model and usage metadata.
 * Evaluation does not select application actions or apply confidence thresholds.
 *
 * @category services
 * @since 0.0.0
 */
export class QuestionModel extends Context.Service<QuestionModel, {
  /** Evaluates the batch, failing with `QuestionError` on provider or protocol failure. */
  readonly evaluate: <const Q extends Question.Questions>(
    state: State,
    questions: Q,
  ) => Effect.Effect<Evaluation<Q>, QuestionError>;
}>()("effect-questions/QuestionModel") {}

/**
 * Evaluates named questions using the `QuestionModel` service in the environment.
 *
 * With Jev, one batch is one HTTP request. Questions share state but are evaluated
 * separately; this does not imply statistical independence of their answers.
 * Sequence dependent questions with `yield*` after obtaining their required state.
 *
 * @example
 * ```ts
 * import { Question, QuestionModel } from "effect-questions";
 *
 * const assessment = QuestionModel.evaluate("Deployments fail after token rotation", {
 *   blocked: Question.boolean("Is production work blocked?"),
 *   impact: Question.score({
 *     instructions: "How disruptive is this issue?",
 *     criteria: ["Minor", "Work is impaired", "Production is blocked"],
 *   }),
 * });
 * ```
 *
 * @category accessors
 * @since 0.0.0
 */
export const evaluate = Effect.fnUntraced(function*<const Q extends Question.Questions>(
  state: State,
  questions: Q,
) {
  const model = yield* QuestionModel;
  return yield* model.evaluate(state, questions);
});
