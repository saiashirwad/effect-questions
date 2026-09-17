# effect-questions

Semantic judgments as ordinary Effect control flow.

Bind context with `Questions.about(state)`, then write the program you would have written
anyway: `if (yield* q.is(...))`, `switch` on a typed choice from `q.ask`, pick an application
object with `q.choose`, or run only the matching handler with `q.branch`. Uncertainty is an
ordinary error when you ask for a minimum confidence; evidence is available when you want it.

```ts
const q = Questions.about(ticket);

if (yield * q.is("Is production work blocked?")) {
  yield * prioritize(ticket);
}

return yield * q.branch("What kind of help is needed?", {
  "Invoices, payments, or refunds": () => handleBilling(ticket),
  "Bugs, outages, or deployment failures": () => investigate(ticket),
  "Account access or membership": () => handleAccount(ticket),
}, { confidence: 0.6 });
```

- **Questions** — `about(state)` with `is`, `ask`, `score`, `probability`, `choose`, `rank`, `branch`, `evidence`.
- **Question** — `choice`, `score`, `boolean` definitions for typed batches; option keys are the answers.
- **Answer** — rank outcomes, aggregate probabilities, and compute expected values.
- **Decision** — confidence gates, expected losses, and exhaustive dispatch over evidence.
- **QuestionModel** — the provider service; [Jev](https://typesafe.ai) is the first provider.

Built on Effect v4 and TypeScript 7.

## Run

Requires Node 24 and pnpm. Live examples read `TYPESAFE_API_KEY` from your environment.

```sh
pnpm install
node examples/triage.ts
node examples/investigation.ts
```

[Runnable workflows](examples/README.md): ticket triage, a real-network investigation loop,
a streamed conversation state machine, acceptance review of a Git diff, GitHub issue triage,
documentation audits, and offline decisions.

Development: `pnpm check` · `pnpm build`.
