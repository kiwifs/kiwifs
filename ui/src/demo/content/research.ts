import * as blk from "../blocks";
import { demoBacklinks, demoComments, demoSearch } from "./mockExtras";

export const researchPages: Record<string, string> = {
  "index.md": `---
title: Reading list
type: index
---

ML paper shelf with citations, reading workflow, and synthesis notes. Papers use \`workflow: reading\` and \`state\` for board columns.

${blk.queryTable('TABLE title, authors, year, venue, state FROM "papers/" WHERE type = "paper" SORT year DESC')}

${blk.queryTable('TABLE title, state FROM "papers/" WHERE state = "reading" OR state = "annotated"')}

${blk.progress({
  type: "bar",
  title: "Reading pipeline",
  items: [
    { label: "Summarized", value: 2, color: "#22c55e" },
    { label: "Annotated", value: 1, color: "#3b82f6" },
    { label: "Reading", value: 1, color: "#eab308" },
    { label: "Unread", value: 1, color: "#64748b" },
  ],
})}

${blk.chart({
  type: "pie",
  title: "Papers by venue",
  xKey: "venue",
  series: [{ key: "count", name: "Papers", color: "#84cc16" }],
  data: [
    { venue: "NeurIPS", count: 3 },
    { venue: "NAACL", count: 1 },
    { venue: "ICML", count: 1 },
  ],
})}

Open graph view for the citation network (8+ nodes).
`,

  "papers/attention-is-all-you-need.md": `---
title: Attention Is All You Need
type: paper
authors: [Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser, Polosukhin]
year: 2017
venue: NeurIPS
doi: 10.48550/arXiv.1706.03762
bibtex_key: vaswani2017attention
workflow: reading
state: summarized
tags: [transformer, attention, foundational]
cites: []
abstract: The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, based solely on attention mechanisms.
---

## Summary

Introduced the **Transformer** — encoder-decoder stacks with multi-head self-attention, eliminating recurrence. Enabled parallel training and became the backbone for [[papers/bert|BERT]], [[papers/gpt3|GPT-3]], and efficient fine-tuning work like [[papers/lora|LoRA]].

## Scaled dot-product attention

For queries $Q$, keys $K$, values $V$ with key dimension $d_k$:

$$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$

Multi-head attention runs $h$ parallel heads; outputs are concatenated and projected.

## Key findings

1. **Positional encoding** — sinusoidal; no recurrence needed for order
2. **Complexity** — $O(n^2 \\cdot d)$ per layer vs RNN $O(n \\cdot d^2)$ when $n < d$
3. **BLEU** — 41.8 on WMT14 En-De (new SOTA at publication)

${blk.mermaid(`graph LR
  subgraph Encoder
    E1[Self-Attn] --> E2[FFN]
    E2 --> E3[Self-Attn x6]
  end
  subgraph Decoder
    D1[Masked Self-Attn] --> D2[Cross-Attn]
    D2 --> D3[FFN x6]
  end
  E3 --> D2
  D3 --> OUT[Softmax]`)}

${blk.tabs([
  {
    label: "Key findings",
    body: `- First purely attention-based seq2seq SOTA
- Training 3.5 days on 8× P100 for base model
- Generalizes to English constituency parsing`,
  },
  {
    label: "My notes",
    body: `- Compare to [[notes/transformer-survey|survey draft]] section 2
- Re-read §3.2 for why $\\sqrt{d_k}$ scaling matters numerically
- Citation hub for entire shelf — see graph view`,
  },
  {
    label: "Open questions",
    body: `- How would Chinchilla scaling laws ([[papers/chinchilla|Chinchilla]]) change compute budget for replicating base Transformer today?
- LoRA ([[papers/lora|LoRA]]) assumes frozen attention weights — still valid?`,
  },
])}

Downstream: [[papers/bert]], [[papers/gpt3]], [[papers/lora]], [[papers/chinchilla]], [[notes/transformer-survey]].
`,

  "papers/bert.md": `---
title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
type: paper
authors: [Devlin, Chang, Lee, Toutanova]
year: 2019
venue: NAACL
doi: 10.18653/v1/N19-1423
bibtex_key: devlin2019bert
workflow: reading
state: annotated
tags: [transformer, encoder, nlp]
cites: [papers/attention-is-all-you-need.md]
abstract: We introduce BERT, which pre-trains deep bidirectional representations by jointly conditioning on both left and right context in all layers.
---

## Summary

**Bidirectional** encoder-only Transformer. Pre-training with masked LM + next sentence prediction; fine-tune on downstream tasks with task-specific heads.

## Relation to Transformer

Uses encoder stack from [[papers/attention-is-all-you-need|Attention Is All You Need]] — no decoder. Masking prevents left-to-right cheating during pretrain.

## Annotations

- §4.1: MLM masks 15% of tokens — 80% [MASK], 10% random, 10% unchanged
- GLUE score 80.5% — +7.7 over prior SOTA at release
- **Limitation:** NSP objective later questioned; RoBERTa removes it

${blk.chart({
  type: "bar",
  title: "GLUE dev scores (reported)",
  xKey: "model",
  grid: true,
  series: [{ key: "score", name: "Average %", color: "#3b82f6" }],
  data: [
    { model: "OpenAI GPT", score: 72.8 },
    { model: "ELMo", score: 68.6 },
    { model: "BERT_BASE", score: 84.4 },
    { model: "BERT_LARGE", score: 86.4 },
  ],
})}

See [[notes/transformer-survey]] · Contrasts with decoder-only [[papers/gpt3|GPT-3]].
`,

  "papers/gpt3.md": `---
title: "Language Models are Few-Shot Learners"
type: paper
authors: [Brown, Mann, Ryder, Subbiah, Kaplan, Dhariwal, Neelakantan, Shyam, Sastry, Agarwal, Herbert-Voss, Krueger, Henighan, Child, Ramesh, Ziegler, Wu, Winter, Hesse, Chen, Sigler, Litwin, Gray, Chess, Clark, Berner, McCandlish, Radford, Sutskever, Amodei]
year: 2020
venue: NeurIPS
doi: 10.48550/arXiv.2005.14165
bibtex_key: brown2020gpt3
workflow: reading
state: reading
tags: [llm, decoder, scaling]
cites: [papers/attention-is-all-you-need.md]
abstract: We train GPT-3, an autoregressive language model with 175 billion parameters, and show strong few-shot performance on many NLP datasets.
---

## Summary

**175B-parameter** decoder-only Transformer. No fine-tuning for many tasks — prompt with in-context examples. Validates that scale + [[papers/attention-is-all-you-need|Transformer]] architecture unlocks emergent few-shot behavior.

## Reading progress

- [x] Abstract & §1 Introduction
- [x] §2 Approach (model dims)
- [ ] §3 Training dataset
- [ ] §4 Evaluation
- [ ] §6 Limitations

${blk.progress({
  type: "gauge",
  title: "Reading progress",
  items: [
    { label: "Sections read", value: 45 },
    { label: "Notes written", value: 30 },
    { label: "Citations extracted", value: 60 },
  ],
})}

## Model scale (selected)

| Model | Layers | $d_{model}$ | Heads | Params |
|-------|--------|------------|-------|--------|
| GPT-3 Small | 12 | 768 | 12 | 125M |
| GPT-3 XL | 24 | 1600 | 25 | 1.3B |
| GPT-3 175B | 96 | 12288 | 96 | 175B |

Connects to compute-optimal training in [[papers/chinchilla|Chinchilla]] and parameter-efficient tuning in [[papers/lora|LoRA]].
`,

  "papers/lora.md": `---
title: "LoRA: Low-Rank Adaptation of Large Language Models"
type: paper
authors: [Hu, Shen, Wallis, Allen-Zhu, Li, Wang, Wang, Chen]
year: 2021
venue: ICML
doi: 10.48550/arXiv.2106.09685
bibtex_key: hu2021lora
workflow: reading
state: summarized
tags: [fine-tuning, efficiency, peft]
cites: [papers/gpt3.md, papers/attention-is-all-you-need.md]
abstract: We propose Low-Rank Adaptation (LoRA), which freezes pre-trained model weights and injects trainable rank decomposition matrices into each layer.
---

## Summary

Fine-tune huge LMs by learning low-rank updates $\\Delta W = BA$ where $B \\in \\mathbb{R}^{d \\times r}$, $A \\in \\mathbb{R}^{r \\times k}$ with rank $r \\ll \\min(d,k)$. Applied to attention projection matrices in Transformer blocks from [[papers/attention-is-all-you-need|Attention]].

## Why it matters

- **10,000× fewer trainable params** on GPT-3 175B for some tasks
- No inference latency vs full fine-tune when merged
- Enables many task-specific adapters on one base ([[papers/gpt3|GPT-3]])

## Key equation

$$h = W_0 x + \\Delta W x = W_0 x + BAx$$

$W_0$ frozen; only $A$, $B$ trained.

Incorporated into [[notes/transformer-survey|survey]] §5 (efficient adaptation).
`,

  "papers/chinchilla.md": `---
title: "Training Compute-Optimal Large Language Models"
type: paper
authors: [Hoffmann, Borgeaud, Mensch, Buchatskaya, Cai, Rutherford, de Las Casas, Hendricks, Rae, Millican, van den Driessche, Lespiau, Rutherford, Hennigan, Sifre, Aymar, Yang, Ke, Rutherford, Bauer, Millican, van den Driessche, Lespiau, Rutherford, Hennigan, Sifre]
year: 2022
venue: NeurIPS
doi: 10.48550/arXiv.2203.15556
bibtex_key: hoffmann2022chinchilla
workflow: reading
state: unread
tags: [scaling, compute, training]
cites: [papers/gpt3.md]
abstract: We investigate the optimal model size and number of tokens for training a transformer language model under a given compute budget.
---

## Summary (stub)

Challenges Kaplan-style "bigger is always better" from [[papers/gpt3|GPT-3]]. **Chinchilla** (70B) matches Gopher (280B) by training on **4× more tokens** than prior work — compute-optimal scaling laws.

## To read

- Derive optimal $N$ (params) vs $D$ (tokens) for fixed compute $C$
- Compare recommendations to our internal pretrain budget

Linked from [[notes/transformer-survey]] §4.
`,

  "notes/transformer-survey.md": `---
title: Transformer architecture survey (draft)
type: note
status: draft
tags: [survey, synthesis]
---

Literature review spanning encoder, decoder, and efficient adaptation — primary sources linked below.

## Outline

1. **Foundations** — [[papers/attention-is-all-you-need|Transformer (2017)]]
2. **Encoder pretraining** — [[papers/bert|BERT (2019)]]
3. **Decoder scale** — [[papers/gpt3|GPT-3 (2020)]]
4. **Compute-optimal training** — [[papers/chinchilla|Chinchilla (2022)]]
5. **Parameter-efficient FT** — [[papers/lora|LoRA (2021)]]

${blk.mermaid(`graph TD
  ATT[Attention 2017] --> BERT[BERT 2019]
  ATT --> GPT3[GPT-3 2020]
  GPT3 --> CHIN[Chinchilla 2022]
  ATT --> LORA[LoRA 2021]
  GPT3 --> LORA
  BERT --> SURVEY[This survey]
  GPT3 --> SURVEY
  LORA --> SURVEY
  CHIN --> SURVEY
  ATT --> SURVEY`)}

${blk.columns("1:1", [
  `### Thesis (WIP)

The Transformer family splits into **encoder**, **decoder**, and **encoder-decoder** lineages. Scaling laws ([[papers/chinchilla|Chinchilla]]) and adaptation methods ([[papers/lora|LoRA]]) now dominate practical deployment more than architectural tweaks.`,
  `### Gap analysis

| Topic | Covered | Missing |
|-------|---------|---------|
| Attention | ✅ | FlashAttention variants |
| Scaling | 🔄 Chinchilla | MoE survey |
| Fine-tuning | ✅ LoRA | QLoRA, DoRA |`,
])}

${blk.queryTable('TABLE title, year, state FROM "papers/" SORT year ASC')}

> [!TIP]
> Advance paper \`state\` via reading workflow when annotations are complete.
`,
};

export const researchMock = {
  graphNodes: [
    { path: "papers/attention-is-all-you-need.md", tags: ["transformer", "foundational"] },
    { path: "papers/bert.md", tags: ["encoder", "nlp"] },
    { path: "papers/gpt3.md", tags: ["llm", "decoder"] },
    { path: "papers/lora.md", tags: ["peft", "efficiency"] },
    { path: "papers/chinchilla.md", tags: ["scaling"] },
    { path: "notes/transformer-survey.md", tags: ["survey", "synthesis"] },
    { path: "index.md", tags: ["index"] },
  ],
  graphEdges: [
    { source: "papers/bert.md", target: "papers/attention-is-all-you-need.md" },
    { source: "papers/gpt3.md", target: "papers/attention-is-all-you-need.md" },
    { source: "papers/lora.md", target: "papers/attention-is-all-you-need.md" },
    { source: "papers/lora.md", target: "papers/gpt3.md" },
    { source: "papers/chinchilla.md", target: "papers/gpt3.md" },
    { source: "notes/transformer-survey.md", target: "papers/attention-is-all-you-need.md" },
    { source: "notes/transformer-survey.md", target: "papers/bert.md" },
    { source: "notes/transformer-survey.md", target: "papers/gpt3.md" },
    { source: "notes/transformer-survey.md", target: "papers/lora.md" },
    { source: "notes/transformer-survey.md", target: "papers/chinchilla.md" },
    { source: "index.md", target: "papers/attention-is-all-you-need.md" },
    { source: "papers/bert.md", target: "notes/transformer-survey.md" },
  ],
  searchResults: demoSearch([
    { path: "papers/attention-is-all-you-need.md", score: 0.97, snippet: "...<mark>multi-head attention</mark>, eliminating recurrence..." },
    { path: "papers/gpt3.md", score: 0.91, snippet: "...<mark>few-shot</mark> performance on many NLP datasets..." },
    { path: "papers/lora.md", score: 0.86, snippet: "...<mark>low-rank</mark> updates ΔW = BA..." },
    { path: "notes/transformer-survey.md", score: 0.80, snippet: "...<mark>encoder</mark>, decoder, and efficient adaptation..." },
  ]),
  backlinks: demoBacklinks([
    { path: "papers/attention-is-all-you-need.md", count: 6 },
    { path: "papers/gpt3.md", count: 3 },
    { path: "notes/transformer-survey.md", count: 5 },
  ]),
  comments: demoComments("papers/gpt3.md", [
    {
      id: "r-c1",
      anchor: { quote: "emergent", prefix: "unlock ", suffix: " few-shot" },
      body: "Check if 'emergent' is overstated — cite Wei et al. 2022?",
      author: "researcher",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      resolved: false,
    },
  ]),
  queryRows: [
    { _path: "papers/chinchilla.md", title: "Training Compute-Optimal Large Language Models", authors: "Hoffmann et al.", year: 2022, venue: "NeurIPS", state: "unread" },
    { _path: "papers/lora.md", title: "LoRA: Low-Rank Adaptation of Large Language Models", authors: "Hu et al.", year: 2021, venue: "ICML", state: "summarized" },
    { _path: "papers/gpt3.md", title: "Language Models are Few-Shot Learners", authors: "Brown et al.", year: 2020, venue: "NeurIPS", state: "reading" },
    { _path: "papers/bert.md", title: "BERT: Pre-training of Deep Bidirectional Transformers", authors: "Devlin et al.", year: 2019, venue: "NAACL", state: "annotated" },
    { _path: "papers/attention-is-all-you-need.md", title: "Attention Is All You Need", authors: "Vaswani et al.", year: 2017, venue: "NeurIPS", state: "summarized" },
  ],
  metaResults: [
    { path: "papers/attention-is-all-you-need.md", frontmatter: { title: "Attention Is All You Need", year: 2017, state: "summarized", workflow: "reading" } },
    { path: "papers/gpt3.md", frontmatter: { title: "Language Models are Few-Shot Learners", year: 2020, state: "reading", workflow: "reading" } },
  ],
  workflows: [
    {
      name: "reading",
      states: [
        { name: "unread", color: "#64748b" },
        { name: "reading", color: "#eab308" },
        { name: "annotated", color: "#3b82f6" },
        { name: "summarized", color: "#22c55e" },
        { name: "incorporated", color: "#a855f7" },
      ],
      transitions: [
        { from: "unread", to: "reading" },
        { from: "reading", to: "annotated" },
        { from: "annotated", to: "summarized" },
        { from: "summarized", to: "incorporated" },
        { from: "reading", to: "unread" },
      ],
    },
  ],
  workflowBoards: {
    reading: {
      columns: [
        {
          state: "unread",
          color: "#64748b",
          pages: [{ path: "papers/chinchilla.md", title: "Training Compute-Optimal LLMs", modified: new Date(Date.now() - 86400000 * 2).toISOString() }],
        },
        {
          state: "reading",
          color: "#eab308",
          pages: [{ path: "papers/gpt3.md", title: "Language Models are Few-Shot Learners", modified: new Date(Date.now() - 86400000).toISOString() }],
        },
        {
          state: "annotated",
          color: "#3b82f6",
          pages: [{ path: "papers/bert.md", title: "BERT", modified: new Date(Date.now() - 86400000 * 5).toISOString() }],
        },
        {
          state: "summarized",
          color: "#22c55e",
          pages: [
            { path: "papers/attention-is-all-you-need.md", title: "Attention Is All You Need", modified: new Date(Date.now() - 86400000 * 10).toISOString() },
            { path: "papers/lora.md", title: "LoRA", modified: new Date(Date.now() - 86400000 * 7).toISOString() },
          ],
        },
        {
          state: "incorporated",
          color: "#a855f7",
          pages: [],
        },
      ],
    },
  },
  timelineEvents: [
    { type: "write", path: "papers/gpt3.md", title: "GPT-3", actor: "researcher", timestamp: new Date(Date.now() - 86400000).toISOString(), message: "Started reading — section 2 complete" },
    { type: "write", path: "papers/bert.md", title: "BERT", actor: "researcher", timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), message: "Annotations added to §4" },
    { type: "write", path: "papers/attention-is-all-you-need.md", title: "Attention paper", actor: "researcher", timestamp: new Date(Date.now() - 86400000 * 10).toISOString(), message: "Summary complete" },
    { type: "write", path: "notes/transformer-survey.md", title: "Transformer survey", actor: "researcher", timestamp: new Date(Date.now() - 86400000 * 4).toISOString(), message: "Draft outline with citation graph" },
  ],
};
