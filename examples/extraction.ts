import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Questions } from "../src/index.ts";

const email = `
Hi, following up on invoice INV-2041 from 3 September 2026.
The original amount was $1,240.00. After the $90.00 credit, the balance is $1,150.00.
Please pay by 30 September 2026 to avoid a $25.00 late fee. Our office moved on 12 August 2026.
`;

const program = Effect.gen(function*() {
  const q = Questions.about(email);
  const amounts = email.match(/\$[\d,]+\.\d\d/g) ?? [];
  const dates = email.match(/\d{1,2} \w+ \d{4}/g) ?? [];

  const total = yield* q.choose("Which amount is the balance to pay now?", amounts, (a) => a);
  const due = yield* q.choose("Which date is the payment deadline?", dates, (d) => d);

  yield* Console.log({ total, due });
});

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(program.pipe(Effect.timeout("15 seconds"), Effect.provide(QuestionsLive)));
