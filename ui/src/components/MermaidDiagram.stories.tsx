import type { Meta, StoryObj } from "@storybook/react-vite";
import { MermaidDiagram } from "./MermaidDiagram";

const meta: Meta<typeof MermaidDiagram> = {
  title: "Content/MermaidDiagram",
  component: MermaidDiagram,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-4xl mx-auto p-8 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MermaidDiagram>;

export const Flowchart: Story = {
  args: {
    chart: `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`,
  },
};

export const SequenceDiagram: Story = {
  args: {
    chart: `sequenceDiagram
    participant Browser
    participant KiwiFS
    participant SQLite

    Browser->>KiwiFS: GET /api/search?q=hello
    KiwiFS->>SQLite: FTS5 query
    SQLite-->>KiwiFS: ranked results
    KiwiFS-->>Browser: JSON response`,
  },
};

export const ClassDiagram: Story = {
  args: {
    chart: `classDiagram
    class KiwiFS {
      +string dataDir
      +int port
      +serve()
      +index()
    }
    class SearchEngine {
      +query(q: string)
      +reindex()
    }
    class FileWatcher {
      +watch(dir: string)
      +onChanged()
    }
    KiwiFS --> SearchEngine
    KiwiFS --> FileWatcher`,
  },
};

export const GitGraph: Story = {
  args: {
    chart: `gitGraph
    commit id: "init"
    branch feat/mermaid
    checkout feat/mermaid
    commit id: "add component"
    commit id: "fix dark mode"
    checkout main
    merge feat/mermaid
    commit id: "release"`,
  },
};

export const PieChart: Story = {
  args: {
    chart: `pie title KiwiFS File Types
    "Markdown" : 65
    "Excalidraw" : 15
    "Images" : 12
    "Other" : 8`,
  },
};

export const StateDiagram: Story = {
  args: {
    chart: `stateDiagram-v2
    [*] --> Draft
    Draft --> Published: publish
    Published --> Archived: archive
    Archived --> Published: restore
    Draft --> [*]: delete`,
  },
};

const REQUEST_PATH = `graph LR
    U((User)) --> CDN[CDN]
    CDN -->|miss| LB{{Load balancer}}
    LB --> API[API]
    API --> C[(Redis)]
    API --> DB[(Postgres)]
    API --> Q[[Jobs]]`;

export const FocusedPath: Story = {
  name: "Focus — request path",
  args: {
    chart: REQUEST_PATH,
    focus: ["LB", "API", "DB"],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Nodes in `focus` light up, edges between them follow, everything else fades. In markdown: ```` ```mermaid focus="LB,API,DB" ````.',
      },
    },
  },
};

export const FocusedEdgeAndDim: Story = {
  name: "Focus — single edge, explicit dim",
  args: {
    chart: REQUEST_PATH,
    focus: ["API->C"],
    dim: ["Q"],
  },
};

export const FocusedSequenceMessage: Story = {
  name: "Focus — sequence message #n",
  args: {
    chart: `sequenceDiagram
    participant C as Client
    participant A as API
    participant D as DB
    C->>A: POST /orders
    A->>D: INSERT order
    D-->>A: commit
    A-->>C: 201 Created`,
    focus: ["#2"],
  },
};

export const WideDiagram: Story = {
  name: "Wide diagram scrolls to focus",
  args: {
    chart: `graph LR
    S[Source] --> P1[Parse] --> P2[Validate] --> P3[Normalize] --> P4[Enrich]
    P4 --> P5[Deduplicate] --> P6[Chunk] --> P7[Embed] --> P8[Index] --> P9[Serve]`,
    focus: ["P8", "P9"],
  },
  parameters: {
    docs: {
      description: {
        story:
          "Diagrams too wide to stay legible keep a minimum scale and scroll sideways, auto-scrolling to the focused part. Use the ⤢ button for fullscreen.",
      },
    },
  },
};

export const InvalidSyntax: Story = {
  args: {
    chart: `graph INVALID
    this is not valid mermaid --->>> syntax !!!`,
  },
};

export const Empty: Story = {
  args: {
    chart: "",
  },
};
