/**
 * KiwiKanbanBlock — Self-contained drag-and-drop kanban board in markdown.
 *
 * Renders a kanban board from YAML config in ```kiwi-kanban fenced blocks.
 * Uses @dnd-kit for drag-and-drop. Cards come from the fenced block source,
 * or from a DQL query when the block sets `query` and `groupBy`.
 *
 * Config format:
 * ```kiwi-kanban
 * title: Sprint Planning
 * columns:
 *   - name: Now
 *     color: "#22c55e"
 *     cards:
 *       - id: auth
 *         title: Fix auth token refresh
 *         tags: [backend, critical]
 *       - id: onboard
 *         title: Redesign onboarding flow
 *         tags: [frontend, design]
 *   - name: Next
 *     color: "#3b82f6"
 *     cards:
 *       - id: search
 *         title: Add semantic search
 *         tags: [backend, feature]
 * export:
 *   format: markdown
 *   copyLabel: Copy Prioritized List
 * ```
 *
 * Query-driven form — lanes are the distinct `groupBy` values, and any
 * declared columns fix their order and colour:
 * ```kiwi-kanban
 * query: |
 *   TABLE title, status FROM "datasets"
 * groupBy: status
 * columns:
 *   - name: draft
 *     color: "#f59e0b"
 * ```
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  buildKanbanBlockExportText,
  parseKanbanBlockConfig,
  queryRowsToKanbanColumns,
  type KanbanBlockCard,
  type KanbanBlockColumn,
} from "@kw/lib/kanbanBlock";
import { api } from "@kw/lib/api";

// ── Sortable Card Component ──────────────────────────────────────────────────

function SortableCard({ card }: { card: KanbanBlockCard }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kiwi-kanban-card group rounded-md border border-border bg-card p-3 shadow-sm
        ${isDragging ? "shadow-lg ring-2 ring-primary/30" : "hover:shadow-md"}`}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag handle"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug">{card.title}</p>
          {card.description && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{card.description}</p>
          )}
          {card.tags && card.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {(card.priority || card.assignee) && (
            <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
              {card.priority && <span className="font-medium">{card.priority}</span>}
              {card.assignee && <span>@{card.assignee}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Card Overlay (shown while dragging) ──────────────────────────────────────

function CardOverlay({ card }: { card: KanbanBlockCard }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 shadow-xl rotate-2 ring-2 ring-primary/30">
      <p className="text-sm font-medium text-foreground">{card.title}</p>
      {card.tags && card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Column Component ─────────────────────────────────────────────────────────

function Column({ column, cards }: { column: KanbanBlockColumn; cards: KanbanBlockCard[] }) {
  const cardIds = cards.map((c) => c.id);

  return (
    <div className="kiwi-kanban-column flex-shrink-0 w-64 flex flex-col rounded-lg border border-border bg-muted/30 overflow-hidden">
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
        {column.color && (
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: column.color }}
          />
        )}
        <span className="text-sm font-medium text-foreground truncate">{column.name}</span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">{cards.length}</span>
      </div>

      {/* Cards area */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[120px] max-h-[400px]">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50 border border-dashed border-border/50 rounded-md">
            Drop cards here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function KiwiKanbanBlock({ source }: { source: string }) {
  const initialConfig = useMemo(() => parseKanbanBlockConfig(source), [source]);
  const [columns, setColumns] = useState<KanbanBlockColumn[]>(initialConfig.columns);
  const [activeCard, setActiveCard] = useState<KanbanBlockCard | null>(null);
  const [copied, setCopied] = useState(false);

  // A query only drives the board when it also says how to group; without
  // groupBy there are no lanes to build, so the inline columns stand.
  const dql = initialConfig.groupBy ? initialConfig.query : undefined;
  const groupBy = initialConfig.groupBy;
  const [loading, setLoading] = useState(Boolean(dql));
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    if (!dql || !groupBy) {
      setColumns(initialConfig.columns);
      setLoading(false);
      setQueryError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setQueryError(null);
    api
      .query(dql)
      .then((resp) => {
        if (cancelled) return;
        setColumns(queryRowsToKanbanColumns(resp.rows, groupBy, initialConfig.columns));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setQueryError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dql, groupBy, initialConfig]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Find which column a card belongs to
  const findColumnOfCard = useCallback((cardId: string): number => {
    return columns.findIndex((col) => col.cards.some((c) => c.id === cardId));
  }, [columns]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const colIdx = findColumnOfCard(active.id as string);
    if (colIdx >= 0) {
      const card = columns[colIdx].cards.find((c) => c.id === active.id);
      setActiveCard(card || null);
    }
  }, [findColumnOfCard, columns]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColIdx = findColumnOfCard(activeId);
    let overColIdx = findColumnOfCard(overId);

    // If over is a column name (droppable area), find it
    if (overColIdx < 0) {
      overColIdx = columns.findIndex((col) => col.name === overId);
    }

    if (activeColIdx < 0 || overColIdx < 0 || activeColIdx === overColIdx) return;

    // Move card from one column to another
    setColumns((prev) => {
      const next = prev.map((col) => ({ ...col, cards: [...col.cards] }));
      const cardIdx = next[activeColIdx].cards.findIndex((c) => c.id === activeId);
      if (cardIdx < 0) return prev;

      const [card] = next[activeColIdx].cards.splice(cardIdx, 1);

      // Find insert index in target column
      const overCardIdx = next[overColIdx].cards.findIndex((c) => c.id === overId);
      if (overCardIdx >= 0) {
        next[overColIdx].cards.splice(overCardIdx, 0, card);
      } else {
        next[overColIdx].cards.push(card);
      }

      return next;
    });
  }, [findColumnOfCard, columns]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColIdx = findColumnOfCard(activeId);
    const overColIdx = findColumnOfCard(overId);

    if (activeColIdx < 0) return;

    if (activeColIdx === overColIdx && overColIdx >= 0) {
      // Reorder within same column
      setColumns((prev) => {
        const next = prev.map((col) => ({ ...col, cards: [...col.cards] }));
        const oldIdx = next[activeColIdx].cards.findIndex((c) => c.id === activeId);
        const newIdx = next[activeColIdx].cards.findIndex((c) => c.id === overId);
        if (oldIdx >= 0 && newIdx >= 0) {
          next[activeColIdx].cards = arrayMove(next[activeColIdx].cards, oldIdx, newIdx);
        }
        return next;
      });
    }
  }, [findColumnOfCard]);

  const handleCopyExport = useCallback(async () => {
    const format = initialConfig.export?.format || "markdown";
    const text = buildKanbanBlockExportText(columns, format);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [columns, initialConfig.export]);

  const { error } = useMemo(() => {
    if (initialConfig.query && !initialConfig.groupBy) {
      return { error: "A kanban `query` also needs `groupBy` naming the column that forms the lanes" };
    }
    // A query-driven board derives its lanes from the rows, so declaring
    // columns up front is optional there.
    if (!dql && (!initialConfig.columns || initialConfig.columns.length === 0)) {
      return { error: "No columns defined in kanban config" };
    }
    return { error: null };
  }, [initialConfig, dql]);

  if (error || queryError) {
    return (
      <div className="kiwi-kanban-error rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <strong>Kanban Error:</strong> {error ?? queryError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="kiwi-kanban-loading text-muted-foreground text-sm">Loading board…</div>
    );
  }

  return (
    <figure className="kiwi-kanban-block not-prose my-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        {initialConfig.title && (
          <figcaption className="text-sm font-medium text-foreground">
            {initialConfig.title}
          </figcaption>
        )}
        <button
          onClick={handleCopyExport}
          className="ml-auto px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded-md transition-colors"
        >
          {copied ? "Copied!" : initialConfig.export?.copyLabel || "Copy as Markdown"}
        </button>
      </div>

      {/* Board */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="flex gap-3 p-3 overflow-x-auto bg-muted/10">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {columns.map((col) => (
              <Column key={col.name} column={col} cards={col.cards} />
            ))}
            <DragOverlay>
              {activeCard ? <CardOverlay card={activeCard} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </figure>
  );
}
