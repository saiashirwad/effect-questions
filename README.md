# effect-questions

Type-safe AI judgments and probabilistic control flow for Effect.

Ask schema-backed choice, score, and boolean questions. Keep the full probability distributions,
then use ordinary Effects to decide what happens next. Batch independent judgments; compose dependent
steps with `yield*`. The model supplies evidence; your code chooses thresholds, costs, and actions.

- **Question** — define judgments and their answer schemas.
- **Answer** — rank outcomes, aggregate probabilities, and calculate expected values.
- **Decision** — require confidence, minimize expected loss, and dispatch effects exhaustively.
- **QuestionModel** — evaluate batches and select original application objects through replaceable providers.

[Jev](https://typesafe.ai) is the first provider. Built on Effect v4 and TypeScript 7.

## Run

Requires Node 24 and pnpm. The live example reads `TYPESAFE_API_KEY` from your environment.

```sh
pnpm install
node examples/evidence.ts
node examples/main.ts
```

[Evidence](examples/evidence.ts) demonstrates offline decisions.
[Triage](examples/triage.ts) selects a diagnostic, executes its Effect, and verifies the finding with AI.

Development: `pnpm check` · `pnpm build`.
