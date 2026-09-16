/**
 * Jev's implementation of the provider-neutral `QuestionModel` service.
 *
 * The adapter owns TypeSafe's HTTP protocol, `noul` conversion, token-usage
 * normalization, and provider-specific cardinality limits. Applications supply
 * an Effect `HttpClient` when composing the layer.
 *
 * @since 0.0.0
 */
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

/**
 * Resolved Jev connection settings. Use `layerConfig` to obtain settings from
 * Effect `Config` without coupling the provider to environment variable names.
 *
 * @category configuration
 * @since 0.0.0
 */
export interface Options {
  /** API key used as a bearer token, redacted when inspecting configuration. */
  readonly apiKey: Redacted.Redacted<string>;
  /** Model identifier. Defaults to `"jev-latest"`. */
  readonly model?: string;
  /** API base URL. Defaults to `"https://api.typesafe.ai/v1"`. */
  readonly apiUrl?: string;
}

/** Translates TypeSafe's `noul` answer into the provider-neutral boolean shape. */
const Noul = Schema.Struct({ type: Schema.Literal("noul"), noul: Answer.Probability }).pipe(
  Schema.decodeTo(Answer.Boolean, {
    decode: SchemaGetter.transform(({ noul }) => ({ type: "boolean" as const, probability: noul })),
    encode: SchemaGetter.transform(({ probability }) => ({
      type: "noul" as const,
      noul: probability,
    })),
  }),
);

/** Converts snake-case wire counters to the shared camel-case usage model. */
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

/**
 * Decodes the wire envelope and each question's normalized answer. The assertion
 * restores the association between question keys and their individual decoders.
 */
const Response = <Q extends Question.Questions>(questions: Q) =>
  Schema.Struct({
    model: Schema.String,
    usage: WireUsage,
    answers: Schema.Struct(Record.map(questions, (question) =>
      question.definition.type === "boolean"
        ? Noul.pipe(Schema.decodeTo(question.answer))
        : question.answer)) as Schema.Decoder<Question.Answers<Q>>,
  });

/** Validates Jev's non-empty batch and limits each choice or score to 255 entries. */
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

/**
 * Constructs a `QuestionModel` implementation using the provided `HttpClient`.
 *
 * Evaluations validate requests and responses, normalize Jev's answer shapes,
 * and wrap operational failures in `QuestionError` with their original cause.
 * HTTP 429 and 529 responses are retried twice with exponential backoff starting
 * at 200ms. Other statuses and schema failures are not retried by this adapter.
 *
 * No workflow timeout or confidence policy is imposed. Configure those at the
 * application boundary using ordinary Effect operations.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function*({ apiKey, model, apiUrl }: Options) {
  const client = yield* HttpClient.HttpClient.pipe(
    Effect.map(HttpClient.mapRequest(flow(
      HttpClientRequest.prependUrl(apiUrl ?? "https://api.typesafe.ai/v1"),
      HttpClientRequest.bearerToken(apiKey),
      HttpClientRequest.acceptJson,
    ))),
    Effect.map(HttpClient.filterStatusOk),
    /** TypeSafe recommends exponential backoff: https://docs.typesafe.ai/api#handling-rate-limits */
    Effect.map(HttpClient.retry({
      times: 2,
      schedule: Schedule.exponential("200 millis"),
      while: (error) =>
        error.reason._tag === "StatusCodeError"
        && [429, 529].includes(error.reason.response.status),
    })),
  );

  /** Encodes one batch and decodes its schema-specific response under a tracing span. */
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

/**
 * Provides `QuestionModel` from resolved options, requiring an `HttpClient`.
 * Construction does not make a network request.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (options: Options) => Layer.effect(QuestionModel, make(options));

/**
 * Provides `QuestionModel` from plain values or Effect `Config` settings.
 *
 * Requires an `HttpClient` and may fail with `ConfigError` while resolving options.
 * Supply the transport once when building the application's layer.
 *
 * @example
 * ```ts
 * import { Config, Layer } from "effect";
 * import { FetchHttpClient } from "effect/unstable/http";
 * import * as Jev from "effect-questions/providers/Jev";
 *
 * const QuestionsLive = Jev.layerConfig({
 *   apiKey: Config.Redacted("TYPESAFE_API_KEY"),
 * }).pipe(Layer.provide(FetchHttpClient.layer));
 * ```
 *
 * @category layers
 * @since 0.0.0
 */
export const layerConfig = (options: Config.Wrap<Options>) =>
  Layer.effect(QuestionModel, Config.unwrap(options).pipe(Effect.flatMap(make)));
