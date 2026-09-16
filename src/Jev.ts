import {
  Config,
  Context,
  Effect,
  flow,
  Layer,
  Record,
  type Redacted,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import * as Question from "./Question.ts";

export const State = Schema.Union([Schema.String, Schema.JsonObject, Schema.Array(Schema.Json)]);
export type State = typeof State.Type;

const Usage = Schema.Struct({
  input_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  output_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const Evaluation = <Q extends Question.Questions>(questions: Q) =>
  Schema.Struct({
    model: Schema.String,
    answers: Question.Answers(questions),
    usage: Usage,
  });

export type Evaluation<Q extends Question.Questions> = ReturnType<
  typeof Evaluation<Q>
>["Type"];

export class JevError extends Schema.TaggedError<JevError>()("JevError", {
  cause: Schema.Defect(),
}) {}

export interface JevOptions {
  readonly apiKey: Redacted.Redacted<string>;
  readonly model?: string;
  readonly apiUrl?: string;
}

const Request = Schema.Struct({
  model: Schema.NonEmptyString,
  state: State,
  questions: Schema.Record(Schema.String, Question.Definition).check(
    Schema.isMinProperties(1),
  ),
});

export class Jev extends Context.Service<Jev, {
  readonly ask: <const Q extends Question.Questions>(
    state: State,
    questions: Q,
  ) => Effect.Effect<Evaluation<Q>, JevError>;
}>()("effect-jev/Jev") {
  static readonly make = Effect.fnUntraced(function*({ apiKey, model, apiUrl }: JevOptions) {
    const client = yield* HttpClient.HttpClient.pipe(
      Effect.map(HttpClient.mapRequest(flow(
        HttpClientRequest.prependUrl(apiUrl ?? "https://api.typesafe.ai/v1"),
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.acceptJson,
      ))),
      Effect.map(HttpClient.filterStatusOk),
      // TypeSafe recommends exponential backoff for 429/529: https://docs.typesafe.ai/api#handling-rate-limits
      Effect.map(HttpClient.retry({
        times: 2,
        schedule: Schedule.exponential("200 millis"),
        while: (error) =>
          error.reason._tag === "StatusCodeError"
          && [429, 529].includes(error.reason.response.status),
      })),
    );

    const ask = Effect.fn("Jev.ask")(function*<const Q extends Question.Questions>(
      state: State,
      questions: Q,
    ) {
      const request = yield* HttpClientRequest.post("/systemone").pipe(
        HttpClientRequest.schemaBodyJson(Request)({
          model: model ?? "jev-latest",
          state,
          questions: Record.map(questions, (question) => question.definition),
        }),
      );
      const response = yield* client.execute(request);
      return yield* HttpClientResponse.schemaBodyJson(Evaluation(questions))(response);
    }, Effect.mapError((cause) => new JevError({ cause })));

    return Jev.of({ ask });
  });

  static readonly layer = (options: JevOptions) => Layer.effect(Jev, Jev.make(options));

  static readonly layerConfig = (options: Config.Wrap<JevOptions>) =>
    Layer.effect(Jev, Config.unwrap(options).pipe(Effect.flatMap(Jev.make)));
}
