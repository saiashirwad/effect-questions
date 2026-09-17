# effect-questions

Semantic judgment as an Effect primitive.

```ts
const triage = Effect.gen(function*() {
  const q = Questions.about(ticket);

  if (yield* q.is("Is production work blocked?")) {
    yield* prioritize(ticket);
  }

  return yield* q.branch("What kind of help is needed?", {
    "Invoices, payments, or refunds": () => handleBilling(ticket),
    "Bugs, outages, or deployment failures": () => investigate(ticket),
    "Account access or membership": () => handleAccount(ticket),
  }, { confidence: 0.6 });
});
```

Only the chosen handler runs. Its result, errors, and services flow through the returned Effect.
If the model is not confident enough, the Effect fails with `UncertainDecision`. Catch it where
the fallback belongs.

## Operations

`Questions.about(state)` gives you:

- `is`: a yes/no answer.
- `ask`: several questions in one request. Strings are yes/no. `Question.choice` and
  `Question.score` add options and rubrics.
- `choose`: pick one of your own objects. You get the object back.
- `rank`: every candidate, best first, with its probability.
- `branch`: pick a handler by its description and run only that one.
- `probability`, `score`, `evidence`: the numbers behind an answer.

Two more shapes. `Questions.is(question)` is a predicate over context. `Questions.each(items)`
binds a whole collection and answers for every item in one request. To combine answers, ask a
batch and use `&&`, `||`, and `!` in an `Effect.map`.

```ts
const transient = Questions.is("Does this error describe a temporary failure?");

const actionable = (issue: string) =>
  Questions.about(issue).ask({
    bug: "Is this a bug report?",
    reproducible: "Does it include steps to reproduce?",
    security: "Does it describe a security issue?",
  }).pipe(Effect.map(({ bug, reproducible, security }) => (bug && reproducible) || security));

const program = Effect.gen(function*() {
  const report = yield* fetchReport.pipe(Effect.retry({ while: transient, times: 3 }));
  const worthReading = yield* Effect.filter(issues, actionable, { concurrency: 4 });

  const urgency = yield* Questions.each(titles).score("How urgent is this?", [
    "Low",
    "Medium",
    "High",
  ]);
});
```

## Live context

The context can be an Effect. It is read every time a question runs.

```ts
const program = Effect.gen(function*() {
  const facts = yield* Ref.make({ report, findings: [] });
  const settled = Questions.about(Ref.get(facts)).is("Do the findings establish the cause?");

  yield* probeOnce.pipe(Effect.repeat({ until: () => settled, times: 3 }));
});
```

`settled` is one value. Each time it runs, it reads the current facts and asks again. That is a
do-while loop with a model in the condition, and nothing new to learn.

When the next step is a choice, offer "stop" as one of the candidates. One request then answers
both "what next" and "are we done".

## Modules

- `Questions`: the API above.
- `Question`: `choice`, `score`, and `boolean` definitions. Option keys are the answers.
- `Answer`: rank, aggregate, and take expected values over probabilities.
- `Decision`: confidence gates, expected loss, and dispatch over evidence.
- `QuestionModel`: the provider service, plus token metrics and a span per evaluation.
  [Jev](https://typesafe.ai) is the first provider.

Built on Effect v4 and TypeScript 7.

## Run

Needs Node 24 and pnpm. Live examples read `TYPESAFE_API_KEY`.

```sh
pnpm install
node examples/triage.ts
node examples/investigation.ts
```

All examples are described in [examples/README.md](examples/README.md).

Development: `pnpm check` and `pnpm build`.
