import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Duration, Effect, Layer, Record, type Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { resolve4 } from "node:dns/promises";
import { Jev, Questions } from "../src/index.ts";

const site = "https://effect.website";
const report = "Since this morning the site feels slow for people in Europe, "
  + "and two of them were shown a page that was days out of date.";

const fetchPage = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient;
  const [elapsed, response] = yield* client.get(site).pipe(
    Effect.tap((response) => response.text),
    Effect.timed,
  );
  const header = (name: string) => response.headers[name] ?? null;
  return {
    status: response.status,
    milliseconds: Math.round(Duration.toMillis(elapsed)),
    server: header("server"),
    date: header("date"),
    lastModified: header("last-modified"),
    age: header("age"),
    cacheControl: header("cache-control"),
    cacheStatus: header("cf-cache-status") ?? header("x-vercel-cache") ?? header("x-cache"),
  };
}).pipe(Effect.catch((error) => Effect.succeed({ error: error.message })));

const probes = [
  {
    name: "dns",
    purpose: "Resolve the hostname and list the IPv4 addresses it points to",
    run: Effect.tryPromise(() => resolve4(new URL(site).hostname)).pipe(
      Effect.map((addresses) => ({ addresses })),
      Effect.catch((error) => Effect.succeed({ error: error.message })),
    ),
  },
  {
    name: "response",
    purpose: "Fetch the page once; record status, timing, server, and caching headers",
    run: fetchPage,
  },
  {
    name: "latency",
    purpose: "Fetch the page three times in a row and record each duration",
    run: Effect.forEach([1, 2, 3], () => fetchPage).pipe(
      Effect.map((responses) => ({
        milliseconds: responses.map((r) => "milliseconds" in r ? r.milliseconds : null),
      })),
    ),
  },
];

const stop = { name: "stop", purpose: "No further probe would change the recommendation" };

const investigate = Effect.gen(function*() {
  let hypotheses: Record<string, { claim: string; action: string; }> = {
    dns: {
      claim: "The hostname resolves slowly or to the wrong addresses",
      action: "Check the DNS records and their TTLs.",
    },
    origin: {
      claim: "The origin server is slow or returning errors",
      action: "Open a ticket with the hosting provider.",
    },
    cdn: {
      claim: "A CDN is serving stale cached content",
      action: "Purge the CDN cache and confirm the freshness headers.",
    },
    client: {
      claim: "The problem is on the reporters' networks, not the site",
      action: "Ask the reporters for browser details and a traceroute.",
    },
  };
  const findings: Array<{ probe: string; observation: Schema.JsonObject; }> = [];
  let remaining = probes;

  while (remaining.length > 0 && Record.size(hypotheses) > 1) {
    const q = Questions.about({ report, hypotheses, findings });
    const probe = yield* q.choose(
      "Which probe would most change what we believe about the cause?",
      [...remaining, stop],
      (candidate) => candidate.purpose,
    );
    if (!("run" in probe)) break;

    const observation = yield* probe.run;
    findings.push({ probe: probe.name, observation });
    remaining = remaining.filter((candidate) => candidate !== probe);
    yield* Console.log(`${probe.name}: ${JSON.stringify(observation)}`);

    const ruledOut = yield* Questions.about({ report, findings }).ask(
      Record.map(hypotheses, ({ claim }) => `Do the findings rule this out? ${claim}`),
    );
    hypotheses = Record.filter(hypotheses, (_, key) => !ruledOut[key]);
    yield* Console.log(`Still plausible: ${Record.keys(hypotheses).join(", ") || "nothing"}`);
  }

  const plausible = Record.values(hypotheses);
  if (plausible.length === 0) {
    return yield* Console.log("Every explanation was ruled out; hand the findings to a person.");
  }
  const cause = plausible.length === 1
    ? plausible[0]!
    : yield* Questions.about({ report, findings })
      .choose(
        "Which remaining explanation fits the findings best?",
        hypotheses,
        ({ claim }) => claim,
        { confidence: 0.4 },
      );
  yield* Console.log(`Recommendation: ${cause.action}`);
}).pipe(
  Effect.catchTag(
    "UncertainDecision",
    () => Console.log("The findings do not single out a cause; hand them to a person."),
  ),
);

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(investigate.pipe(Effect.timeout("2 minutes"), Effect.provide(QuestionsLive)));
