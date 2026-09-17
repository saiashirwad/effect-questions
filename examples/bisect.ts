import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Jev, Questions } from "../src/index.ts";

const file = "src/Questions.ts";
const behavior = Questions.is("Does `about` accept an Effect as its state argument?");

const bisect = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const git = (...args: ReadonlyArray<string>) => spawner.string(ChildProcess.make("git", args));

  const history = yield* git("log", "--reverse", "--format=%h %s");
  const commits = history.split("\n").filter((line) => line !== "");

  const has = (commit: string) =>
    git("show", `${commit.slice(0, 7)}:${file}`).pipe(
      Effect.flatMap(behavior),
      Effect.catchTag("PlatformError", () => Effect.succeed(false)),
      Effect.tap((yes) => Console.log(`${yes ? "yes" : " no"}  ${commit}`)),
    );

  let low = 0;
  let high = commits.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (yield* has(commits[middle]!)) high = middle;
    else low = middle + 1;
  }
  yield* Console.log(`First commit with the behavior: ${commits[low]}`);
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(bisect.pipe(
  Effect.timeout("2 minutes"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
