import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Jev, Questions } from "../src/index.ts";

const base = "HEAD~1";

class CheckFailed extends Schema.TaggedError<CheckFailed>()("CheckFailed", {
  script: Schema.String,
  exitCode: Schema.Int,
}) {}

const runCheck = Effect.fn("runCheck")(function*(script: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* Console.log(`Running pnpm ${script}`);

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("pnpm", [script], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  );

  if (exitCode !== 0) {
    return yield* new CheckFailed({ script, exitCode });
  }
});

const workflow = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const patch = yield* spawner.string(
    ChildProcess.make("git", ["diff", "--no-ext-diff", "--no-color", base, "--", "."]),
  );
  if (patch.trim() === "") return yield* Console.log("No tracked changes to check.");

  const q = Questions.about({ patch });
  const changes = yield* q.ask({
    publicApi: "Does this diff change the public API, exports, or inferred types?",
    provider: "Does this diff change HTTP behavior, request encoding, or response decoding?",
  });

  if (changes.publicApi) yield* Console.log("Review downstream API compatibility.");
  if (changes.provider) yield* Console.log("Review provider integration behavior.");

  yield* q.branch("Which verification workload fits the changes in this diff?", {
    "Only prose or comments changed; formatting is sufficient": () => runCheck("format:check"),
    "Source, examples, tooling, or dependencies changed; run all static checks and compile": () =>
      Effect.gen(function*() {
        yield* runCheck("check");
        yield* runCheck("build");
      }),
  });
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(
  Effect.timeout("2 minutes"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
