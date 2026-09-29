import { describe, expect, it } from "vitest";
import { gradeQuiz, parseQuizCallout, quizId, shuffleWithSeed, type QuizResponse } from "./quizBlock";

const empty: QuizResponse = { picked: [], order: [], pairs: {}, text: "" };

describe("parseQuizCallout", () => {
  it("reads a choose-one callout, including feedback and the explanation", () => {
    const spec = parseQuizCallout(`> [!quiz single shuffle ^dynamo] What does a default read guarantee?
> - [ ] Strong consistency
>   It does not wait for the leader.
> - [x] Eventual consistency
>
> Default reads can hit any replica.`);

    expect(spec?.error).toBeUndefined();
    expect(spec).toMatchObject({
      kind: "single",
      id: "dynamo",
      shuffle: true,
      prompt: "What does a default read guarantee?",
      explanation: "Default reads can hit any replica.",
    });
    expect(spec?.options.map((o) => [o.id, o.correct, o.feedback])).toEqual([
      ["o1", false, "It does not wait for the leader."],
      ["o2", true, undefined],
    ]);
  });

  it("treats one [x] as single and several as multi", () => {
    const single = parseQuizCallout(`> [!quiz] Pick one
> - [x] A
> - [ ] B`);
    const multi = parseQuizCallout(`> [!quiz] Pick all
> - [x] A
> - [x] B
> - [ ] C`);
    expect(single?.kind).toBe("single");
    expect(multi?.kind).toBe("multi");
    expect(multi?.options.filter((o) => o.correct)).toHaveLength(2);
  });

  it("keeps a blank line between options from swallowing the next choice", () => {
    const spec = parseQuizCallout(`> [!quiz] Q
> - [ ] A
>
> - [x] B
>
> Because B.`);
    expect(spec?.options).toHaveLength(2);
    expect(spec?.explanation).toBe("Because B.");
  });

  it("parses order, match, short, and boolean", () => {
    const order = parseQuizCallout(`> [!quiz order] Put these in order
> - Requirements
> - API
> - Deep dives`);
    const match = parseQuizCallout(`> [!quiz match] Match them
> - REST :: client APIs
> - gRPC :: internal calls`);
    const short = parseQuizCallout(`> [!quiz short] How many boxes is too many?
> 7 | seven
>
> More than about seven is too detailed.`);
    const bool = parseQuizCallout(`> [!quiz boolean] Skip data flow for a normal product API.
> true
>
> Use it for pipelines.`);

    expect(order?.items.map((item) => item.text)).toEqual(["Requirements", "API", "Deep dives"]);
    expect(match?.pairs).toEqual([
      { id: "p1", left: "REST", right: "client APIs", feedback: undefined },
      { id: "p2", left: "gRPC", right: "internal calls", feedback: undefined },
    ]);
    expect(short).toMatchObject({
      prompt: "How many boxes is too many?",
      accept: ["7", "seven"],
      explanation: "More than about seven is too detailed.",
    });
    expect(bool?.options.find((o) => o.correct)?.id).toBe("true");
    expect(bool?.explanation).toBe("Use it for pipelines.");
  });

  it("leaves ordinary quotes alone and reports a broken choose-one quiz", () => {
    expect(parseQuizCallout("> Just a quote\n> - [x] not a quiz")).toBeNull();
    const broken = parseQuizCallout(`> [!quiz single] Q
> - [x] A
> - [x] B`);
    expect(broken?.error).toMatch(/exactly one/);
  });

  it("keeps an explicit id stable and hashes the question otherwise", () => {
    expect(quizId("Hello", "feed-latency")).toBe("feed-latency");
    expect(quizId("Hello")).toBe(quizId("hello"));
    expect(parseQuizCallout("> [!quiz] Same question\n> - [x] A\n> - [ ] B")?.id)
      .toBe(parseQuizCallout("> [!quiz] Same question\n> - [x] A\n> - [ ] B")?.id);
  });
});

describe("gradeQuiz", () => {
  const spec = parseQuizCallout(`> [!quiz multi] Q
> - [x] A
> - [ ] B
> - [x] C`)!;

  it("accepts the full set and rejects a partial one", () => {
    expect(gradeQuiz(spec, { ...empty, picked: ["o1", "o3"] })).toBe(true);
    expect(gradeQuiz(spec, { ...empty, picked: ["o1"] })).toBe(false);
    expect(gradeQuiz(spec, { ...empty, picked: ["o1", "o2", "o3"] })).toBe(false);
  });

  it("grades order, match, and short answers", () => {
    const order = parseQuizCallout("> [!quiz order] Q\n> - A\n> - B")!;
    const match = parseQuizCallout("> [!quiz match] Q\n> - A :: 1\n> - B :: 2")!;
    const short = parseQuizCallout("> [!quiz short] Q\n> 200 ms | 200ms")!;
    expect(gradeQuiz(order, { ...empty, order: ["i1", "i2"] })).toBe(true);
    expect(gradeQuiz(order, { ...empty, order: ["i2", "i1"] })).toBe(false);
    expect(gradeQuiz(match, { ...empty, pairs: { p1: "1", p2: "2" } })).toBe(true);
    expect(gradeQuiz(short, { ...empty, text: "  200ms. " })).toBe(true);
    expect(gradeQuiz(short, { ...empty, text: "fast" })).toBe(false);
  });
});

describe("shuffleWithSeed", () => {
  it("is a stable permutation", () => {
    const once = shuffleWithSeed(["a", "b", "c", "d", "e"], 7);
    const twice = shuffleWithSeed(["a", "b", "c", "d", "e"], 7);
    expect(twice).toEqual(once);
    expect([...once].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});
