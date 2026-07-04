import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../src/App";
import * as client from "../src/api/client";
import { saveSession } from "../src/auth/session";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); window.location.hash = ""; });

describe("App routing", () => {
  it("redirects to join when there is no session", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("加入发货团队")).toBeInTheDocument());
  });

  it("shows orders when a session exists", async () => {
    saveSession("tok", "Li");
    vi.spyOn(client, "listOrders").mockResolvedValue([]);
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "未发货" })).toBeInTheDocument());
  });
});
