import { createContext, createElement, useContext, useRef, type ReactNode } from "react";
import { type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { api, type SearchResult, type WorkflowColumn, type WorkflowDef, type WorkflowPage } from "@kw/lib/api";
import { getKanbanDragData, isKanbanCardDragData, isTreePageDragData, type KanbanDragData } from "@kw/lib/kanbanDnd";
import {
  createDefaultWorkflow,
  createKanbanCardMarkdown,
  defaultKanbanCardPath,
  normalizeWorkflowName,
  updateWorkflowStates,
} from "@kw/lib/workflow";
import { type EditStateRow } from "./ColumnRowsEditor";

type Workflow = WorkflowDef;
type WorkflowStateInput = WorkflowDef["states"][number];

export type AddCardMode = "new" | "existing";

export type AddCardDialogState = {
  open: boolean;
  state: string;
  mode: AddCardMode;
  title: string;
  path: string;
  body: string;
  query: string;
  results: SearchResult[];
  error: string | null;
  busy: boolean;
};

export type BoardViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "board" };

type KanbanState = {
  workflows: Workflow[];
  activeWorkflow: string | null;
  columns: WorkflowColumn[];
  unmatchedPages: WorkflowPage[];
  loading: boolean;
  boardError: string | null;
  loadErrors: string[];
  draggingPage: WorkflowPage | null;
  createOpen: boolean;
  newWorkflowName: string;
  createRows: EditStateRow[];
  createError: string | null;
  creating: boolean;
  deleteOpen: boolean;
  deleteError: string | null;
  deleting: boolean;
  editOpen: boolean;
  editRows: EditStateRow[];
  editError: string | null;
  savingEdit: boolean;
  addCard: AddCardDialogState;
};

type KanbanActions = {
  loadWorkflows: (preferredWorkflow?: string) => Promise<void>;
  loadBoard: (name: string) => Promise<void>;
  setActiveWorkflow: (name: string) => void;
  setCreateOpen: (open: boolean) => void;
  setNewWorkflowName: (name: string) => void;
  openCreateWorkflow: () => void;
  createWorkflow: () => Promise<void>;
  addCreateRow: () => void;
  removeCreateRow: (id: string) => void;
  updateCreateRowName: (id: string, name: string) => void;
  updateCreateRowColor: (id: string, color: string) => void;
  updateCreateRowWipLimit: (id: string, wipLimit: number | undefined) => void;
  setEditOpen: (open: boolean) => void;
  openEditWorkflow: () => void;
  saveEditWorkflow: () => Promise<void>;
  addEditRow: () => void;
  removeEditRow: (id: string) => void;
  updateEditRowName: (id: string, name: string) => void;
  updateEditRowColor: (id: string, color: string) => void;
  updateEditRowWipLimit: (id: string, wipLimit: number | undefined) => void;
  setDeleteOpen: (open: boolean) => void;
  openDeleteWorkflow: () => void;
  deleteWorkflow: () => Promise<void>;
  openAddCard: (state: string) => void;
  setAddCardOpen: (open: boolean) => void;
  setAddCardMode: (mode: AddCardMode) => void;
  setAddCardTitle: (title: string) => void;
  setAddCardPath: (path: string) => void;
  setAddCardBody: (body: string) => void;
  setAddCardQuery: (query: string) => void;
  cancelAddCard: () => void;
  createCard: () => Promise<string | null>;
  searchExistingPages: () => Promise<void>;
  assignExistingPage: (path: string) => Promise<void>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
};

export type KanbanStore = KanbanState & KanbanActions;

const DEFAULT_WORKFLOW_STATES = ["todo", "doing", "done"];
export const emptyAddCardDialog: AddCardDialogState = {
  open: false,
  state: "",
  mode: "new",
  title: "",
  path: "",
  body: "",
  query: "",
  results: [],
  error: null,
  busy: false,
};

/**
 * Builds editable column rows from a workflow definition.
 *
 * @param workflow - Workflow definition to edit.
 * @returns Rows with stable UI ids and preserved WIP limits.
 */
function makeEditRows(workflow: WorkflowDef): EditStateRow[] {
  return workflow.states.map((state, index) => ({
    ...state,
    id: `${state.name}-${index}`,
    wip_limit: state.wip_limit,
  }));
}

/**
 * Builds default editable rows for a new Kanban workflow.
 *
 * @returns Editable rows for the default workflow states.
 */
function makeDefaultRows(): EditStateRow[] {
  return makeEditRows(createDefaultWorkflow("", DEFAULT_WORKFLOW_STATES));
}

/**
 * Keeps a valid active workflow selection or falls back to the first available workflow.
 *
 * @param current - Current active workflow name.
 * @param workflows - Available workflow definitions.
 * @returns A valid workflow name, or null when no workflow exists.
 */
function selectActiveWorkflowName(current: string | null, workflows: Workflow[]): string | null {
  if (current && workflows.some((workflow) => workflow.name === current)) return current;
  const firstWorkflow = workflows[0];
  if (!firstWorkflow) return null;
  return firstWorkflow.name;
}

/**
 * Returns an Error message when available, otherwise returns the fallback text.
 *
 * @param err - Unknown caught error value.
 * @param fallback - Message to use for non-Error values.
 * @returns Error message suitable for UI state.
 */
function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * Returns the ordinal before the target insert index, using zero at the start.
 *
 * @param colPages - Pages currently in the column.
 * @param targetIndex - Target insertion index.
 * @returns Previous ordinal boundary.
 */
function getPreviousOrdinal(colPages: WorkflowPage[], targetIndex: number): number {
  if (targetIndex <= 0) return 0;
  return colPages[targetIndex - 1]?.ordinal ?? (targetIndex - 1) * 1000;
}

/**
 * Returns the ordinal after the target insert index, preserving the default spacing.
 *
 * @param colPages - Pages currently in the column.
 * @param targetIndex - Target insertion index.
 * @param previousOrdinal - Previous ordinal boundary.
 * @returns Next ordinal boundary.
 */
function getNextOrdinal(colPages: WorkflowPage[], targetIndex: number, previousOrdinal: number): number {
  if (targetIndex >= colPages.length) return previousOrdinal + 1000;
  return colPages[targetIndex]?.ordinal ?? targetIndex * 1000 + 1000;
}

/**
 * Resolves the source workflow state for dragged board cards; tree pages have no source state.
 *
 * @param dragData - Normalized Kanban drag payload.
 * @param pagePath - Dragged page path.
 * @param findColumnForPage - Column lookup callback.
 * @returns Source workflow state for board cards, otherwise null.
 */
function getSourceState(
  dragData: KanbanDragData,
  pagePath: string,
  findColumnForPage: (path: string) => string | null,
): string | null {
  if (isKanbanCardDragData(dragData)) return findColumnForPage(pagePath);
  return null;
}

/**
 * Replaces pages only on the matching workflow column.
 *
 * @param column - Column to inspect.
 * @param targetState - Workflow state to update.
 * @param pages - Replacement pages for the target column.
 * @returns Original or updated column.
 */
function replaceColumnPages(column: WorkflowColumn, targetState: string, pages: WorkflowPage[]): WorkflowColumn {
  if (column.state !== targetState) return column;
  return { ...column, pages };
}

/**
 * Converts an editable column row into the workflow state shape persisted by the API.
 *
 * @param row - Editable column row from a dialog.
 * @returns Workflow state payload for persistence.
 */
function toWorkflowStateInput(row: EditStateRow): WorkflowStateInput {
  const state = { name: row.name, color: row.color };
  if (!row.wip_limit) return state;
  return { ...state, wip_limit: row.wip_limit };
}

/**
 * Updates the name of the matching editable row without mutating the original row.
 *
 * @param row - Row to inspect.
 * @param id - Target row id.
 * @param name - Next row name.
 * @returns Original or updated row.
 */
function updateRowName(row: EditStateRow, id: string, name: string): EditStateRow {
  if (row.id !== id) return row;
  return { ...row, name };
}

/**
 * Updates the color of the matching editable row without mutating the original row.
 *
 * @param row - Row to inspect.
 * @param id - Target row id.
 * @param color - Next row color.
 * @returns Original or updated row.
 */
function updateRowColor(row: EditStateRow, id: string, color: string): EditStateRow {
  if (row.id !== id) return row;
  return { ...row, color };
}

/**
 * Updates the WIP limit of the matching editable row without mutating the original row.
 *
 * @param row - Row to inspect.
 * @param id - Target row id.
 * @param wip_limit - Next WIP limit.
 * @returns Original or updated row.
 */
function updateRowWipLimit(row: EditStateRow, id: string, wip_limit: number | undefined): EditStateRow {
  if (row.id !== id) return row;
  return { ...row, wip_limit };
}

/**
 * Keeps a manually edited card path, otherwise derives the default path from the new title.
 *
 * @param current - Current add-card dialog state.
 * @param title - Next card title.
 * @param workflowName - Workflow used for default path generation.
 * @returns Preserved manual path or regenerated default path.
 */
function getNextCardPath(current: AddCardDialogState, title: string, workflowName: string): string {
  const previousDefaultPath = defaultKanbanCardPath(current.title, workflowName);
  if (current.path && current.path !== previousDefaultPath) return current.path;
  return defaultKanbanCardPath(title, workflowName);
}

/**
 * Finds the workflow state containing a page path in the given columns.
 *
 * @param columns - Board columns to inspect.
 * @param path - Page path to locate.
 * @returns Workflow state containing the page, or null when not found.
 */
function findColumnForPage(columns: WorkflowColumn[], path: string): string | null {
  for (const col of columns) {
    if (col.pages.some((p) => p.path === path)) return col.state;
  }
  return null;
}

/**
 * Resolves a drop target id to a workflow state using either column ids or card paths.
 *
 * @param columns - Board columns to inspect.
 * @param overId - DnD target id from the hovered element.
 * @returns Target workflow state, or null when unresolved.
 */
function findTargetState(columns: WorkflowColumn[], overId: string): string | null {
  const overCol = columns.find((c) => c.state === overId);
  if (overCol) return overCol.state;
  return findColumnForPage(columns, overId);
}

/**
 * Formats the warning shown when cards reference states missing from the workflow columns.
 *
 * @param unmatchedPages - Pages with states not present in the board columns.
 * @returns Warning message for unmatched cards.
 */
export function getUnmatchedPagesMessage(unmatchedPages: WorkflowPage[]): string {
  const count = unmatchedPages.length;
  let verb = " has";
  if (count > 1) verb = "s have";
  const pageNames = unmatchedPages.map((page) => page.title || page.path).join(", ");
  return `${count} card${verb} a state that doesn't match any column (${pageNames}). Edit their frontmatter or add the missing column.`;
}

/**
 * Returns the empty board message for either missing workflows or empty workflow cards.
 *
 * @param workflows - Available workflow definitions.
 * @returns Empty-state message for the board area.
 */
function getEmptyBoardMessage(workflows: Workflow[]): string {
  if (workflows.length === 0) return "No workflows configured. Create a board to add a workflow JSON file.";
  return "No pages in this workflow yet.";
}

/**
 * Resolves the board display state in priority order.
 * Loading wins over errors, errors win over empty states, and board content renders last.
 *
 * @param params - Current board inputs.
 * @returns Discriminated view state for rendering the board area.
 */
export function getBoardViewState(params: {
  loading: boolean;
  boardError: string | null;
  columns: WorkflowColumn[];
  workflows: Workflow[];
}): BoardViewState {
  if (params.loading) return { kind: "loading" };
  if (params.boardError) return { kind: "error", message: params.boardError };
  if (params.columns.length === 0) return { kind: "empty", message: getEmptyBoardMessage(params.workflows) };
  return { kind: "board" };
}

function computeOrdinal(colPages: WorkflowPage[], targetIndex: number): number {
  const prev = getPreviousOrdinal(colPages, targetIndex);
  const next = getNextOrdinal(colPages, targetIndex, prev);
  return Math.round((prev + next) / 2);
}

function makeNewRow(): EditStateRow {
  return { id: `new-${Date.now()}`, name: "", color: "#9B59B6" };
}

function resolveInitialActiveWorkflow(
  preferredWorkflow: string | undefined,
  currentActiveWorkflow: string | null,
  workflows: Workflow[],
): string | null {
  if (preferredWorkflow && workflows.some((workflow) => workflow.name === preferredWorkflow)) {
    return preferredWorkflow;
  }
  if (workflows.length > 0) {
    return selectActiveWorkflowName(currentActiveWorkflow, workflows);
  }
  return null;
}

export function createKanbanStore() {
  return createStore<KanbanStore>((set, get) => ({
    workflows: [],
    activeWorkflow: null,
    columns: [],
    unmatchedPages: [],
    loading: true,
    boardError: null,
    loadErrors: [],
    draggingPage: null,
    createOpen: false,
    newWorkflowName: "",
    createRows: makeDefaultRows(),
    createError: null,
    creating: false,
    deleteOpen: false,
    deleteError: null,
    deleting: false,
    editOpen: false,
    editRows: [],
    editError: null,
    savingEdit: false,
    addCard: emptyAddCardDialog,

    async loadWorkflows(preferredWorkflow) {
      set({ loading: true, boardError: null });
      try {
        const result = await api.listWorkflows();
        const workflows = result.workflows || [];
        const activeWorkflow = resolveInitialActiveWorkflow(
          preferredWorkflow,
          get().activeWorkflow,
          workflows,
        );
        set({
          workflows,
          activeWorkflow,
          loadErrors: result.errors ?? [],
          columns: activeWorkflow ? get().columns : [],
        });
      } catch (err) {
        set({
          workflows: [],
          activeWorkflow: null,
          columns: [],
          boardError: getErrorMessage(err, "Failed to load workflows."),
        });
      } finally {
        set({ loading: false });
      }
    },

    async loadBoard(name) {
      set({ loading: true, boardError: null });
      try {
        const result = await api.getWorkflowBoard(name);
        set({ columns: result.columns || [], unmatchedPages: result.unmatchedPages ?? [] });
      } catch (err) {
        set({
          columns: [],
          unmatchedPages: [],
          boardError: getErrorMessage(err, "Failed to load board."),
        });
      } finally {
        set({ loading: false });
      }
    },

    setActiveWorkflow(activeWorkflow) {
      set({ activeWorkflow });
    },

    setCreateOpen(createOpen) {
      set({ createOpen });
    },

    setNewWorkflowName(newWorkflowName) {
      set({ newWorkflowName });
    },

    openCreateWorkflow() {
      set({
        newWorkflowName: "",
        createRows: makeDefaultRows(),
        createError: null,
        createOpen: true,
      });
    },

    async createWorkflow() {
      const name = normalizeWorkflowName(get().newWorkflowName);
      if (!name) {
        set({ createError: "Board name is required." });
        return;
      }
      if (get().workflows.some((workflow) => workflow.name === name)) {
        set({ createError: `Workflow "${name}" already exists.` });
        return;
      }

      set({ creating: true, createError: null });
      try {
        const workflow = updateWorkflowStates(
          { name, states: [], transitions: [] },
          get().createRows.map(toWorkflowStateInput),
        );
        await api.saveWorkflow(workflow);
        set({ createOpen: false, newWorkflowName: "", createRows: makeDefaultRows() });
        await get().loadWorkflows(name);
      } catch (err) {
        set({ createError: getErrorMessage(err, "Failed to create workflow.") });
      } finally {
        set({ creating: false });
      }
    },

    addCreateRow() {
      set((state) => ({ createRows: [...state.createRows, makeNewRow()] }));
    },

    removeCreateRow(id) {
      set((state) => ({ createRows: state.createRows.filter((row) => row.id !== id) }));
    },

    updateCreateRowName(id, name) {
      set((state) => ({ createRows: state.createRows.map((row) => updateRowName(row, id, name)) }));
    },

    updateCreateRowColor(id, color) {
      set((state) => ({ createRows: state.createRows.map((row) => updateRowColor(row, id, color)) }));
    },

    updateCreateRowWipLimit(id, wipLimit) {
      set((state) => ({ createRows: state.createRows.map((row) => updateRowWipLimit(row, id, wipLimit)) }));
    },

    setEditOpen(editOpen) {
      set({ editOpen });
    },

    openEditWorkflow() {
      const activeWorkflow = get().activeWorkflow;
      const activeWorkflowDef = get().workflows.find((workflow) => workflow.name === activeWorkflow);
      if (!activeWorkflowDef) return;
      set({ editRows: makeEditRows(activeWorkflowDef), editError: null, editOpen: true });
    },

    async saveEditWorkflow() {
      const activeWorkflow = get().activeWorkflow;
      const activeWorkflowDef = get().workflows.find((workflow) => workflow.name === activeWorkflow);
      if (!activeWorkflowDef || !activeWorkflow) return;

      set({ savingEdit: true, editError: null });
      try {
        const updatedWorkflow = updateWorkflowStates(
          activeWorkflowDef,
          get().editRows.map(toWorkflowStateInput),
        );
        await api.saveWorkflow(updatedWorkflow);
        set({ editOpen: false });
        await get().loadWorkflows(activeWorkflow);
        await get().loadBoard(activeWorkflow);
      } catch (err) {
        set({ editError: getErrorMessage(err, "Failed to save columns.") });
      } finally {
        set({ savingEdit: false });
      }
    },

    addEditRow() {
      set((state) => ({ editRows: [...state.editRows, makeNewRow()] }));
    },

    removeEditRow(id) {
      set((state) => ({ editRows: state.editRows.filter((row) => row.id !== id) }));
    },

    updateEditRowName(id, name) {
      set((state) => ({ editRows: state.editRows.map((row) => updateRowName(row, id, name)) }));
    },

    updateEditRowColor(id, color) {
      set((state) => ({ editRows: state.editRows.map((row) => updateRowColor(row, id, color)) }));
    },

    updateEditRowWipLimit(id, wipLimit) {
      set((state) => ({ editRows: state.editRows.map((row) => updateRowWipLimit(row, id, wipLimit)) }));
    },

    setDeleteOpen(deleteOpen) {
      set({ deleteOpen });
    },

    openDeleteWorkflow() {
      set({ deleteError: null, deleteOpen: true });
    },

    async deleteWorkflow() {
      const activeWorkflow = get().activeWorkflow;
      if (!activeWorkflow) return;

      set({ deleting: true, deleteError: null });
      try {
        await api.deleteWorkflow(activeWorkflow);
        set({ deleteOpen: false });
        await get().loadWorkflows();
      } catch (err) {
        set({ deleteError: getErrorMessage(err, "Failed to delete workflow.") });
      } finally {
        set({ deleting: false });
      }
    },

    openAddCard(state) {
      if (!get().activeWorkflow) return;
      set({ addCard: { ...emptyAddCardDialog, open: true, state, title: "", path: "" } });
    },

    setAddCardOpen(open) {
      set((state) => ({ addCard: { ...state.addCard, open } }));
    },

    setAddCardMode(mode) {
      set((state) => ({ addCard: { ...state.addCard, mode, error: null } }));
    },

    setAddCardTitle(title) {
      set((state) => ({
        addCard: {
          ...state.addCard,
          title,
          path: getNextCardPath(state.addCard, title, state.activeWorkflow || "kanban"),
        },
      }));
    },

    setAddCardPath(path) {
      set((state) => ({ addCard: { ...state.addCard, path } }));
    },

    setAddCardBody(body) {
      set((state) => ({ addCard: { ...state.addCard, body } }));
    },

    setAddCardQuery(query) {
      set((state) => ({ addCard: { ...state.addCard, query } }));
    },

    cancelAddCard() {
      set({ addCard: emptyAddCardDialog });
    },

    async createCard() {
      const activeWorkflow = get().activeWorkflow;
      const addCard = get().addCard;
      if (!activeWorkflow) return null;
      const title = addCard.title.trim();
      const path = addCard.path.trim();
      if (!title) {
        set({ addCard: { ...addCard, error: "Card title is required." } });
        return null;
      }
      if (!path.endsWith(".md")) {
        set({ addCard: { ...addCard, error: "Card path must end with .md." } });
        return null;
      }

      set({ addCard: { ...addCard, busy: true, error: null } });
      try {
        await api.writeFile(
          path,
          createKanbanCardMarkdown({
            title,
            workflow: activeWorkflow,
            state: addCard.state,
            body: addCard.body,
          }),
        );
        set({ addCard: emptyAddCardDialog });
        await get().loadBoard(activeWorkflow);
        return path;
      } catch (err) {
        set((state) => ({
          addCard: {
            ...state.addCard,
            busy: false,
            error: getErrorMessage(err, "Failed to create card."),
          },
        }));
        return null;
      }
    },

    async searchExistingPages() {
      const addCard = get().addCard;
      const query = addCard.query.trim();
      if (!query) {
        set({ addCard: { ...addCard, error: "Search query is required." } });
        return;
      }
      set({ addCard: { ...addCard, busy: true, error: null } });
      try {
        const response = await api.search(query);
        set((state) => ({
          addCard: {
            ...state.addCard,
            busy: false,
            results: (response.results || []).filter((result) => result.path.endsWith(".md")),
          },
        }));
      } catch (err) {
        set((state) => ({
          addCard: {
            ...state.addCard,
            busy: false,
            error: getErrorMessage(err, "Failed to search pages."),
          },
        }));
      }
    },

    async assignExistingPage(path) {
      const activeWorkflow = get().activeWorkflow;
      if (!activeWorkflow) return;
      set((state) => ({ addCard: { ...state.addCard, busy: true, error: null } }));
      try {
        await api.assignWorkflow(path, activeWorkflow, get().addCard.state);
        set({ addCard: emptyAddCardDialog });
        await get().loadBoard(activeWorkflow);
      } catch (err) {
        set((state) => ({
          addCard: {
            ...state.addCard,
            busy: false,
            error: getErrorMessage(err, "Failed to add page to board."),
          },
        }));
      }
    },

    handleDragStart(event) {
      const dragData = getKanbanDragData(event.active.data.current);
      if (isTreePageDragData(dragData)) {
        set({ draggingPage: { path: dragData.path, title: dragData.title } });
        return;
      }

      if (!isKanbanCardDragData(dragData)) return;
      for (const column of get().columns) {
        const page = column.pages.find((p) => p.path === dragData.path);
        if (page) {
          set({ draggingPage: page });
          break;
        }
      }
    },

    async handleDragEnd(event) {
      set({ draggingPage: null });
      const { active, over } = event;
      const activeWorkflow = get().activeWorkflow;
      if (!over || !activeWorkflow) return;

      const dragData = getKanbanDragData(active.data.current);
      if (!dragData) return;

      const columns = get().columns;
      const pagePath = dragData.path;
      const sourceState = getSourceState(dragData, pagePath, (path) => findColumnForPage(columns, path));
      const targetState = findTargetState(columns, String(over.id));
      if (!targetState) return;

      if (targetState === sourceState && isKanbanCardDragData(dragData)) {
        const column = columns.find((col) => col.state === targetState);
        if (!column) return;
        const oldIndex = column.pages.findIndex((page) => page.path === pagePath);
        const overPath = String(over.id);
        let newIndex = column.pages.findIndex((page) => page.path === overPath);
        if (newIndex === -1) newIndex = column.pages.length - 1;
        if (oldIndex === newIndex) return;

        const reordered = [...column.pages];
        const [moved] = reordered.splice(oldIndex, 1);
        if (!moved) return;
        reordered.splice(newIndex, 0, moved);
        set((state) => ({
          columns: state.columns.map((col) => replaceColumnPages(col, targetState, reordered)),
        }));

        const ordinal = computeOrdinal(
          reordered.filter((page) => page.path !== pagePath),
          newIndex,
        );
        try {
          await api.reorderCard(pagePath, ordinal);
        } catch {
          await get().loadBoard(activeWorkflow);
        }
        return;
      }

      if (targetState === sourceState) return;

      const draggedPage = columns
        .flatMap((col) => col.pages)
        .find((page) => page.path === pagePath);
      if (draggedPage?.blocked && targetState === "in_progress") {
        return;
      }

      if (isTreePageDragData(dragData)) {
        try {
          await api.assignWorkflow(pagePath, activeWorkflow, targetState);
          await get().loadBoard(activeWorkflow);
        } catch {
          await get().loadBoard(activeWorkflow);
        }
        return;
      }

      set((state) => ({
        columns: state.columns.map((column) => {
          if (column.state === sourceState) {
            return { ...column, pages: column.pages.filter((page) => page.path !== pagePath) };
          }
          if (column.state === targetState) {
            const page = state.columns
              .find((col) => col.state === sourceState)
              ?.pages.find((candidate) => candidate.path === pagePath);
            if (page) return { ...column, pages: [...column.pages, page] };
          }
          return column;
        }),
      }));

      try {
        await api.advanceWorkflow(pagePath, activeWorkflow, targetState);
      } catch {
        await get().loadBoard(activeWorkflow);
      }
    },
  }));
}

type KanbanStoreApi = StoreApi<KanbanStore>;

const KanbanStoreContext = createContext<KanbanStoreApi | null>(null);

export function KanbanStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<KanbanStoreApi | null>(null);
  if (!storeRef.current) storeRef.current = createKanbanStore();

  return createElement(KanbanStoreContext.Provider, { value: storeRef.current }, children);
}

export function useKanbanStore<T>(selector: (store: KanbanStore) => T): T {
  const store = useContext(KanbanStoreContext);
  if (!store) throw new Error("useKanbanStore must be used within KanbanStoreProvider");
  return useStore(store, selector);
}
