import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Jev, Questions } from "../src/index.ts";

// Changelog since the last release: newest commits first, stop at the release, keep what users care about.

const isRelease = Questions.is("Does this commit message describe a release or version bump?");

const userFacing = Questions.is({
  behavior: "Does this commit change behavior a user would notice?",
  cosmetic: "Is this only wording, formatting, or documentation?",
  fix: "Does this fix a bug?",
}, (it) => (it.behavior && !it.cosmetic) || it.fix);

const changelog = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const log = yield* spawner.string(ChildProcess.make("git", ["log", "--oneline", "-30"]));

  yield* Stream.fromIterable(log.split("\n")).pipe(
    Stream.filter((line) => line !== ""),
    Stream.takeUntilEffect(isRelease, { excludeLast: true }),
    Stream.filterEffect(userFacing),
    Stream.runForEach(Console.log),
  );
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(changelog.pipe(
  Effect.timeout("1 minute"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
