/**
 * The provider-neutral service for evaluating semantic questions.
 *
 * Configure a provider layer once at the application boundary. Workflows depend
 * on this service and compose evaluations through ordinary Effects.
 *
 * @since 0.0.0
 */
import { Context, Effect, Record, Schema } from "effect";
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

/**
 * Selects an original application value from candidates keyed by stable IDs.
 *
 * Sends only the supplied state, instructions, candidate IDs, and descriptions
 * to the provider. Candidate objects may contain Effects or other non-JSON values.
 * The result adds the original object as `value` and preserves choice evidence,
 * model identifier, and usage. It never executes a candidate's behavior.
 *
 * Candidate membership is shallow-copied when the Effect executes; object identity
 * is retained. At least two candidates are required, subject to provider limits.
 * Include an explicit alternative if none of the candidates may be appropriate.
 *
 * @example
 * ```ts
 * import { Effect } from "effect";
 * import { QuestionModel } from "effect-questions";
 *
 * const selection = QuestionModel.choose({
 *   state: "The API returns 403 after token rotation",
 *   instructions: "Which diagnostic should run first?",
 *   candidates: {
 *     credentials: { summary: "Compare token scopes", inspect: Effect.succeed("Token metadata") },
 *     status: { summary: "Inspect active incidents", inspect: Effect.succeed("Service status") },
 *   },
 *   describe: (candidate) => candidate.summary,
 * });
 * ```
 *
 * @category accessors
 * @since 0.0.0
 */
export const choose = Effect.fnUntraced(
  function*<const Candidates extends Readonly<Record<string, unknown>>>(
    options: {
      /** Serializable context for the selection. */
      readonly state: State;
      /** What makes one candidate preferable to the others. */
      readonly instructions: string;
      /** Available values indexed by stable, unique IDs. */
      readonly candidates: Candidates;
      /** Purely describes a candidate; called once per candidate per evaluation. */
      readonly describe: (
        candidate: Candidates[keyof Candidates],
        id: keyof Candidates & string,
      ) => string;
    },
  ) {
    const candidates = { ...options.candidates };
    const result = yield* evaluate(options.state, {
      selection: Question.choice(
        Schema.Literals(Record.keys<keyof Candidates & string, unknown>(candidates)),
        {
          instructions: options.instructions,
          criteria: Record.map<keyof Candidates & string, Candidates[keyof Candidates], string>(
            candidates,
            options.describe,
          ),
        },
      ),
    });
    const answer = result.answers.selection;
    return {
      ...answer,
      value: candidates[answer.choice] as Candidates[keyof Candidates],
      model: result.model,
      usage: result.usage,
    };
  },
);
