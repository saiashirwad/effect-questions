/**
 * Context-bound semantic operations for ordinary Effect control flow.
 *
 * Start with `about(state)`, then ask questions, select application objects, or
 * dispatch lazy branches. Schemas and provider answer envelopes stay behind this
 * API; `evidence` exposes them when a workflow needs an explicit policy.
 *
 * @since 0.0.0
 */
import { Effect, Predicate, Record } from "effect";
import * as Answer from "./Answer.ts";
import * as Decision from "./Decision.ts";
import * as Question from "./Question.ts";
import * as QuestionModel from "./QuestionModel.ts";

/** The normalized primitive answers that can be projected into program values. */
type Primitive = Answer.Boolean | Answer.Choice<string> | Answer.Score;

/**
 * A named batch of questions. Strings are shorthand for yes/no questions;
 * explicit question definitions add choices and scored rubrics.
 *
 * @category models
 * @since 0.0.0
 */
export type Batch = Readonly<Record<string, string | Question.Question<Primitive>>>;

/** Projects a primitive answer into the value used by ordinary control flow. */
type Value<A> = A extends Answer.Boolean ? boolean
  : A extends Answer.Choice<infer Choice> ? Choice
  : A extends Answer.Score ? number
  : never;

/**
 * The plain values produced by a question batch, preserving its keys and choices.
 *
 * @category models
 * @since 0.0.0
 */
export type Values<Q extends Batch> = {
  readonly [K in keyof Q]: Q[K] extends string ? boolean
    : Q[K] extends Question.Question<infer A> ? Value<A>
    : never;
};

/**
 * Application values to select among: an array, or a record keyed by stable IDs
 * that the model sees as option names.
 *
 * @category models
 * @since 0.0.0
 */
export type Candidates = ReadonlyArray<unknown> | Readonly<Record<string, unknown>>;

/**
 * The element type of a candidate collection.
 *
 * @category models
 * @since 0.0.0
 */
export type Candidate<C extends Candidates> = C extends ReadonlyArray<infer A> ? A : C[keyof C];

/**
 * Optional requirements applied before an answer becomes a program value.
 *
 * @category models
 * @since 0.0.0
 */
export interface Options {
  /**
   * The minimum confidence, in [0, 1], for the answer to be used. Choice and score
   * answers use the provider's confidence; a yes/no answer uses the margin between
   * yes and no, so `0.8` requires P(true) outside the interval (0.1, 0.9).
   * An answer below the minimum fails with `UncertainDecision`.
   */
  readonly confidence?: number;
}

/** Extracts the more likely value; an exactly even yes/no probability favors true. */
const value = (answer: Primitive) => {
  switch (answer.type) {
    case "boolean":
      return answer.probability >= 0.5;
    case "choice":
      return answer.choice;
    case "score":
      return answer.score;
  }
};

/** The confidence statistic compared against `Options.confidence`. */
const confidence = (answer: Primitive) =>
  answer.type === "boolean" ? Answer.margin(Answer.fromBoolean(answer)) : answer.confidence;

/** Fails with `UncertainDecision` when a required confidence is not met. */
const accept = Effect.fnUntraced(function*(answer: Primitive, question: string, options?: Options) {
  const minimum = options?.confidence;
  if (minimum !== undefined && confidence(answer) < minimum) {
    return yield* new Decision.UncertainDecision({
      confidence: confidence(answer),
      minimum,
      question,
    });
  }
});

/** Indexes array candidates by position; records already carry their IDs. */
const keyed = <C extends Candidates>(candidates: C): Record<string, Candidate<C>> =>
  Array.isArray(candidates)
    ? Record.fromEntries(candidates.map((candidate, index) => [String(index + 1), candidate]))
    : { ...(candidates as Readonly<Record<string, Candidate<C>>>) };

/**
 * Binds context to semantic operations requiring a `QuestionModel`.
 *
 * The context is a value, or an Effect that produces one: a `Ref.get`, a service
 * lookup, a file read. An Effect is run each time an operation runs, so one binding
 * follows context that changes, and an operation such as `q.is(...)` is a reusable
 * Effect that judges the current context whenever it is executed.
 *
 * Construction is pure. `ask` batches independent questions into one evaluation;
 * successive operations can depend on earlier results.
 *
 * Values are the model's most likely answers: the selected option, or yes when
 * P(true) is at least 0.5. Pass `{ confidence }` to any operation to refuse
 * answers the model is unsure about; use `probability`, `rank`, or `evidence`
 * when the program wants to weigh the alternatives itself.
 *
 * @example
 * ```ts
 * import { Console, Effect } from "effect";
 * import { Questions } from "effect-questions";
 *
 * const q = Questions.about("Deployments fail after token rotation");
 *
 * const program = Effect.gen(function*() {
 *   if (yield* q.is("Is production work blocked?")) {
 *     yield* Console.log("Prioritize this issue");
 *   }
 *   return yield* q.branch("What kind of help is needed?", {
 *     "Invoices, payments, or refunds": () => Console.log("Route to billing"),
 *     "Bugs, outages, or deployment failures": () => Console.log("Investigate"),
 *   });
 * });
 * ```
 *
 * @example
 * ```ts
 * import { Effect, Ref } from "effect";
 * import { Questions } from "effect-questions";
 *
 * const program = Effect.gen(function*() {
 *   const findings = yield* Ref.make<ReadonlyArray<string>>([]);
 *   const settled = Questions.about(Ref.get(findings)).is("Do the findings establish the cause?");
 *   // `settled` re-reads the findings every time it runs
 *   yield* Ref.update(findings, (all) => [...all, "The token lost deploy:write"]);
 *   return yield* settled;
 * });
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const about = <E = never, R = never>(
  state: QuestionModel.State | Effect.Effect<QuestionModel.State, E, R>,
) => {
  const read = (Effect.isEffect(state) ? state : Effect.succeed(state)) as Effect.Effect<
    QuestionModel.State,
    E,
    R
  >;

  /** Reads the context, then evaluates explicit question definitions with full evidence. */
  const evidence = <const Q extends Question.Questions>(questions: Q) =>
    Effect.flatMap(read, (current) => QuestionModel.evaluate(current, questions));

  /** Evaluates a batch in one provider call and projects its answers into values. */
  const ask = Effect.fnUntraced(function*<const Q extends Batch>(questions: Q, options?: Options) {
    const definitions = Record.map(
      questions,
      (question) => Predicate.isString(question) ? Question.boolean(question) : question,
    );
    const result = yield* evidence(definitions);
    const answers = result.answers as Record<string, Primitive>;
    for (const key of Record.keys(answers)) {
      yield* accept(answers[key]!, definitions[key]!.definition.instructions, options);
    }
    return Record.map(answers, value) as Values<Q>;
  });

  /** Returns P(true), allowing the caller to choose a probability-based policy. */
  const probability = Effect.fnUntraced(function*(question: string) {
    const result = yield* evidence({ answer: Question.boolean(question) });
    return result.answers.answer.probability;
  });

  /** Returns the more likely yes/no answer. */
  const is = Effect.fnUntraced(function*(question: string, options?: Options) {
    return (yield* ask({ answer: question }, options)).answer;
  });

  /** Returns a weighted zero-based score over the supplied ordered rubric. */
  const score = Effect.fnUntraced(function*(
    question: string,
    levels: readonly [string, string, ...string[]],
    options?: Options,
  ) {
    return (yield* ask({ answer: Question.score(question, levels) }, options)).answer;
  });

  /** Evaluates one choice over keyed candidates, sending only their descriptions. */
  const select = Effect.fnUntraced(function*<K extends string, A>(
    question: string,
    candidates: Readonly<Record<K, A>>,
    describe: (candidate: A, key: K) => Question.Description,
  ) {
    const result = yield* evidence({
      answer: Question.choice(question, Record.map(candidates, describe)),
    });
    return result.answers.answer;
  });

  /** Orders the original candidates by the probability the model assigns to each. */
  const rank = Effect.fnUntraced(function*<const C extends Candidates>(
    question: string,
    candidates: C,
    describe: (candidate: Candidate<C>, key: string) => Question.Description,
  ) {
    const byKey = keyed(candidates);
    const answer = yield* select(question, byKey, describe);
    return Answer.rank(answer).map(({ value, probability }) => ({
      value: byKey[value]!,
      probability,
    }));
  });

  /** Selects an original candidate using only its description. */
  const choose = Effect.fnUntraced(function*<const C extends Candidates>(
    question: string,
    candidates: C,
    describe: (candidate: Candidate<C>, key: string) => Question.Description,
    options?: Options,
  ) {
    const byKey = keyed(candidates);
    const answer = yield* select(question, byKey, describe);
    yield* accept(answer, question, options);
    return byKey[answer.choice]!;
  });

  /** Selects a descriptive branch and invokes only that branch's Effect handler. */
  const branch = Effect.fnUntraced(function*<
    const Branches extends Readonly<Record<string, () => Effect.Effect<unknown, unknown, unknown>>>,
  >(question: string, branches: Branches, options?: Options) {
    const answer = yield* select<keyof Branches & string, Branches[keyof Branches]>(
      question,
      branches,
      (_, description) => description,
    );
    yield* accept(answer, question, options);
    return yield* Decision.match(answer, branches);
  });

  return {
    /**
     * Evaluates a non-empty batch in one request and returns plain values under
     * the same keys. Strings define yes/no questions; `Question` definitions add
     * choices or scores. Ask speculatively: extra questions cost no extra round trip.
     */
    ask,
    /** Asks a yes/no question and returns the more likely answer. */
    is,
    /** Returns P(true) rather than projecting it into a boolean. */
    probability,
    /** Returns a weighted zero-based rubric score. */
    score,
    /**
     * Returns the original candidate the model selects, without executing any
     * behavior it may carry. Provide at least two candidates and a pure
     * description for each; add an explicit alternative when none may apply.
     */
    choose,
    /**
     * Returns every candidate in descending order of probability, paired with
     * that probability. One request, however many candidates.
     */
    rank,
    /**
     * Sends the keys as the model's available choices, in the words the program
     * uses. Only the selected handler executes, and its result, errors, and
     * requirements become those of this Effect. Provide at least two branches.
     */
    branch,
    /** Retains typed answers, distributions, confidence, model, and usage. */
    evidence,
  };
};
