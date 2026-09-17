import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Question, Questions } from "../src/index.ts";

type Message = { readonly from: "customer" | "agent"; readonly text: string; };

const transcript: ReadonlyArray<Message> = [
  { from: "customer", text: "Hi, I was charged twice for my subscription this month." },
  { from: "agent", text: "Sorry about that. Could you share the invoice numbers?" },
  { from: "customer", text: "INV-2041 and INV-2042, both on the 3rd, same amount." },
  { from: "agent", text: "I see both. INV-2042 looks like a retry that should not have settled." },
  {
    from: "customer",
    text: "So when do I get my money back? This is the second month in a row. "
      + "If this is not fixed today I am cancelling and disputing the charge.",
  },
  {
    from: "agent",
    text: "I have refunded INV-2042; it lands in 3-5 business days. The retry bug is flagged.",
  },
  { from: "customer", text: "Okay, I can see the refund pending now. Thanks for sorting it." },
  { from: "agent", text: "Glad to help. Anything else?" },
  { from: "customer", text: "No, that is all." },
];

const assess = (log: ReadonlyArray<Message>) =>
  Questions.about({ transcript: log }).ask({
    stage: Question.choice(
      "After the latest customer message, where does the conversation stand?",
      {
        open: "The problem is still being worked out",
        escalated: "The customer threatens to leave or dispute, or asks for a manager",
        resolved: "The customer confirms the problem is solved and needs nothing more",
      },
    ),
    temperature: Question.score("How is the customer feeling right now?", [
      "Calm",
      "Frustrated",
      "Very angry",
    ]),
  });

type Stage = Effect.Success<ReturnType<typeof assess>>["stage"];

/** Escalation sticks until the conversation resolves; the model never un-escalates. */
const advance = (current: Stage, observed: Stage): Stage =>
  current === "escalated" && observed === "open" ? "escalated" : observed;

const timeline = Stream.fromIterable(transcript).pipe(
  Stream.scan([] as ReadonlyArray<Message>, (log, message) => [...log, message]),
  Stream.filter((log) => log.at(-1)?.from === "customer"),
  Stream.mapAccumEffect(
    () => "open" as Stage,
    (stage, log) =>
      assess(log).pipe(Effect.map((answers) => {
        const next = advance(stage, answers.stage);
        return [next, [{ turn: log.length, from: stage, to: next, ...answers }]] as const;
      })),
  ),
  Stream.takeUntil((step) => step.to === "resolved"),
);

const workflow = Stream.runForEach(timeline, (step) =>
  Effect.gen(function*() {
    yield* Console.log(`turn ${step.turn}  ${step.to}  temperature ${step.temperature.toFixed(1)}`);
    if (step.from === step.to) return;
    if (step.to === "escalated") yield* Console.log("  -> paging a senior agent");
    if (step.to === "resolved") {
      yield* Console.log("  -> closing the ticket and sending the survey");
    }
  }));

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(Effect.timeout("1 minute"), Effect.provide(QuestionsLive)));
