import { Context, Effect, Record, Schema } from "effect";
import * as Question from "./Question.ts";

export const State = Schema.Union([Schema.String, Schema.JsonObject, Schema.Array(Schema.Json)]);
export type State = typeof State.Type;

export const Usage = Schema.Struct({
  inputTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  outputTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const Evaluation = <Q extends Question.Questions>(questions: Q) =>
  Schema.Struct({
    model: Schema.String,
    answers: Question.Answers(questions),
    usage: Usage,
  });

export type Evaluation<Q extends Question.Questions> = ReturnType<typeof Evaluation<Q>>["Type"];

export class QuestionError extends Schema.TaggedError<QuestionError>()("QuestionError", {
  provider: Schema.String,
  cause: Schema.Defect(),
}) {}

export class QuestionModel extends Context.Service<QuestionModel, {
  readonly evaluate: <const Q extends Question.Questions>(
    state: State,
    questions: Q,
  ) => Effect.Effect<Evaluation<Q>, QuestionError>;
}>()("effect-questions/QuestionModel") {}

export const evaluate = Effect.fnUntraced(function*<const Q extends Question.Questions>(
  state: State,
  questions: Q,
) {
  const model = yield* QuestionModel;
  return yield* model.evaluate(state, questions);
});

export const choose = Effect.fnUntraced(
  function*<const Candidates extends Readonly<Record<string, unknown>>>(
    options: {
      readonly state: State;
      readonly instructions: string;
      readonly candidates: Candidates;
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
      value: candidates[answer.choice],
      model: result.model,
      usage: result.usage,
    };
  },
);
