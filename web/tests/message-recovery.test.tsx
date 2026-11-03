import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Messages } from "../src/features/Messages";
import { ApiError } from "../src/api/client";

describe("message submission recovery", () => {
  it("allows correction after a definite local rejection", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("Message rejected", 400, "INVALID_BODY"),
      )
      .mockResolvedValue(undefined);
    render(<Messages messages={[]} submit={submit} />);
    const text = screen.getByLabelText("Message your team");
    await user.type(text, "First message");
    await user.click(screen.getByRole("button", { name: "Queue message" }));
    expect(await screen.findByText(/Message rejected/)).toBeVisible();
    await user.clear(text);
    await user.type(text, "Corrected message");
    expect(screen.getByRole("button", { name: "Queue message" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Queue message" }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].payload.text).toBe("Corrected message");
  });
  it("keeps an ambiguous request blocked even if its text is edited", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockRejectedValue(new ApiError("Response lost", 0, "NETWORK_ERROR"));
    render(<Messages messages={[]} submit={submit} />);
    await user.type(
      screen.getByLabelText("Message your team"),
      "Preserve the original key",
    );
    await user.click(screen.getByRole("button", { name: "Queue message" }));
    await screen.findByText(/Response lost/);
    await user.type(screen.getByLabelText("Message your team"), " edited");
    expect(
      screen.getByRole("button", { name: "Queue message" }),
    ).toBeDisabled();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
