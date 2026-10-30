/** Blocks still loading: a page is not finished rendering while any match. */
export const PENDING = ".my-4.h-24.animate-pulse, .kiwi-query-loading, .kiwi-chart-loading, .kiwi-kanban-loading";

/** Blocks that rendered their own error state instead of their content. */
export const BROKEN = [
  ".kiwi-calc-error",
  ".kiwi-chart-error",
  ".kiwi-progress-error",
  ".kiwi-kanban-error",
  ".kiwi-data-error",
  ".kiwi-query-error",
  ".kiwi-quiz-error",
].join(", ");
