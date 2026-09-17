import { NodeRuntime } from "@effect/platform-node";
import { Array, Config, Console, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Jev, Question, Questions } from "../src/index.ts";

const repository = "Effect-TS/effect";

const Issue = Schema.Struct({
  title: Schema.String,
  pull_request: Schema.optionalKey(Schema.Unknown),
});

const titles = HttpClient.get(`https://api.github.com/repos/${repository}/issues`, {
  urlParams: { state: "open", per_page: 40 },
  headers: { Accept: "application/vnd.github+json", "User-Agent": "effect-questions" },
}).pipe(
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Issue))),
  Effect.map((items) => items.filter((item) => item.pull_request === undefined)),
  Effect.map((issues) => issues.map((issue) => issue.title)),
);

const program = Effect.gen(function*() {
  const open = yield* titles;
  const issues = Questions.each(open);

  // one request, however many issues
  const verdicts = yield* issues.ask({
    feature: "Is this a feature request?",
    urgency: Question.score("How urgent is this for users?", ["Low", "Medium", "High"]),
  });

  const rows = Array.zip(open, verdicts).toSorted(([, a], [, b]) => b.urgency - a.urgency);
  for (const [title, { feature, urgency }] of rows) {
    yield* Console.log(`${urgency.toFixed(1)}  ${feature ? "feature" : "       "}  ${title}`);
  }
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(program.pipe(Effect.timeout("1 minute"), Effect.provide(QuestionsLive)));
