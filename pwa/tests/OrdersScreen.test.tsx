import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OrdersScreen, { resetOrdersCache } from "../src/screens/OrdersScreen";
import * as client from "../src/api/client";
import { saveSession } from "../src/auth/session";

beforeEach(() => { localStorage.clear(); resetOrdersCache(); saveSession("tok", "Li"); vi.restoreAllMocks(); });

const ORDERS = [
  { id: "o1", order_number: "#1001", customer_name: "Alice", fulfillment_status: "unfulfilled", created_at: 10 },
];

describe("OrdersScreen", () => {
  it("loads unfulfilled orders by default and opens one", async () => {
    const spy = vi.spyOn(client, "listOrders").mockResolvedValue(ORDERS);
    const onOpen = vi.fn();
    render(<OrdersScreen onOpenOrder={onOpen} />);

    await waitFor(() => expect(screen.getByText("#1001")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith("tok", "unfulfilled", undefined, 20, 0);
    expect(screen.getByText("Alice")).toBeInTheDocument();

    await userEvent.click(screen.getByText("#1001"));
    expect(onOpen).toHaveBeenCalledWith("o1");
  });

  it("switches filter to All", async () => {
    const spy = vi.spyOn(client, "listOrders").mockResolvedValue(ORDERS);
    render(<OrdersScreen onOpenOrder={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("#1001")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("tok", "all", undefined, 20, 0));
  });

  it("shows an empty state", async () => {
    vi.spyOn(client, "listOrders").mockResolvedValue([]);
    render(<OrdersScreen onOpenOrder={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No orders/)).toBeInTheDocument());
  });
});
