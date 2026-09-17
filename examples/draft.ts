import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, FileSystem, Layer, Record, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const file = "README.md";

const reader = {
  purpose: "Does the opening say, in one sentence, what this is for?",
  example: "Is there a code example a reader could paste and adapt?",
  run: "Does it say how to run something?",
  next: "Would a reader know where to look next?",
};

const report = (verdicts: Questions.Values<typeof reader>) =>
  Console.log(
    Record.toEntries(verdicts).map(([need, met]) => `  ${met ? "✓" : "✗"} ${need}`).join("\n"),
  );

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const draft = Questions.about(fs.readFileString(file));
  const review = draft.ask(reader);
  const saves = fs.watch(file).pipe(Stream.debounce("300 millis"));

  yield* Console.log(`Watching ${file}. Save to be read again.`);
  yield* Stream.make("now").pipe(
    Stream.concat(saves),
    Stream.mapEffect(() => review),
    Stream.tap(report),
    Stream.takeUntil((verdicts) => Record.every(verdicts, (met) => met)),
    Stream.runDrain,
  );
  yield* Console.log("Every reader need is met.");
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(
  program.pipe(Effect.provide(QuestionsLive), Effect.provide(NodeServices.layer)),
);
