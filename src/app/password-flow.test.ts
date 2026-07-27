import { describe, expect, it } from "vitest";
import { canCancelPasswordPrompt, nextPasswordPrompt } from "./password-flow";

describe("password prompt state", () => {
  it("clears credentials when a different encrypted document becomes pending", () => {
    expect(nextPasswordPrompt("previous-document-password")).toEqual({
      password: "",
      error: null,
    });
  });

  it("keeps the entered value only for a retry of the same document", () => {
    expect(nextPasswordPrompt("wrong-password", "wrong-password")).toEqual({
      password: "wrong-password",
      error: "密码不正确，请重新输入。",
    });
  });

  it("prevents cancellation while MuPDF is authenticating", () => {
    expect(canCancelPasswordPrompt(true)).toBe(false);
    expect(canCancelPasswordPrompt(false)).toBe(true);
  });
});
