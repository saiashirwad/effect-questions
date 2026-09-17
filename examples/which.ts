import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, FileSystem, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

// Which Effect module do I need? Ranked over the installed type definitions, in one request.

const need = "limit how many requests run at the same time, and queue the rest";
const directory = "node_modules/effect/dist";

const summary = (source: string) =>
  (source.match(/\/\*\*([\s\S]*?)(?:\n\s*\*\s*(?:\n|@)|\*\/)/)?.[1] ?? "")
    .replace(/^\s*\*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

const modules = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const files = yield* fs.readDirectory(directory);
  const names = files.filter((f) => f.endsWith(".d.ts") && f !== "index.d.ts");
  return yield* Effect.forEach(names, (file) =>
    fs.readFileString(`${directory}/${file}`).pipe(
      Effect.map((source) => ({ name: file.slice(0, -".d.ts".length), summary: summary(source) })),
    ));
});

const program = Effect.gen(function*() {
  const candidates = yield* modules;
  const ranked = yield* Questions.about(need).rank(
    "Which module is the right tool for this need?",
    candidates,
    ({ name, summary }) => ({ name, summary }),
  );
  yield* Console.log(`${candidates.length} modules considered.\n`);
  for (const { value, probability } of ranked.slice(0, 3)) {
    yield* Console.log(`${(probability * 100).toFixed(0).padStart(3)}%  ${value.name}`);
    yield* Console.log(`      ${value.summary}\n`);
  }
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(program.pipe(
  Effect.timeout("1 minute"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
