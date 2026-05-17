import type { Meta, StoryObj } from "@storybook/react";
import { KiwiPlayground } from "./KiwiPlayground";

const meta: Meta<typeof KiwiPlayground> = {
  title: "Content/KiwiPlayground",
  component: KiwiPlayground,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-lg p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiPlayground>;

export const AnimationTuning: Story = {
  args: {
    source: `title: Animation Tuning
widgets:
  - type: slider
    key: duration
    label: Duration (ms)
    min: 100
    max: 2000
    step: 50
    default: 500
  - type: toggle
    key: loop
    label: Loop Animation
    default: true
  - type: select
    key: easing
    label: Easing Function
    options: [linear, ease-in, ease-out, ease-in-out]
    default: ease-out
  - type: color
    key: accent
    label: Accent Color
    default: "#3b82f6"
export:
  format: json
  copyLabel: Copy Config`,
  },
};

export const FormBuilder: Story = {
  args: {
    source: `title: Form Configuration
widgets:
  - type: text
    key: label
    label: Field Label
    default: Email Address
    placeholder: Enter label text
  - type: select
    key: type
    label: Input Type
    options: [text, email, number, date]
    default: email
  - type: toggle
    key: required
    label: Required Field
    default: true
  - type: number
    key: maxLength
    label: Max Length
    min: 1
    max: 500
    step: 1
    default: 100
export:
  format: json
  copyLabel: Copy Field Config`,
  },
};

export const ErrorState: Story = {
  args: {
    source: "invalid config {{{",
  },
};
