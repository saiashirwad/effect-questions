import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const ticket = "Production deployments fail with HTTP 403 after rotating the deploy token. "
  + "The dashboard works, but every release is blocked.";

const diagnostics = {
  credentials: {
    summary: "Compare token permissions before and after rotation",
    inspect: Effect.succeed(
      "The saved token configuration changed from deploy:write to deploy:read.",
    ),
  },
  status: {
    summary: "Check for active service incidents",
    inspect: Effect.succeed("The saved service-status snapshot shows no active incidents."),
  },
};

const investigate = Effect.fn("investigate")(function*() {
  const diagnostic = yield* Questions.about(ticket).choose(
    "Which diagnostic should run first?",
    diagnostics,
    (candidate) => candidate.summary,
  );
  const observation = yield* diagnostic.inspect;

  return yield* Questions.about({ ticket, observation }).branch(
    "What does this evidence justify?",
    {
      "The rotated token's permissions explain the deployment failure": () =>
        Effect.succeed("Recommend restoring deploy:write, then retrying the release."),
      "The observation does not explain the failure": () =>
        Effect.succeed("Gather another diagnostic before recommending a change."),
    },
  );
});

const workflow = Effect.gen(function*() {
  const q = Questions.about(ticket);

  if (yield* q.is("Is production work blocked?")) {
    yield* Console.log("Prioritize this issue.");
  }

  const outcome = yield* q.branch("What kind of help is needed?", {
    "Invoices, payments, or refunds": () => Effect.succeed("Route to billing."),
    "Bugs, outages, or deployment failures": () => investigate(),
    "Account access or membership": () => Effect.succeed("Route to account support."),
  });

  yield* Console.log(outcome);
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(Effect.timeout("15 seconds"), Effect.provide(QuestionsLive)));
