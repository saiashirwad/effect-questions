# effect-questions

Semantic judgment as an ordinary Effect: schema-backed questions, probabilistic answers, and explicit
decisions. Independent questions share an evaluation; dependent decisions compose with `yield*`.

Built with Effect v4, TypeScript 7, pnpm, oxlint, and dprint. Jev is the first provider.

## Run

```sh
pnpm install
node examples/evidence.ts
node examples/main.ts
```

`evidence.ts` runs offline with a declared example distribution. `main.ts` uses `TYPESAFE_API_KEY`
from your environment. Both run directly on Node 24. Edit their constants to explore different inputs.

```sh
pnpm check
pnpm build
```

The build emits JavaScript and declarations under `dist`. Package exports include the root barrel,
each core module, and `effect-questions/providers/Jev`. Effect is a peer dependency; the Node runtime
is only needed by the examples.

## Four concepts

| Module          | Responsibility                                    |
| --------------- | ------------------------------------------------- |
| `Question`      | Describe a judgment and its answer schema         |
| `Answer`        | Inspect and aggregate the resulting evidence      |
| `Decision`      | Apply explicit policies and select effects        |
| `QuestionModel` | Evaluate questions through a replaceable provider |

The model returns evidence. The application determines what that evidence justifies.

## Ask independent questions together

```ts
import { Effect, Schema } from "effect";
import { Question, QuestionModel } from "effect-questions";

const Department = Schema.Literals(["billing", "technical"]);

const program = Effect.gen(function*() {
  const { answers, usage } = yield* QuestionModel.evaluate(
    "Our deploy API token stopped working after rotation.",
    {
      department: Question.choice(Department, {
        instructions: "Which team owns this issue?",
        criteria: { billing: "Invoices and charges", technical: "API and integration problems" },
      }),
      blocked: Question.boolean("Is production work blocked?"),
      impact: Question.score({
        instructions: "How disruptive is the problem?",
        criteria: ["Work continues", "Some work is impaired", "Production is blocked"],
      }),
    },
  );

  return { department: answers.department.choice, blocked: answers.blocked.probability, usage };
});
```

The batch has one shared state. With Jev, it becomes one HTTP call. Questions are evaluated separately;
their answers are not assumed to be statistically independent. A later evaluation belongs after a
`yield*` when it depends on information the first evaluation helped obtain.

### The answer shapes

- **Choice:** `choice`, a complete `probabilities` map keyed by the supplied literals, and `confidence`.
- **Score:** `score`, `probabilities`, `legend`, and `confidence`. The score is a weighted zero-based
  level index. Three levels give a score from **0 to 2**.
- **Boolean:** `probability`, meaning P(true). There is no separate confidence field.

All carry a `type` discriminator. Every evaluation includes `model` and
`usage: { inputTokens, outputTokens }`. The schemas are also available as `Answer.Choice`,
`Answer.Score`, `Answer.Boolean`, and `QuestionModel.Evaluation(questions)`.

## Configure a provider once

```ts
import { Config, Layer } from "effect";
import { Jev } from "effect-questions";
import { FetchHttpClient } from "effect/unstable/http";

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));
```

Provide `QuestionsLive` to your application with `Effect.provide`. Workflows require
`QuestionModel.QuestionModel`, not Jev. Another provider can implement the same service using
`Layer.succeed` or `Layer.effect`.

This follows Effect AI's provider convention: the application supplies the HTTP implementation.
`Jev.layer` accepts resolved options; `Jev.layerConfig` also accepts Effect `Config`s; `Jev.make`
constructs the service inside an Effect. Optional `model` and `apiUrl` default to `jev-latest` and
`https://api.typesafe.ai/v1`.

Jev's adapter owns its `noul` wire format, snake-case token counts, and 255-option limit. Core questions
require at least two choice options or score levels, without imposing that provider-specific maximum.

## Work with the full distribution

```ts
import { Answer } from "effect-questions";

const evidence = {
  probabilities: { invoice: 0.36, refund: 0.34, integration: 0.3 },
};

const departments = Answer.coarsen(
  evidence,
  (intent) => intent === "integration" ? "technical" : "billing",
);

const billing = Answer.probabilityOf(departments, (department) => department === "billing");
const alternatives = Answer.topK(evidence, 2);
const separation = Answer.margin(departments);
```

The strongest original outcome has probability 0.36, but the billing category has probability 0.70.
Coarsening sums mass into the observed categories. Its result deliberately contains neither a chosen
label nor a confidence score: those would require a new decision or a defined confidence statistic.

| Utility                              | Result                                     |
| ------------------------------------ | ------------------------------------------ |
| `probabilityOf(evidence, predicate)` | Probability mass of an event               |
| `rank(evidence)`                     | Outcomes ordered by descending probability |
| `topK(evidence, count)`              | First `count` ranked outcomes              |
| `margin(evidence)`                   | Highest probability minus second-highest   |
| `coarsen(evidence, group)`           | A distribution over broader categories     |
| `expectedValue(evidence, value)`     | Probability-weighted value of an outcome   |
| `fromBoolean(answer)`                | A distribution over `"true"` and `"false"` |

The two-argument Answer utilities also support data-last usage with Effect's `pipe`. They are pure:
they do not call a model, normalize your data, or mutate an answer. Missing categories have no mass;
empty distributions have margin zero. Ranking preserves input enumeration order for ties.
`topK` uses Effect Array's `take` semantics.

## Decide using consequences

```ts
import { Decision } from "effect-questions";

const decision = yield* Decision.minimizeLoss(departments, {
  billing: (department) => department === "billing" ? 0 : 2,
  technical: (department) => department === "technical" ? 0 : 3,
  clarify: () => 1,
});
```

Each callback is the cost of an action under a possible outcome. The result includes `action`,
`expectedLoss`, and every evaluated alternative. Here billing costs 0.6 in expectation, technical
costs 2.1, and clarification costs 1, so billing wins. No confidence threshold is needed.

The input probabilities should represent a distribution. Callbacks are ordinary pure functions in
the same cost units; negative values can represent rewards. An empty action set or non-finite
computed loss fails with `SchemaError`. Ties favor the first action in record enumeration order.

### Require confidence when that is the policy

```ts
const accepted = yield * Decision.requireConfidence(answer, 0.8);
```

This preserves the exact answer, including any attached candidate value. It fails with
`UncertainDecision` below the threshold, and `SchemaError` for an invalid threshold or confidence.
It also supports `Decision.requireConfidence(0.8)` in an Effect pipeline.

Low confidence is successful model inference. This helper makes it an optional, recoverable policy
failure; `QuestionModel.evaluate` itself never imposes a confidence threshold.

### Dispatch lazily and exhaustively

```ts
yield * Decision.match(accepted, {
  billing: (evidence) => handleBilling(evidence),
  technical: (evidence) => investigate(evidence),
});
```

Handlers cover every possible choice and receive the evidence with their choice narrowed. Only the
selected handler runs, and only when the returned Effect executes. Its type carries the union of
handler results, errors, and service requirements. Apply a confidence policy before dispatch when
appropriate, and recover using `Effect.catchTag` at the boundary that owns the fallback.

## Select actual application values

```ts
const selected = yield * QuestionModel.choose({
  state: ticket,
  instructions: "Which diagnostic should run first?",
  candidates: diagnostics,
  describe: (diagnostic) => diagnostic.summary,
});

const accepted = yield * Decision.requireConfidence(selected, 0.7);
const observation = yield * accepted.value.inspect;
```

Candidates are a record keyed by stable IDs. `choose` sends the IDs and their descriptions, then
resolves the chosen ID to the original object. The result retains `choice`, `probabilities`,
`confidence`, `model`, and `usage`, and adds `value`.

Objects can contain Effects or other non-JSON values. Only what you explicitly supply as `state`
or return from `describe` reaches the provider. There must be at least two candidates; Jev supports
at most 255. Selection chooses the best supplied candidate, so include an explicit alternative
when “none of these” is a meaningful result.

## A complete dependent workflow

`examples/main.ts` runs the workflow in `examples/triage.ts`:

1. Batch department, impact, and diagnostic relevance.
2. Dispatch into exactly one department's Effect.
3. Load the currently available diagnostics only on the relevant technical path.
4. Select a diagnostic object, then execute its local `inspect` Effect.
5. Evaluate whether that newly obtained observation explains the symptom and supports the next step.
6. Combine expected-loss selection and an explicit usefulness probability to recommend a next step
   or continue investigating.

The example diagnostics use saved, illustrative observations. The Jev evaluations are live. The
workflow neither changes token permissions nor retries a real deployment.

This also gives the composition point for Effect AI: a branch can generate a proposal using
`LanguageModel`, then evaluate narrow questions about it using `QuestionModel`. Both services fit
the same Effect environment; no additional agent runtime is involved.

## Errors and transport

Provider failures use one `QuestionError`, retaining `provider` and the original `cause`. Schema
errors keep validation details; HTTP errors retain response status. Question and response boundaries
use Effect Schema, including choice membership, required probability entries, ranges, and score
bounds. Finite schema outputs constrain possible answers; semantic correctness still depends on
the evidence and model.

TypeSafe [recommends exponential backoff for 429 and 529](https://docs.typesafe.ai/api#handling-rate-limits).
The Jev adapter retries those statuses twice, starting at 200ms. Those counts and delays are library
defaults, not numbers prescribed by TypeSafe. Other failures propagate. Workflow timeouts belong to
the application; the live example uses 15 seconds.
