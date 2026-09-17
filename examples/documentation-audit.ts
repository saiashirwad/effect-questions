import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, FileSystem, Layer, Record } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const file = "src/providers/Jev.ts";

const claims = {
  retries: "HTTP 429 and 529 are retried twice with exponential backoff starting at 200ms.",
  failures: "Provider failures keep their original cause inside QuestionError.",
  boolean: "Yes/no questions are sent as noul and answers are normalized back to boolean.",
};

const audit = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(file);

  const supported = yield* Questions.about({ file, source }).ask(
    Record.map(claims, (claim) => `Does the code support this claim? Ignore comments. ${claim}`),
  );

  for (const [key, ok] of Record.toEntries(supported)) {
    yield* Console.log(`${ok ? "  ok " : "FAIL "} ${claims[key]}`);
  }
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(audit.pipe(
  Effect.timeout("1 minute"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
