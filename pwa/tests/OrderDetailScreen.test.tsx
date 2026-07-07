import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OrderDetailScreen from "../src/screens/OrderDetailScreen";
import * as client from "../src/api/client";
import * as image from "../src/lib/image";
import { saveSession } from "../src/auth/session";

beforeEach(() => { localStorage.clear(); saveSession("tok", "Li"); vi.restoreAllMocks(); });

describe("OrderDetailScreen", () => {
  const photo = (over: Partial<import("../src/api/types").Photo> = {}) => ({
    id: "p1", category: "shipping_photo", content_type: "image/jpeg", note: null, uploaded_at: 1, uploaded_by_name: "Li", ...over,
  });

  function mockOrder() {
    vi.spyOn(client, "getOrder").mockResolvedValue({
      order: { order_number: "#1001", customer_name: null, fulfillment_status: "unfulfilled", created_at: 1 },
      items: [{ title: "Widget", quantity: 2, imageUrl: null }],
      address: null,
    });
  }

  it("shows existing uploads", async () => {
    mockOrder();
    vi.spyOn(client, "listPhotos").mockResolvedValue([photo()]);
    vi.spyOn(client, "fetchPhotoBlob").mockResolvedValue(new Blob(["img"], { type: "image/jpeg" }));
    render(<OrderDetailScreen orderId="o1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(1));
  });

  it("uploads with the selected category, then refreshes", async () => {
    mockOrder();
    const list = vi.spyOn(client, "listPhotos")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([photo({ id: "p2", uploaded_at: 2 })]);
    vi.spyOn(client, "fetchPhotoBlob").mockResolvedValue(new Blob(["img"], { type: "image/jpeg" }));
    const upload = vi.spyOn(client, "uploadPhoto").mockResolvedValue();
    vi.spyOn(image, "resizeImage").mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));

    render(<OrderDetailScreen orderId="o1" onBack={vi.fn()} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    const file = new File(["orig"], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/take photo/i), file);

    // Staged, not uploaded yet — confirm with the Upload button.
    expect(upload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /upload 1 photo/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledWith("tok", "o1", expect.any(Blob), expect.any(Blob), "shipping_photo", undefined));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("calls onBack", async () => {
    mockOrder();
    vi.spyOn(client, "listPhotos").mockResolvedValue([]);
    const onBack = vi.fn();
    render(<OrderDetailScreen orderId="o1" onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
