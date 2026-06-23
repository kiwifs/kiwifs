import { Keyboard } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@kw/components/ui/command";
import {
  formatChordDisplay,
  SHORTCUT_SECTIONS,
  shortcutSearchValue,
  type KeybindingAction,
} from "../lib/kiwiKeybindings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindings: Record<KeybindingAction, string>;
  conflicts?: { chord: string; actions: string[] }[];
};

function ShortcutKeys({ chord }: { chord: string }) {
  return (
    <kbd className="px-2 py-0.5 rounded border border-border bg-muted font-mono text-xs text-muted-foreground shrink-0">
      {formatChordDisplay(chord)}
    </kbd>
  );
}

export function KeyboardShortcuts({ open, onOpenChange, bindings, conflicts = [] }: Props) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="sm:max-w-md"
      commandProps={{ shouldFilter: true }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <Keyboard className="h-4 w-4" />
        Keyboard shortcuts
      </div>
      {conflicts.length > 0 && (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Conflicting bindings detected:{" "}
          {conflicts.map((c) => `${c.actions.join(" / ")} (${formatChordDisplay(c.chord)})`).join("; ")}
        </div>
      )}
      <CommandInput placeholder="Search shortcuts…" />
      <CommandList className="max-h-[min(60vh,28rem)]">
        <CommandEmpty>No shortcuts found.</CommandEmpty>
        {SHORTCUT_SECTIONS.map((section) => (
          <CommandGroup key={section.section} heading={section.section}>
            {section.items.map((item) => (
              <CommandItem
                key={item.action}
                value={shortcutSearchValue(section.section, item.label, bindings[item.action])}
                className="flex items-center justify-between gap-3 aria-selected:bg-accent"
                onSelect={() => {}}
              >
                <span className="flex-1">{item.label}</span>
                <ShortcutKeys chord={bindings[item.action]} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
