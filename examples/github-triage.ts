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
type Issue = typeof Issue.Type;

const summary = ({ title, body }: Issue) => ({ title, body });

const openIssues = HttpClient.get(`https://api.github.com/repos/${repository}/issues`, {
  urlParams: { state: "open", sort: "created", direction: "desc", per_page: 50 },
  headers: { Accept: "application/vnd.github+json", "User-Agent": "effect-questions" },
}).pipe(
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Issue))),
  Effect.map((items) => items.filter((item) => item.pull_request === undefined)),
);

const workflow = Effect.gen(function*() {
  const [issue, ...others] = yield* openIssues;
  if (!issue) return yield* Console.log("No open issues in the fetched page.");

  yield* Console.log(`#${issue.number}: ${issue.title}\n${issue.html_url}`);
  const q = Questions.about(summary(issue));
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
  const related = yield* q.rank(
    "Which existing issue is most related to this report?",
    others.slice(0, candidateLimit),
    summary,
  );
  const duplicates = yield* Effect.filter(
    related.slice(0, 3),
    ({ value: other }) =>
      Questions.about({ issue: summary(issue), other: summary(other) }).is(
        "Do both reports describe the same concrete defect or requested change, rather than just the same topic?",
      ),
    { concurrency: 3 },
  );
  yield* Console.log(
    duplicates.length === 0
      ? "No duplicate established among the closest candidates."
      : `Possible duplicates:\n${duplicates.map(({ value }) => `  ${value.html_url}`).join("\n")}`,
  );
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(Effect.timeout("1 minute"), Effect.provide(QuestionsLive)));
