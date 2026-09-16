import {
  Config,
  Effect,
  flow,
  Layer,
  Record,
  type Redacted,
  Schedule,
  Schema,
  SchemaGetter,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import * as Answer from "../Answer.ts";
import * as Question from "../Question.ts";
import { QuestionError, QuestionModel, State, Usage } from "../QuestionModel.ts";

export interface Options {
  readonly apiKey: Redacted.Redacted<string>;
  readonly model?: string;
  readonly apiUrl?: string;
}

const Noul = Schema.Struct({ type: Schema.Literal("noul"), noul: Answer.Probability }).pipe(
  Schema.decodeTo(Answer.Boolean, {
    decode: SchemaGetter.transform(({ noul }) => ({ type: "boolean" as const, probability: noul })),
    encode: SchemaGetter.transform(({ probability }) => ({
      type: "noul" as const,
      noul: probability,
    })),
  }),
);

const WireUsage = Schema.Struct({
  input_tokens: Usage.fields.inputTokens,
  output_tokens: Usage.fields.outputTokens,
}).pipe(
  Schema.decodeTo(Usage, {
    decode: SchemaGetter.transform(({ input_tokens, output_tokens }) => ({
      inputTokens: input_tokens,
      outputTokens: output_tokens,
    })),
    encode: SchemaGetter.transform(({ inputTokens, outputTokens }) => ({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    })),
  }),
);

const Response = <Q extends Question.Questions>(questions: Q) =>
  Schema.Struct({
    model: Schema.String,
    usage: WireUsage,
    answers: Schema.Struct(Record.map(questions, (question) =>
      question.definition.type === "boolean"
        ? Noul.pipe(Schema.decodeTo(question.answer))
        : question.answer)) as Schema.Decoder<Question.Answers<Q>>,
  });

const Request = Schema.Struct({
  model: Schema.NonEmptyString,
  state: State,
  questions: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.Struct({
        ...Question.ChoiceDefinition.fields,
        criteria: Question.ChoiceDefinition.fields.criteria.check(Schema.isMaxProperties(255)),
      }),
      Schema.Struct({
        ...Question.ScoreDefinition.fields,
        criteria: Question.ScoreDefinition.fields.criteria.check(Schema.isMaxLength(255)),
      }),
      Schema.Struct({ ...Question.BooleanDefinition.fields, type: Schema.Literal("noul") }),
    ]),
  ).check(Schema.isMinProperties(1)),
});

export const make = Effect.fnUntraced(function*({ apiKey, model, apiUrl }: Options) {
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

  const evaluate = Effect.fn("Jev.evaluate")(
    function*<const Q extends Question.Questions>(state: State, questions: Q) {
      const request = yield* HttpClientRequest.post("/systemone").pipe(
        HttpClientRequest.schemaBodyJson(Request)({
          model: model ?? "jev-latest",
          state,
          questions: Record.map(
            questions,
            ({ definition }) =>
              definition.type === "boolean" ? { ...definition, type: "noul" as const } : definition,
          ),
        }),
      );
      const response = yield* client.execute(request);
      return yield* HttpClientResponse.schemaBodyJson(Response(questions))(response);
    },
    Effect.mapError((cause) => new QuestionError({ provider: "Jev", cause })),
  );

  return QuestionModel.of({ evaluate });
});

export const layer = (options: Options) => Layer.effect(QuestionModel, make(options));

export const layerConfig = (options: Config.Wrap<Options>) =>
  Layer.effect(QuestionModel, Config.unwrap(options).pipe(Effect.flatMap(make)));
