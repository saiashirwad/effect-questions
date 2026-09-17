import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Duration, Effect, Layer, Metric, Record, type Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { resolve4 } from "node:dns/promises";
import { Jev, QuestionModel, Questions } from "../src/index.ts";

const site = "https://effect.website";
const report = "Since this morning the site feels slow for people in Europe, "
  + "and two of them were shown a page that was days out of date.";

const probes = [
  {
    name: "dns",
    purpose: "Resolve the hostname and list the addresses it points to",
    run: Effect.tryPromise(() => resolve4(new URL(site).hostname)).pipe(
      Effect.map((addresses) => ({ addresses })),
      Effect.catch((error) => Effect.succeed({ error: error.message })),
    ),
  },
  {
    name: "response",
    purpose: "Fetch the page once; record status, timing, and caching headers",
    run: Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient;
      const [elapsed, response] = yield* Effect.timed(client.get(site));
      return {
        status: response.status,
        milliseconds: Math.round(Duration.toMillis(elapsed)),
        cacheControl: response.headers["cache-control"] ?? null,
        cacheStatus: response.headers["cf-cache-status"] ?? null,
      };
    }).pipe(Effect.catch((error) => Effect.succeed({ error: error.message }))),
  },
];

const stop = { name: "stop", purpose: "No further probe would change the answer" };

const investigate = Effect.gen(function*() {
  let hypotheses: Record<string, string> = {
    dns: "The hostname resolves slowly or to the wrong addresses",
    origin: "The origin server is slow or returning errors",
    cdn: "A CDN is serving stale cached content",
    client: "The problem is on the reporters' networks, not the site",
  };
  const findings: Array<{ probe: string; observation: Schema.JsonObject; }> = [];
  let remaining = probes;

  while (remaining.length > 0 && Record.size(hypotheses) > 1) {
    const q = Questions.about({ report, hypotheses, findings });
    const probe = yield* q.choose(
      "Which probe would tell us the most?",
      [...remaining, stop],
      (p) => p.purpose,
    );
    if (!("run" in probe)) break;

    const observation = yield* probe.run;
    findings.push({ probe: probe.name, observation });
    remaining = remaining.filter((p) => p !== probe);
    yield* Console.log(`${probe.name}: ${JSON.stringify(observation)}`);

    const ruledOut = yield* Questions.about({ report, findings }).ask(
      Record.map(hypotheses, (claim) => `Do the findings rule this out? ${claim}`),
    );
    hypotheses = Record.filter(hypotheses, (_, key) => !ruledOut[key]);
    yield* Console.log(`Still plausible: ${Record.keys(hypotheses).join(", ") || "nothing"}`);
  }

  const [first, ...rest] = Record.values(hypotheses);
  if (!first) return yield* Console.log("Everything was ruled out. Hand the findings to a person.");
  const cause = rest.length === 0 ? first : yield* Questions.about({ report, findings }).choose(
    "Which explanation fits the findings best?",
    hypotheses,
    (claim) => claim,
    { confidence: 0.4 },
  );
  yield* Console.log(`Most likely: ${cause}`);

  const { count: tokens } = yield* Metric.value(QuestionModel.inputTokens);
  yield* Console.log(`Cost: ${tokens} input tokens.`);
}).pipe(
  Effect.catchTag(
    "UncertainDecision",
    () => Console.log("The findings do not single out a cause. Hand them to a person."),
  ),
);

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(investigate.pipe(Effect.timeout("2 minutes"), Effect.provide(QuestionsLive)));
