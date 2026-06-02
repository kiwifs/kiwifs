import { Button } from "@kw/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kw/components/ui/dialog";
import { Input } from "@kw/components/ui/input";
import { Label } from "@kw/components/ui/label";
import { useKiwiTreeUiStore } from "@kw/stores/kiwiTreeUiStore";

type Props = {
  onDuplicate: () => void;
};

/**
 * Returns the duplicate dialog submit label without JSX-level ternaries.
 *
 * @param dupBusy - Whether the duplicate request is currently running.
 * @returns Submit button label.
 */
const duplicateSubmitLabel = (dupBusy: boolean): string => {
  if (dupBusy) {
    return "Duplicating...";
  }
  return "Duplicate";
};

/**
 * Returns the confirmation button variant from the dialog metadata.
 *
 * @param destructive - Whether the action is destructive.
 * @returns Button variant understood by the shared button component.
 */
const confirmButtonVariant = (destructive: boolean | undefined): "default" | "destructive" => {
  if (destructive) {
    return "destructive";
  }
  return "default";
};

export function KiwiTreeDialogs({ onDuplicate }: Props) {
  const dupOpen = useKiwiTreeUiStore((state) => state.dupOpen);
  const dupTarget = useKiwiTreeUiStore((state) => state.dupTarget);
  const dupBusy = useKiwiTreeUiStore((state) => state.dupBusy);
  const promptDialog = useKiwiTreeUiStore((state) => state.promptDialog);
  const promptValue = useKiwiTreeUiStore((state) => state.promptValue);
  const alertMessage = useKiwiTreeUiStore((state) => state.alertMessage);
  const confirmDialog = useKiwiTreeUiStore((state) => state.confirmDialog);
  const closeDupDialog = useKiwiTreeUiStore((state) => state.closeDupDialog);
  const setDupTarget = useKiwiTreeUiStore((state) => state.setDupTarget);
  const closePromptDialog = useKiwiTreeUiStore((state) => state.closePromptDialog);
  const setPromptValue = useKiwiTreeUiStore((state) => state.setPromptValue);
  const setAlertMessage = useKiwiTreeUiStore((state) => state.setAlertMessage);
  const closeConfirmDialog = useKiwiTreeUiStore((state) => state.closeConfirmDialog);

  const submitPrompt = () => {
    if (!promptValue.trim() || !promptDialog) return;
    promptDialog.onConfirm(promptValue.trim());
    closePromptDialog();
  };

  const submitConfirm = () => {
    confirmDialog?.onConfirm();
    closeConfirmDialog();
  };

  return (
    <>
      <Dialog open={dupOpen} onOpenChange={(open) => { if (!open) closeDupDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate page</DialogTitle>
            <DialogDescription>Enter the path for the new copy.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tree-dup-path">New path</Label>
            <Input
              id="tree-dup-path"
              autoFocus
              value={dupTarget}
              onChange={(e) => setDupTarget(e.target.value)}
              className="font-mono"
              onKeyDown={(e) => { if (e.key === "Enter") onDuplicate(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDupDialog}>Cancel</Button>
            <Button onClick={onDuplicate} disabled={dupBusy || !dupTarget.trim()}>
              {duplicateSubmitLabel(dupBusy)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!promptDialog} onOpenChange={(open) => { if (!open) closePromptDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{promptDialog?.title}</DialogTitle>
            <DialogDescription>{promptDialog?.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              className="font-mono"
              onKeyDown={(e) => { if (e.key === "Enter") submitPrompt(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePromptDialog}>Cancel</Button>
            <Button onClick={submitPrompt} disabled={!promptValue.trim()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!alertMessage} onOpenChange={(open) => { if (!open) setAlertMessage(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conflict</DialogTitle>
            <DialogDescription>{alertMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAlertMessage(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) closeConfirmDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>{confirmDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirmDialog}>Cancel</Button>
            <Button variant={confirmButtonVariant(confirmDialog?.destructive)} onClick={submitConfirm}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
