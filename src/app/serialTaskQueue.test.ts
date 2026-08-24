import { describe, expect, it, vi } from "vitest";
import { createSerialTaskQueue } from "./serialTaskQueue";

describe("createSerialTaskQueue", () => {
  it("does not start the next task until the current task settles", async () => {
    const enqueue = createSerialTaskQueue();
    let finishFirst: (value: string) => void = () => undefined;
    const secondTask = vi.fn(async () => "second");

    const first = enqueue(
      () =>
        new Promise<string>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = enqueue(secondTask);

    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();

    finishFirst("first");
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(secondTask).toHaveBeenCalledOnce();
  });
});
