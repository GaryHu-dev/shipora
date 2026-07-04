import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OrderDetailScreen from "../src/screens/OrderDetailScreen";
import * as client from "../src/api/client";
import * as image from "../src/lib/image";
import { saveSession } from "../src/auth/session";

beforeEach(() => { localStorage.clear(); saveSession("tok", "Li"); vi.restoreAllMocks(); });

describe("OrderDetailScreen", () => {
  it("shows existing photos", async () => {
    vi.spyOn(client, "listPhotos").mockResolvedValue([{ id: "p1", note: null, uploaded_at: 1 }]);
    render(<OrderDetailScreen orderId="o1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(1));
  });

  it("uploads a selected file then refreshes the gallery", async () => {
    const list = vi.spyOn(client, "listPhotos")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "p2", note: null, uploaded_at: 2 }]);
    const upload = vi.spyOn(client, "uploadPhoto").mockResolvedValue();
    vi.spyOn(image, "resizeImage").mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));

    render(<OrderDetailScreen orderId="o1" onBack={vi.fn()} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    const file = new File(["orig"], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/拍照/), file);

    await waitFor(() => expect(upload).toHaveBeenCalledWith("tok", "o1", expect.any(Blob), expect.any(Blob), undefined));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("calls onBack", async () => {
    vi.spyOn(client, "listPhotos").mockResolvedValue([]);
    const onBack = vi.fn();
    render(<OrderDetailScreen orderId="o1" onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onBack).toHaveBeenCalled();
  });
});
