import { useEffect, useState } from "react";
import { api, onSpaceChange } from "../lib/api";
import type { EditorSlashCommands } from "../lib/editorSlashCommands";

const EMPTY: EditorSlashCommands = { commands: [], hide: [], warnings: [] };

/**
 * The space's custom slash commands. Fetched on mount, so opening an editor
 * picks up edits to `.kiwi/slash-commands.toml`, and again on space change.
 */
export function useEditorSlashCommands(): EditorSlashCommands {
  const [state, setState] = useState<EditorSlashCommands>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api
        .getEditorSlashCommands()
        .then((res) => {
          if (cancelled) return;
          setState({
            commands: res.commands ?? [],
            hide: res.hide ?? [],
            warnings: res.warnings ?? [],
          });
        })
        .catch(() => {
          if (!cancelled) setState(EMPTY);
        });
    };

    load();
    const off = onSpaceChange(load);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
