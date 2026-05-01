import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { KiwiComments } from "./KiwiComments";
import { MockApiProvider } from "./__mocks__/apiMock";
import { StoryMarkdown } from "./__mocks__/StoryMarkdown";
import { mockMarkdownRichBody, mockComments } from "./__mocks__/data";

function CommentsWrapper({
  comments,
}: {
  comments?: typeof mockComments;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <MockApiProvider overrides={{ comments }}>
      <div className="max-w-4xl mx-auto p-8 bg-background text-foreground">
        <StoryMarkdown innerRef={containerRef} className="kiwi-prose mb-8">
          {mockMarkdownRichBody}
        </StoryMarkdown>
        <KiwiComments
          path="concepts/frontmatter.md"
          containerRef={containerRef as React.RefObject<HTMLElement>}
          renderKey={mockMarkdownRichBody}
        />
      </div>
    </MockApiProvider>
  );
}

const meta: Meta<typeof KiwiComments> = {
  title: "Content/KiwiComments",
  component: KiwiComments,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof KiwiComments>;

export const WithComments: Story = {
  render: () => <CommentsWrapper comments={mockComments} />,
};

export const NoComments: Story = {
  render: () => <CommentsWrapper comments={[]} />,
};
