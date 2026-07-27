import { describe, expect, it, vi } from "vitest";
import { RenderScheduler } from "./render-scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushScheduler() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("RenderScheduler", () => {
  it("runs one task at a time and chooses the highest queued priority", async () => {
    const scheduler = new RenderScheduler<string>();
    const active = deferred<string>();
    const order: string[] = [];

    const first = scheduler.schedule("document:0", "active", "thumbnail", () => {
      order.push("active");
      return active.promise;
    });
    await flushScheduler();
    const thumbnail = scheduler.schedule("document:0", "thumbnail", "thumbnail", async () => {
      order.push("thumbnail");
      return "thumbnail";
    });
    const buffer = scheduler.schedule("document:0", "buffer", "buffer", async () => {
      order.push("buffer");
      return "buffer";
    });
    const visible = scheduler.schedule("document:0", "visible", "visible", async () => {
      order.push("visible");
      return "visible";
    });

    expect(order).toEqual(["active"]);
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 3 });

    active.resolve("active");
    await Promise.all([first, visible, buffer, thumbnail]);
    expect(order).toEqual(["active", "visible", "buffer", "thumbnail"]);
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0, completed: 4 });
  });

  it("merges duplicate keys and promotes a queued task", async () => {
    const scheduler = new RenderScheduler<string>();
    const active = deferred<string>();
    const duplicateRun = vi.fn(async () => "page");
    const ignoredRun = vi.fn(async () => "ignored");

    const blocker = scheduler.schedule("document:0", "active", "visible", () => active.promise);
    const low = scheduler.schedule("document:0", "page", "thumbnail", duplicateRun);
    const high = scheduler.schedule("document:0", "page", "visible", ignoredRun);
    await flushScheduler();

    expect(scheduler.snapshot()).toMatchObject({ queued: 1, merged: 1 });
    active.resolve("active");
    await Promise.all([blocker, low, high]);
    expect(duplicateRun).toHaveBeenCalledTimes(1);
    expect(ignoredRun).not.toHaveBeenCalled();
  });

  it("keeps a shared task when only one subscriber aborts", async () => {
    const scheduler = new RenderScheduler<string>();
    const controller = new AbortController();
    const result = deferred<string>();
    const run = vi.fn(() => result.promise);

    const cancelled = scheduler.schedule("document:0", "page", "visible", run, controller.signal);
    const retained = scheduler.schedule("document:0", "page", "visible", run);
    await flushScheduler();
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    result.resolve("page");
    await expect(retained).resolves.toBe("page");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("removes an unobserved queued task when its final subscriber aborts", async () => {
    const scheduler = new RenderScheduler<string>();
    const active = deferred<string>();
    const controller = new AbortController();
    const queuedRun = vi.fn(async () => "queued");

    const blocker = scheduler.schedule("document:0", "active", "visible", () => active.promise);
    const queued = scheduler.schedule("document:0", "queued", "thumbnail", queuedRun, controller.signal);
    await flushScheduler();
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(scheduler.snapshot()).toMatchObject({ queued: 0, cancelled: 1 });
    active.resolve("active");
    await blocker;
    expect(queuedRun).not.toHaveBeenCalled();
  });

  it("invalidates queued and active subscribers without starting a second task", async () => {
    const scheduler = new RenderScheduler<string>();
    const active = deferred<string>();
    const queuedRun = vi.fn(async () => "queued");
    const activeResult = scheduler.schedule("document:0", "active", "visible", () => active.promise);
    const queuedResult = scheduler.schedule("document:0", "queued", "thumbnail", queuedRun);
    await flushScheduler();

    scheduler.cancelAll(new Error("document changed"));
    const replacementRun = vi.fn(async () => "replacement");
    const replacement = scheduler.schedule("document:1", "replacement", "visible", replacementRun);
    await flushScheduler();
    await expect(activeResult).rejects.toThrow("document changed");
    await expect(queuedResult).rejects.toThrow("document changed");
    expect(scheduler.snapshot()).toMatchObject({ active: 1, queued: 1, cancelled: 2 });
    expect(replacementRun).not.toHaveBeenCalled();

    active.resolve("stale");
    await expect(replacement).resolves.toBe("replacement");
    expect(queuedRun).not.toHaveBeenCalled();
    expect(replacementRun).toHaveBeenCalledTimes(1);
    expect(scheduler.snapshot()).toMatchObject({ active: 0, completed: 2 });
  });

  it("retires the previous render scope after a committed lifecycle transition", async () => {
    const scheduler = new RenderScheduler<string>();
    const active = deferred<string>();
    const staleRun = vi.fn(() => active.promise);
    const lateOldRun = vi.fn(async () => "late old page");

    const stale = scheduler.schedule("document:0", "active", "visible", staleRun);
    await flushScheduler();
    const transition = scheduler.beginTransition();
    const lateOld = scheduler.schedule("document:0", "late", "visible", lateOldRun);
    transition.complete(true);

    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await expect(lateOld).rejects.toMatchObject({ name: "AbortError" });
    expect(lateOldRun).not.toHaveBeenCalled();

    const replacementRun = vi.fn(async () => "new page");
    const replacement = scheduler.schedule("document:1", "active", "visible", replacementRun);
    await flushScheduler();
    expect(replacementRun).not.toHaveBeenCalled();

    active.resolve("stale page");
    await expect(replacement).resolves.toBe("new page");
    expect(staleRun).toHaveBeenCalledTimes(1);
    expect(replacementRun).toHaveBeenCalledTimes(1);
  });

  it("retries the previous render scope after a rolled-back lifecycle transition", async () => {
    const scheduler = new RenderScheduler<string>();
    const active = deferred<string>();
    const render = vi.fn(() => render.mock.calls.length === 1
      ? active.promise
      : Promise.resolve("restored page"));

    const result = scheduler.schedule("document:0", "page", "visible", render);
    await flushScheduler();
    const transition = scheduler.beginTransition();
    transition.complete(false);
    active.resolve("cancelled physical render");

    await expect(result).resolves.toBe("restored page");
    expect(render).toHaveBeenCalledTimes(2);
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0, completed: 2 });
  });
});
