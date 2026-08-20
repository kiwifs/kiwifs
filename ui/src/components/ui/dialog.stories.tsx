import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

function Example({ open = false }: { open?: boolean }) {
  return (
    <Dialog defaultOpen={open}>
      <DialogTrigger asChild>
        <Button>Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create view</DialogTitle>
          <DialogDescription>Save a reusable query as a named Bases view.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Name, query, and layout live in the form.</p>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta: Meta<typeof Example> = {
  title: "UI/Dialog",
  component: Example,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Example>;

export const Closed: Story = {};

export const Open: Story = {
  args: { open: true },
};
