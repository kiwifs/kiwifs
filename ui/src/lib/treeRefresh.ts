type TreeRefreshDecision = {
  now: number;
  lastLocalMutationAt: number;
  suppressWindowMs: number;
};

type TreeLoadDecision = {
  requestStartedAt: number;
  lastLocalMutationAt: number;
};

/**
 * Decides whether a background event should refresh the tree immediately.
 *
 * @param decision - Timing information for the latest local mutation window.
 * @returns True when no recent optimistic mutation needs protection.
 */
export const shouldRefreshTreeImmediately = ({
  now,
  lastLocalMutationAt,
  suppressWindowMs,
}: TreeRefreshDecision): boolean => {
  if (lastLocalMutationAt <= 0) {
    return true;
  }
  return now - lastLocalMutationAt > suppressWindowMs;
};

/**
 * Decides whether an async tree load is still current enough to apply.
 *
 * @param decision - Request start time and latest local mutation time.
 * @returns True when applying the response will not roll back a local move.
 */
export const shouldApplyTreeLoad = ({ requestStartedAt, lastLocalMutationAt }: TreeLoadDecision): boolean => {
  if (lastLocalMutationAt <= 0) {
    return true;
  }
  return requestStartedAt >= lastLocalMutationAt;
};
