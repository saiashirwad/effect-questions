import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Record, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Jev, Questions } from "../src/index.ts";

const base = "HEAD";

const requirements = {
  documented:
    "Every exported function or constant added or changed under src/ has a JSDoc comment.",
  noTests: "No test files or test framework configuration are added.",
  runnable: "Examples stay plain runnable scripts: no process.argv parsing, no CLI flags.",
  described: "Renamed or removed public exports are reflected in README.md or examples/README.md.",
};

class CheckFailed extends Schema.TaggedError<CheckFailed>()("CheckFailed", {
  script: Schema.String,
  exitCode: Schema.Int,
}) {}

const run = Effect.fn("run")(function*(script: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* Console.log(`$ pnpm ${script}`);
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("pnpm", [script], { stdout: "inherit", stderr: "inherit" }),
  );
  if (exitCode !== 0) return yield* new CheckFailed({ script, exitCode });
});

const review = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const git = (...args: ReadonlyArray<string>) => spawner.string(ChildProcess.make("git", args));
  const changed = yield* git("diff", "--name-only", base);
  const files = changed.split("\n").filter(Boolean);
  if (files.length === 0) return yield* Console.log(`No tracked changes against ${base}.`);
  const patch = yield* git("diff", "--no-ext-diff", "--no-color", base, "--", ".");
  const q = Questions.about({ files, patch });

  const verdicts = yield* q.ask(
    Record.map(requirements, (text) => `Does the change satisfy this requirement? ${text}`),
  );
  for (const [key, met] of Record.toEntries(verdicts)) {
    yield* Console.log(`${met ? "  ok " : "FAIL "} ${requirements[key]}`);
  }

  if (files.length >= 2) {
    const attention = yield* q.rank(
      "Which file most deserves a careful human review?",
      files,
      (f) => f,
    );
    yield* Console.log("Review first:");
    for (const { value, probability } of attention.slice(0, 3)) {
      yield* Console.log(`  ${(probability * 100).toFixed(0).padStart(3)}%  ${value}`);
    }
  }

  yield* q.branch("Which verification fits this change?", {
    "Only prose, comments, or documentation changed; check formatting": () => run("format:check"),
    "Code changed; run every static check and compile": () =>
      run("check").pipe(Effect.andThen(run("build"))),
  });

  const unmet = Record.filter(verdicts, (met) => !met);
  yield* Console.log(
    Record.isEmptyRecord(unmet)
      ? "Verdict: approve"
      : `Verdict: request changes (${Record.keys(unmet).join(", ")})`,
  );
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(review.pipe(
  Effect.timeout("3 minutes"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
