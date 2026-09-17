import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Question, Questions } from "../src/index.ts";

const ticket = {
  from: "ops lead",
  message: "Production deployments fail with HTTP 403 after we rotated the deploy token. "
    + "The dashboard works, but every release is blocked and we have no workaround.",
};

const workflow = Effect.gen(function*() {
  const q = Questions.about(ticket);

  const triage = yield* q.ask({
    blocked: "Is the customer's production work blocked?",
    mood: Question.score("How is the customer feeling?", ["Calm", "Frustrated", "Very angry"]),
  });
  if (triage.blocked) yield* Console.log("Priority: high");
  if (triage.mood > 1.5) yield* Console.log("Open the reply with an apology.");

  const queue = yield* q.branch("What kind of help is needed?", {
    "Invoices, payments, or refunds": () => Effect.succeed("billing"),
    "Bugs, outages, or deployment failures": () => Effect.succeed("engineering"),
    "Account access or membership": () => Effect.succeed("account support"),
  }, { confidence: 0.6 });
  yield* Console.log(`Routed to ${queue}.`);
}).pipe(
  Effect.catchTag(
    "UncertainDecision",
    ({ question }) => Console.log(`A person should answer: ${question}`),
  ),
);

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(Effect.timeout("15 seconds"), Effect.provide(QuestionsLive)));
