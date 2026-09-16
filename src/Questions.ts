/**
 * Context-bound semantic operations for ordinary Effect control flow.
 *
 * Start with `about(state)`, then ask questions or dispatch lazy branches. Schemas
 * and provider answer envelopes stay behind the authoring API; `evidence` exposes
 * them when a workflow needs an explicit confidence or expected-loss policy.
 *
 * @since 0.0.0
 */
import { Effect, Predicate, Record } from "effect";
import type * as Answer from "./Answer.ts";
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

/** Extracts the predicted value; an exactly even boolean probability favors true. */
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

/**
 * Binds shared state to semantic operations requiring a `QuestionModel`.
 *
 * Construction is pure. Each operation evaluates when its Effect runs. `ask`
 * explicitly batches independent questions; successive operations can depend on
 * earlier results. Create another scope with `about` when new observations should
 * become part of the state.
 *
 * `is` and `ask` turn boolean probabilities into predictions at a 0.5 boundary.
 * Choice operations use the model's selected option. These conveniences impose no
 * confidence gate; use `probability` or `evidence` for more deliberate policies.
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
 * @category constructors
 * @since 0.0.0
 */
export const about = (state: QuestionModel.State) => {
  /** Evaluates explicit question definitions while retaining the full evidence. */
  const evidence = <const Q extends Question.Questions>(questions: Q) =>
    QuestionModel.evaluate(state, questions);

  /** Evaluates a batch in one provider call and projects its answers into values. */
  const ask = Effect.fnUntraced(function*<const Q extends Batch>(questions: Q) {
    const result = yield* evidence(
      Record.map(
        questions,
        (question) => Predicate.isString(question) ? Question.boolean(question) : question,
      ),
    );
    return Record.map(result.answers, value) as Values<Q>;
  });

  /** Returns P(true), allowing the caller to choose a probability-based policy. */
  const probability = Effect.fnUntraced(function*(question: string) {
    const result = yield* evidence({ answer: Question.boolean(question) });
    return result.answers.answer.probability;
  });

  /** Returns the most likely boolean answer, with a 0.5 probability boundary. */
  const is = Effect.fnUntraced(function*(question: string) {
    return (yield* ask({ answer: question })).answer;
  });

  /** Returns a weighted zero-based score over the supplied ordered rubric. */
  const score = Effect.fnUntraced(
    function*(question: string, levels: readonly [string, string, ...string[]]) {
      return (yield* ask({ answer: Question.score({ instructions: question, criteria: levels }) }))
        .answer;
    },
  );

  /** Selects an original application object using only its ID and description. */
  const choose = Effect.fnUntraced(
    function*<const Candidates extends Readonly<Record<string, unknown>>>(
      question: string,
      candidates: Candidates,
      describe: (candidate: Candidates[keyof Candidates], id: keyof Candidates & string) => string,
    ) {
      const selection = yield* QuestionModel.choose({
        state,
        instructions: question,
        candidates,
        describe,
      });
      return selection.value;
    },
  );

  /** Selects a descriptive branch and invokes only that branch's Effect handler. */
  const branch = Effect.fnUntraced(
    function*<
      const Branches extends Readonly<
        Record<string, () => Effect.Effect<unknown, unknown, unknown>>
      >,
    >(
      question: string,
      branches: Branches,
    ) {
      const selection = yield* QuestionModel.choose({
        state,
        instructions: question,
        candidates: branches,
        describe: (_, description) => description,
      });
      return yield* Decision.match(selection, branches);
    },
  );

  return {
    /**
     * Evaluates a non-empty batch and returns plain values under the same keys.
     * Strings define yes/no questions; `Question` definitions add choices or scores.
     */
    ask,
    /** Asks a yes/no question and returns its predicted boolean value. */
    is,
    /** Returns P(true) rather than projecting it into a boolean. */
    probability,
    /** Returns a weighted zero-based rubric score. */
    score,
    /**
     * Selects an original candidate value without executing its behavior.
     * Provide at least two candidates and a pure description for each one.
     */
    choose,
    /**
     * Sends the keys as the model's available choices and their descriptions.
     * Provide at least two branches; include an explicit fallback when appropriate.
     * Only the selected handler executes, and its result becomes this Effect's value.
     */
    branch,
    /** Retains typed answers, distributions, confidence, model, and usage. */
    evidence,
  };
};
