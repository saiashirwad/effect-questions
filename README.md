# effect-questions

Type-safe AI judgments and probabilistic control flow for Effect.

Bind context with `Questions.about(state)`. Ask with `yield* q.is(question)`, batch with
`q.ask`, or run lazy Effect handlers with `q.branch`. Use ordinary `if` statements and
generators; retain detailed evidence when you need confidence or expected-loss policies.

- **Questions** — bind context, ask questions, and branch into ordinary Effects.
- **Question** — define typed batches when you need explicit schemas.
- **Answer** — rank outcomes, aggregate probabilities, and calculate expected values.
- **Decision** — inspect expected losses, choose actions, and dispatch effects exhaustively.
- **QuestionModel** — evaluate batches and select original application objects through replaceable providers.

[Jev](https://typesafe.ai) is the first provider. Built on Effect v4 and TypeScript 7.

## Run

Requires Node 24 and pnpm. The live example reads `TYPESAFE_API_KEY` from your environment.

```sh
pnpm install
node examples/evidence.ts
node examples/flow.ts
```

[Runnable workflows](examples/README.md): Git-diff check selection, source-based documentation audits,
live GitHub issue triage, support diagnostics, and offline decisions.

Development: `pnpm check` · `pnpm build`.
