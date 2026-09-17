import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Ref, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const repository = "Effect-TS/effect";
const wanted = "a bug where a logger formats errors incorrectly";
const pageSize = 10;
const extraPages = 3;

const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  html_url: Schema.String,
  pull_request: Schema.optionalKey(Schema.Unknown),
});
type Issue = typeof Issue.Type;

const titles = (issues: ReadonlyArray<Issue>) =>
  issues.map(({ number, title }) => `#${number} ${title}`);

const openIssues = (page: number) =>
  HttpClient.get(`https://api.github.com/repos/${repository}/issues`, {
    urlParams: { state: "open", sort: "created", direction: "desc", per_page: pageSize, page },
    headers: { Accept: "application/vnd.github+json", "User-Agent": "effect-questions" },
  }).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Issue))),
    Effect.map((items) => items.filter((item) => item.pull_request === undefined)),
  );

const search = Effect.gen(function*() {
  const page = yield* Ref.make(0);
  const seen = yield* Ref.make<ReadonlyArray<Issue>>([]);

  const fetchNextPage = Effect.gen(function*() {
    const next = yield* Ref.updateAndGet(page, (n) => n + 1);
    const issues = yield* openIssues(next);
    yield* Console.log(`page ${next}: ${issues.length} issues`);
    yield* Ref.update(seen, (all) => [...all, ...issues]);
  });

  // do { fetch a page } until the model sees a match, or the page budget runs out
  const found = Questions.about(Ref.get(seen).pipe(Effect.map(titles))).is(
    `Does any title look like ${wanted}?`,
  );
  yield* fetchNextPage.pipe(Effect.repeat({ until: () => found, times: extraPages }));
  const issues = yield* Ref.get(seen);
  const pages = yield* Ref.get(page);

  const none = { title: "None of these" };
  const match = yield* Questions.about(wanted).choose(
    "Which issue best matches what we are looking for?",
    [...issues, none],
    ({ title }) => title,
    { confidence: 0.5 },
  );
  yield* Console.log(
    "html_url" in match
      ? `Found after ${pages} page(s): ${match.html_url}`
      : `Nothing convincing in ${issues.length} issues.`,
  );
}).pipe(
  Effect.catchTag(
    "UncertainDecision",
    () => Console.log("Several issues are close; a person should pick."),
  ),
);

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(search.pipe(Effect.timeout("1 minute"), Effect.provide(QuestionsLive)));
