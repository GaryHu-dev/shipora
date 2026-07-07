import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import JoinScreen from "../src/screens/JoinScreen";
import * as client from "../src/api/client";
import { getSession } from "../src/auth/session";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("JoinScreen", () => {
  it("joins, stores session, and calls onJoined", async () => {
    vi.spyOn(client, "join").mockResolvedValue({ sessionToken: "s1", user: { id: "u", name: "Wang" } });
    const onJoined = vi.fn();
    render(<JoinScreen joinToken="jt" onJoined={onJoined} />);

    await userEvent.type(screen.getByLabelText("Your name"), "Wang");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(getSession()).toEqual({ token: "s1", name: "Wang" });
  });

  it("offers a scan option when the join token is missing", () => {
    render(<JoinScreen joinToken={null} onJoined={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Scan QR/i })).toBeInTheDocument();
  });

  it("shows an error when join fails", async () => {
    vi.spyOn(client, "join").mockRejectedValue(new client.ApiError(401, "bad"));
    render(<JoinScreen joinToken="jt" onJoined={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Your name"), "Wang");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText(/Couldn't join/)).toBeInTheDocument());
  });
});
