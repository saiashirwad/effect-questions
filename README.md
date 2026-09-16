# effect-jev

Schema-backed Jev decisions composed with Effect v4.

## Run

With `TYPESAFE_API_KEY` in your environment:

```sh
pnpm install
node examples/main.ts
```

`pnpm example` runs the same file. Edit the sample message in `examples/main.ts` to try other inputs.
Node 24 runs the TypeScript directly; TypeScript 7 handles type checking and compilation.

The project uses Effect `4.0.0-rc.115`, the current v4 release candidate, pnpm, oxlint, and dprint.
The library defaults to `jev-latest`; pass `model` to `Jev.layer` to select another model.

## The design

**Independent judgments compose as a batch; dependent decisions compose with `yield*`.**

Jev evaluates a map of atomic questions against shared state. `Jev.ask` maps that directly to one
HTTP request. Each question carries its Effect Schema, so the answer type and runtime decoder follow
from the question. Choice options come from `Schema.Literals`; the criteria must describe every option.

```ts
import { Effect, Schema } from "effect";
import { Jev, Question } from "./src/index.ts";

const Department = Schema.Literals(["billing", "technical"]);

const program = Effect.gen(function*() {
  const jev = yield* Jev;
  const { answers } = yield* jev.ask("The API stopped accepting our deploy token", {
    department: Question.choice(Department, {
      instructions: "Which team owns this issue?",
      criteria: { billing: "Invoices and charges", technical: "API and integration problems" },
    }),
    urgent: Question.noul("Is production work blocked?"),
  });

  return answers;
});
```

Wire configuration and the HTTP implementation at the application boundary:

```ts
import { Config, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev } from "./src/index.ts";

const JevLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));
```

`Jev.layer` takes an explicit redacted API key, optional model, and optional `apiUrl` (default
`https://api.typesafe.ai/v1`). It requires an Effect `HttpClient`. `Jev.make` exposes the same
construction as an Effect. `Jev.layerConfig` accepts the same options as values or Effect `Config`s.
This follows Effect AI's provider convention: supply the HTTP transport once when composing your
application layer, then use the resulting service throughout the application. Environment variables,
the concrete HTTP implementation, and workflow timeouts belong to the application.

### Keep the evidence

- **Choice** returns a literal-typed `choice`, the full `probabilities` map, and `confidence`.
- **Score** returns a probability-weighted, zero-based level index, its distribution, legend, and
  confidence. Three rubric levels mean a score from **0 to 2**, not 0 to 1.
- **Noul** returns the probability of “yes.” It has no separate confidence field.
- Every evaluation retains the model identifier and token usage.

Confidence summarizes a distribution; it is not interchangeable with an option's probability.
`Decision.requireConfidence` lifts an application-selected threshold into a typed
`UncertainDecision` error while preserving the full answer on success. Recover using
`Effect.catchTag`, or branch directly on the probabilities. The example thresholds are illustrative
and should be tuned against representative data.

### The example's control flow

`examples/triage.ts` demonstrates:

1. One request evaluates department, impact, and whether diagnostics would help.
2. Low department confidence recovers into a `Clarify` result.
3. Billing and account tickets finish with a `Routed` result.
4. A technical ticket needing investigation loads local runbooks, then sends that newly available
   state to a second Jev call.
5. Jev selects a schema-constrained runbook. Code looks up its exact next step and returns `Diagnosed`.

Only the selected branch executes. Jev supplies judgments; Effect sequences the work, carries typed
errors, and provides cancellation, tracing, and dependency injection. The runbooks are local example
data; the workflow returns a recommendation.

This is also the composition point for Effect AI: a branch could yield
`LanguageModel.generateText`, then pass its output to Jev for narrow checks. Both services would live
in the same Effect environment. This project implements the Jev side.

## Boundaries

Requests and answers are validated using Effect Schema. The service checks required answers, choice
membership, required distribution entries, probability ranges, and score bounds. Answer types are
derived from those schemas.

The Jev client exposes one error, `JevError`, with the original failure retained in `cause`. Schema errors
keep their validation details; HTTP errors keep the response and status. Use `Effect.catchTag` for
service-level recovery, and Effect's existing error guards when you need to inspect the cause.
`Decision.UncertainDecision` is the confidence combinator's typed failure. The application chooses
the threshold and fallback; `Jev.ask` returns the full evidence without applying a confidence gate.

TypeSafe's [API documentation](https://docs.typesafe.ai/api#handling-rate-limits) recommends
exponential backoff for `429` and `529`. The client retries these statuses twice, starting at 200ms;
the retry count and initial delay are library defaults, not values prescribed by the docs. Other
failures propagate directly. The example applies a 15-second timeout to its complete workflow.

## Files

| File                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `src/Question.ts`    | Schema-backed choice, score, and noul constructors |
| `src/Jev.ts`         | Effect service, protocol adapter, error boundary   |
| `src/Decision.ts`    | Reusable confidence combinator and typed failure   |
| `examples/main.ts`   | Directly runnable example                          |
| `examples/triage.ts` | Dependent, AI-driven workflow                      |

```sh
pnpm check
pnpm build
```

API contract: [TypeSafe HTTP reference](https://docs.typesafe.ai/api).
