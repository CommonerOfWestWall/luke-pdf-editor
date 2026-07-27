export function nextPasswordPrompt(
  currentPassword: string,
  attemptedPassword?: string,
): { password: string; error: string | null } {
  if (!attemptedPassword) return { password: "", error: null };
  return { password: currentPassword, error: "密码不正确，请重新输入。" };
}

export function canCancelPasswordPrompt(busy: boolean): boolean {
  return !busy;
}
