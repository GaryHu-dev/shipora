import { describe, it, expect, beforeEach } from "vitest";
import { getSession, saveSession, clearSession } from "../src/auth/session";

beforeEach(() => localStorage.clear());

describe("session storage", () => {
  it("returns null when empty", () => {
    expect(getSession()).toBeNull();
  });
  it("saves and reads a session", () => {
    saveSession("tok", "Li");
    expect(getSession()).toEqual({ token: "tok", name: "Li" });
  });
  it("clears a session", () => {
    saveSession("tok", "Li");
    clearSession();
    expect(getSession()).toBeNull();
  });
  it("returns null on corrupt data", () => {
    localStorage.setItem("stockproof_session", "not json");
    expect(getSession()).toBeNull();
  });
});
