/** No-op when admin has locked theme editing via ui-config. */
export function guardedThemeAction(
  themeLocked: boolean,
  action: () => void,
): void {
  if (themeLocked) return;
  action();
}
