import type { Meta, StoryObj } from "@storybook/react-vite";
import { KiwiQuiz, KiwiQuizProvider, KiwiQuizScore } from "./KiwiQuiz";
import { MockApiProvider, type MockOverrides } from "./__mocks__/apiMock";
import { parseQuizCallout } from "@kw/lib/quizBlock";

const PAGE = "pages/system-design-quiz.md";

/** Renders `> [!quiz …]` callouts the same way KiwiPage does after remark. */
function QuizCallouts({ markdown }: { markdown: string }) {
  const callouts = markdown.split(/\n\s*\n(?=>\s*\[!quiz)/);
  return (
    <>
      {callouts.map((raw, i) => {
        const spec = parseQuizCallout(raw.trim());
        if (!spec) return null;
        return <KiwiQuiz key={`${spec.id}-${i}`} specAttr={encodeURIComponent(JSON.stringify(spec))} />;
      })}
    </>
  );
}

function QuizPage({
  markdown,
  showScore = false,
  localState,
}: {
  markdown: string;
  showScore?: boolean;
  localState?: MockOverrides["localState"];
}) {
  return (
    <MockApiProvider overrides={{ localState }}>
      <KiwiQuizProvider pagePath={PAGE}>
        <div className="kiwi-prose mx-auto flex max-w-2xl flex-col gap-4 bg-background p-8 text-foreground">
          {showScore ? <KiwiQuizScore /> : null}
          <QuizCallouts markdown={markdown} />
        </div>
      </KiwiQuizProvider>
    </MockApiProvider>
  );
}

const meta: Meta<typeof QuizPage> = {
  title: "Content/KiwiQuiz",
  component: QuizPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Quiz callouts (`> [!quiz kind ^id] Prompt`). Answer keys live in the callout, are stripped from search, and attempts persist to the reader's `.me/quiz.json`. Edit `markdown` to try your own.",
      },
    },
  },
  argTypes: { markdown: { control: "text" } },
};

export default meta;
type Story = StoryObj<typeof QuizPage>;

export const SingleChoice: Story = {
  args: {
    markdown: `> [!quiz single shuffle ^dynamo] What does a default DynamoDB read guarantee?
> - [ ] Strong consistency
>   It does not wait for the leader, so a recent write can be missing.
> - [x] Eventual consistency
>   Any replica may answer, so reads converge after a short delay.
> - [ ] Linearizability
>
> Pass \`ConsistentRead: true\` when the caller must see its own write.`,
  },
};

export const MultipleChoice: Story = {
  args: {
    markdown: `> [!quiz ^cache-invalidation] Which strategies keep a read-through cache correct after a write?
> - [x] Delete the key after the database commit
> - [x] Write-through: update the cache in the same code path
> - [ ] Rely on a long TTL
>   A long TTL widens the stale window instead of closing it.
> - [ ] Update the cache *before* the database
>   A failed commit leaves the cache holding data that never existed.
>
> Two \`[x]\` marks make this a multi-select automatically.`,
  },
};

export const TrueFalse: Story = {
  args: {
    markdown: `> [!quiz boolean] A Bloom filter can return a false negative.
> false
>
> Bloom filters may report **false positives**, never false negatives.`,
  },
};

export const Ordering: Story = {
  args: {
    markdown: `> [!quiz order] Put the system design interview steps in order
> - Requirements
> - Core entities
> - API
> - High-level design
> - Deep dives
>
> Agree on scope before drawing boxes.`,
  },
};

export const Matching: Story = {
  args: {
    markdown: `> [!quiz match] Match each protocol to where it fits best
> - REST :: public client APIs
> - gRPC :: internal service calls
> - WebSocket :: live, bidirectional updates
> - SSE :: server-to-client streams
>
> SSE is what KiwiFS uses for live page updates.`,
  },
};

export const ShortAnswer: Story = {
  args: {
    markdown: `> [!quiz short] Roughly how many boxes is too many for a high-level design?
> 7 | seven
>
> Past about seven, the diagram turns into a deep dive.`,
  },
};

export const PageScore: Story = {
  name: "Page score (several quizzes)",
  args: {
    showScore: true,
    markdown: [SingleChoice, TrueFalse, Ordering].map((s) => s.args!.markdown).join("\n\n"),
  },
  parameters: {
    docs: { description: { story: "The score in the page header counts every checked quiz on the page." } },
  },
};

export const ResumedAttempt: Story = {
  name: "Resumed (saved correct attempt)",
  args: {
    showScore: true,
    markdown: SingleChoice.args!.markdown,
    localState: {
      quiz: { [`${PAGE}#dynamo`]: { correct: true, attempts: 2, lastAt: "2026-10-10T18:00:00.000Z" } },
    },
  },
  parameters: {
    docs: { description: { story: "A reader who already answered correctly sees the settled result and can try again." } },
  },
};

export const AuthoringError: Story = {
  args: {
    markdown: `> [!quiz single] Which one?
> - [x] A
> - [x] B`,
  },
  parameters: {
    docs: { description: { story: "A single-choice quiz with two correct answers explains the mistake instead of rendering." } },
  },
};
