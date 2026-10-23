import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@kw/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@kw/components/ui/command";
import {
  formatChordDisplay,
  SHORTCUT_SECTIONS,
  type KeybindingAction,
} from "../lib/kiwiKeybindings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindings: Record<KeybindingAction, string>;
  conflicts?: { chord: string; actions: string[] }[];
};

export function KeyboardShortcuts({ open, onOpenChange, bindings, conflicts = [] }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        {conflicts.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Conflicting bindings detected:{" "}
            {conflicts.map((c) => `${c.actions.join(" / ")} (${formatChordDisplay(c.chord)})`).join("; ")}
          </div>
        )}
        <Command className="bg-transparent">
          <CommandInput placeholder="Filter shortcuts..." />
          <CommandList className="max-h-[70vh]">
            <CommandEmpty>No matching shortcuts.</CommandEmpty>
            {SHORTCUT_SECTIONS.map((s) => (
              <CommandGroup key={s.section} heading={s.section}>
                {s.items.map((item) => {
                  const chord = formatChordDisplay(bindings[item.action]);
                  return (
                    <CommandItem
                      key={item.action}
                      value={`${s.section} ${item.label} ${chord}`}
                      className="items-center justify-between"
                    >
                      <span>{item.label}</span>
                      <kbd className="px-2 py-0.5 rounded border border-border bg-muted font-mono text-xs text-muted-foreground">
                        {chord}
                      </kbd>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
