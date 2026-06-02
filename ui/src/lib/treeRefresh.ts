type TreeRefreshDecision = {
  now: number;
  lastLocalMutationAt: number;
  suppressWindowMs: number;
};

type TreeLoadDecision = {
  requestStartedAt: number;
  lastLocalMutationAt: number;
};

export function shouldRefreshTreeImmediately({
  now,
  lastLocalMutationAt,
  suppressWindowMs,
}: TreeRefreshDecision): boolean {
  if (lastLocalMutationAt <= 0) return true;
  return now - lastLocalMutationAt > suppressWindowMs;
}

export function shouldApplyTreeLoad({ requestStartedAt, lastLocalMutationAt }: TreeLoadDecision): boolean {
  if (lastLocalMutationAt <= 0) return true;
  return requestStartedAt >= lastLocalMutationAt;
}
