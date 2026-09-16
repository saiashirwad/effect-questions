import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Schema } from "effect";
import { Answer, Decision } from "../src/index.ts";

const Intent = Schema.Literals(["billing-question", "refund-request", "technical-problem"]);

const main = Effect.gen(function*() {
  const answer = yield* Schema.decodeUnknownEffect(Answer.Choice(Intent))({
    type: "choice",
    choice: "billing-question",
    probabilities: { "billing-question": 0.36, "refund-request": 0.34, "technical-problem": 0.3 },
    confidence: 0.12,
  });
  const departments = Answer.coarsen(
    answer,
    (intent) => intent === "technical-problem" ? "technical" : "billing",
  );
  const decision = yield* Decision.minimizeLoss(departments, {
    billing: { billing: 0, technical: 2 },
    technical: (department) => department === "technical" ? 0 : 3,
    clarify: 1,
  });

  yield* Console.log({
    original: answer,
    departments,
    billingProbability: Answer.probabilityOf(departments, (department) => department === "billing"),
    alternatives: Answer.topK(answer, 2),
    intentMargin: Answer.margin(answer),
    departmentMargin: Answer.margin(departments),
    decision,
  });

  yield* Decision.match(decision, {
    billing: () =>
      Console.log("Route to billing: lowest expected loss, despite low fine-grained confidence."),
    technical: () => Console.log("Route to technical support."),
    clarify: () => Console.log("Ask which part of the request matters most."),
  });
});

NodeRuntime.runMain(main);
