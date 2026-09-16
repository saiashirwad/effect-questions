import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const repository = "Effect-TS/effect";
const candidateLimit = 12;

const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  pull_request: Schema.optionalKey(Schema.Unknown),
});

const workflow = Effect.gen(function*() {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* client.get(`https://api.github.com/repos/${repository}/issues`, {
    urlParams: { state: "open", sort: "created", direction: "desc", per_page: 50 },
    headers: { Accept: "application/vnd.github+json", "User-Agent": "effect-questions" },
  });
  const items = yield* HttpClientResponse.schemaBodyJson(Schema.Array(Issue))(response);
  const [issue, ...others] = items.filter((item) => item.pull_request === undefined);
  if (!issue) return yield* Console.log("No open issues in the fetched page.");

  yield* Console.log(`#${issue.number}: ${issue.title}\n${issue.html_url}`);
  const q = Questions.about({ title: issue.title, body: issue.body });
  const assessment = yield* q.ask({
    actionable: "Does this report provide concrete behavior or a specific requested change?",
    reproduction: "Does this report include code or steps that reproduce the problem?",
  });
  yield* Console.log(assessment);

  yield* q.branch("Which maintainer workflow best fits this issue?", {
    "A reproducible defect needs investigation": () => Console.log("Queue for bug investigation."),
    "A feature proposal needs API or design discussion": () =>
      Console.log("Queue for design discussion."),
    "A usage question or incomplete report needs clarification": () =>
      Console.log("Request the missing context or a minimal reproduction."),
  });

  if (others.length < 2) return;
  const candidate = yield* q.choose(
    "Which existing issue is most related to this report? Similarity alone does not mean duplicate.",
    Object.fromEntries(others.slice(0, candidateLimit).map((item) => [String(item.number), item])),
    (item) => `${item.title}\n${item.body ?? ""}`,
  );
  const duplicate = yield* Questions.about({
    issue: { title: issue.title, body: issue.body },
    candidate: { title: candidate.title, body: candidate.body },
  }).is(
    "Do both reports describe the same concrete defect or requested change, rather than just the same topic?",
  );
  yield* Console.log(
    duplicate
      ? `Possible duplicate: ${candidate.html_url}`
      : "No duplicate established among the candidates.",
  );
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(Effect.timeout("1 minute"), Effect.provide(QuestionsLive)));
