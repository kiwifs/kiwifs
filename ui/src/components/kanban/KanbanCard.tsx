import { useEffect, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDistanceToNow, parseISO, format, isBefore, isSameYear, startOfDay } from "date-fns";
import {
  AlignLeft,
  CalendarClock,
  AlertTriangle,
  Lock,
  Link2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@kw/components/ui/tooltip";
import { createKanbanCardDragData } from "@kw/lib/kanbanDnd";
import {
  tagColor,
  parsePriority,
  priorityStyle,
  authorInitials,
  authorColor,
} from "@kw/lib/kanbanUi";
import type { WorkflowPage } from "@kw/lib/api";

type Props = {
  page: WorkflowPage;
  onNavigate: (path: string) => void;
};

const BASE_CARD_CLASS =
  "group flex flex-col overflow-hidden rounded-lg border bg-card px-3 py-2.5 text-sm cursor-grab active:cursor-grabbing hover:border-border/70 hover:bg-accent/30 transition-colors duration-150";

function getCardClassName(isBlocked: boolean): string {
  if (isBlocked) {
    return `${BASE_CARD_CLASS} border-border/50 bg-muted/30 opacity-60`;
  }
  return `${BASE_CARD_CLASS} border-border/40`;
}

function parseDueDate(due: string | undefined): Date | null {
  if (!due) return null;
  const d = new Date(due);
  return isNaN(d.getTime()) ? null : d;
}

function PriorityIcon({ priority, dotColor }: { priority: ReturnType<typeof parsePriority>; dotColor: string }) {
  if (priority === "critical") {
    return <AlertTriangle className="h-3.5 w-3.5" />;
  }
  return (
    <svg
      fill={dotColor}
      className="h-2 w-2"
      viewBox="0 0 6 6"
      aria-hidden="true"
    >
      <circle cx={3} cy={3} r={3} />
    </svg>
  );
}

export function KanbanCard({ page, onNavigate }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.path, data: createKanbanCardDragData(page.path) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const wasDraggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) wasDraggedRef.current = true;
  }, [isDragging]);

  const priority = parsePriority(page.priority);
  const pStyle = priority && priority !== "none" ? priorityStyle(priority) : null;
  const tags = page.tags?.slice(0, 4) ?? [];

  const validDue = parseDueDate(page.due);
  const showYear = validDue ? !isSameYear(validDue, new Date()) : false;
  const isOverdue = validDue ? isBefore(validDue, startOfDay(new Date())) : false;

  const isBlocked = !!page.blocked;
  const hasDescription = !!page.description;
  const hasDeps = (page.depends_on?.length ?? 0) > 0;
  const hasMetaIcons = hasDescription || validDue || pStyle || isBlocked || hasDeps;
  const hasMembers = !!page.author;

  const blockTooltip = isBlocked
    ? (page.block_reason ? `Blocked by: ${page.block_reason}` : "Blocked")
    : undefined;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={getCardClassName(isBlocked)}
            title={blockTooltip}
          >
      {isBlocked && (
        <div className="flex items-center gap-1 mb-1 text-muted-foreground text-[11px] font-medium">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="truncate">{page.block_reason || "Blocked"}</span>
        </div>
      )}
      <button
        type="button"
        className="text-left w-full"
        onClick={(e) => {
          e.stopPropagation();
          if (wasDraggedRef.current) {
            wasDraggedRef.current = false;
            return;
          }
          onNavigate(page.path);
        }}
      >
        <span className="break-words text-[13px] leading-snug">{page.title}</span>
      </button>

      {(tags.length > 0 || hasMetaIcons || hasMembers || page.modified) && (
        <div className="mt-2.5 flex flex-col gap-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => {
                const color = tagColor(t);
                return (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border/60"
                  >
                    <svg
                      fill={color.fg}
                      className="h-1.5 w-1.5"
                      viewBox="0 0 6 6"
                      aria-hidden="true"
                    >
                      <circle cx={3} cy={3} r={3} />
                    </svg>
                    {t}
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-2">
              {pStyle && (
                <div
                  className="flex items-center gap-1"
                  style={{ color: pStyle.dotColor }}
                  title={`Priority: ${pStyle.label}`}
                >
                  <PriorityIcon priority={priority} dotColor={pStyle.dotColor} />
                  <span className="text-[11px]">{pStyle.label}</span>
                </div>
              )}

              {hasDeps && (
                <div
                  className="flex items-center gap-1 text-muted-foreground/70"
                  title={`Depends on: ${page.depends_on!.join(", ")}`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span className="text-[10px]">{page.depends_on!.length}</span>
                </div>
              )}

              {hasDescription && (
                <div className="flex items-center text-muted-foreground/70" title="Has description">
                  <AlignLeft className="h-3.5 w-3.5" />
                </div>
              )}

              {validDue && (
                <div
                  className={`flex items-center gap-1 ${isOverdue ? "text-destructive" : "text-muted-foreground/70"}`}
                  title={validDue.toLocaleDateString()}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span className="text-[11px]">
                    {format(validDue, showYear ? "do MMM yyyy" : "do MMM")}
                  </span>
                </div>
              )}

              {page.modified && (
                <span className="text-[10px] text-muted-foreground/60">
                  {formatDistanceToNow(parseISO(page.modified), { addSuffix: true })}
                </span>
              )}
            </div>

            {page.author && (
              <div className="flex items-center justify-end -space-x-1">
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full shrink-0 ring-2 ring-card"
                  style={{ backgroundColor: authorColor(page.author) }}
                  title={page.author}
                >
                  <span className="text-[10px] font-medium leading-none text-white">
                    {authorInitials(page.author)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
          </div>
        </TooltipTrigger>
        {isBlocked && blockTooltip && (
          <TooltipContent side="top" className="max-w-xs text-xs">
            {blockTooltip}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
