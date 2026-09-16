import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, FileSystem, Layer, Record } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const contracts: ReadonlyArray<
  { readonly file: string; readonly claims: Record.ReadonlyRecord<string, string>; }
> = [
  {
    file: "src/Questions.ts",
    claims: {
      lazy: "Branch handlers are called only when their returned Effect executes.",
      threshold: "Boolean predictions use an inclusive probability threshold of 0.5.",
      batching: "ask sends its entire question batch through one model evaluation.",
    },
  },
  {
    file: "src/providers/Jev.ts",
    claims: {
      retries:
        "The provider retries HTTP 429 and 529 twice with exponential backoff starting at 200ms.",
      failures: "Provider failures preserve their original cause in QuestionError.",
      boolean:
        "Boolean questions are sent as noul and their answers are normalized back to boolean.",
    },
  },
];

const workflow = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const dispatch = yield* fs.readFileString("src/Decision.ts");
  const results = yield* Effect.forEach(
    contracts,
    Effect.fnUntraced(function*(contract) {
      const source = yield* fs.readFileString(contract.file);
      const q = Questions.about({ source, dispatch, file: contract.file });
      const findings = yield* q.ask(
        Record.map(
          contract.claims,
          (claim) =>
            `Does the executable code support this claim? Ignore comments as evidence. Claim: ${claim}`,
        ),
      );
      return { file: contract.file, findings };
    }),
    { concurrency: 2 },
  );

  for (const { file, findings } of results) {
    yield* Console.log(file);
    for (const [claim, supported] of Object.entries(findings)) {
      yield* Console.log(`  ${supported ? "SUPPORTED" : "REVIEW"}: ${claim}`);
    }
  }
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(
  Effect.timeout("1 minute"),
  Effect.provide(QuestionsLive),
  Effect.provide(NodeServices.layer),
));
