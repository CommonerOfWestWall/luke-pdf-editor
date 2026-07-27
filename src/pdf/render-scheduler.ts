export type RenderPriority = "visible" | "buffer" | "thumbnail";

export interface RenderSchedulerStats {
  queued: number;
  active: number;
  completed: number;
  merged: number;
  cancelled: number;
}

interface Subscriber<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  settled: boolean;
}

interface RenderTask<T> {
  key: string;
  priority: RenderPriority;
  sequence: number;
  run: () => Promise<T>;
  subscribers: Set<Subscriber<T>>;
  state: "queued" | "active";
}

interface RenderTransitionState {
  previousScope: string | null;
  promise: Promise<boolean>;
  resolve: (committed: boolean) => void;
}

export interface RenderTransition {
  complete(committed: boolean): void;
}

const PRIORITY_RANK: Record<RenderPriority, number> = {
  visible: 0,
  buffer: 1,
  thumbnail: 2,
};

function abortError(message = "页面渲染已取消"): DOMException {
  return new DOMException(message, "AbortError");
}

export function isRenderAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export class RenderScheduler<T> {
  private readonly tasks = new Map<string, RenderTask<T>>();
  private queue: RenderTask<T>[] = [];
  private activeTask: RenderTask<T> | null = null;
  private nextSequence = 0;
  private completed = 0;
  private merged = 0;
  private cancelled = 0;
  private activeScope: string | null = null;
  private readonly retiredScopes = new Set<string>();
  private transition: RenderTransitionState | null = null;

  async schedule(
    scope: string,
    key: string,
    priority: RenderPriority,
    run: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const taskKey = `${scope}\u0000${key}`;
    while (true) {
      if (signal?.aborted) throw abortError();
      const transition = this.transition;
      if (transition) await transition.promise;
      if (signal?.aborted) throw abortError();
      if (this.retiredScopes.has(scope)) throw abortError("页面渲染作用域已失效");
      if (this.activeScope === null) this.activeScope = scope;
      if (this.activeScope !== scope) throw abortError("页面渲染作用域已失效");

      try {
        return await this.enqueue(taskKey, priority, run, signal);
      } catch (error) {
        if (!isRenderAbortError(error) || signal?.aborted) throw error;
        const pendingTransition = this.transition;
        if (pendingTransition) await pendingTransition.promise;
        if (this.retiredScopes.has(scope) || this.activeScope !== scope) throw error;
      }
    }
  }

  beginTransition(reason: Error = abortError("PDF 渲染状态正在切换")): RenderTransition {
    if (this.transition) throw new Error("PDF 渲染状态切换尚未完成");
    let resolve!: (committed: boolean) => void;
    const state: RenderTransitionState = {
      previousScope: this.activeScope,
      promise: new Promise<boolean>((nextResolve) => { resolve = nextResolve; }),
      resolve: (committed) => resolve(committed),
    };
    this.transition = state;
    this.cancelPending(reason);

    return {
      complete: (committed) => {
        if (this.transition !== state) return;
        if (committed) {
          if (state.previousScope !== null) this.retiredScopes.add(state.previousScope);
          this.activeScope = null;
        } else {
          this.activeScope = state.previousScope;
        }
        this.transition = null;
        state.resolve(committed);
      },
    };
  }

  cancelAll(reason: Error = abortError("页面渲染队列已失效")): void {
    if (this.activeScope !== null) this.retiredScopes.add(this.activeScope);
    const transition = this.transition;
    if (transition && transition.previousScope !== null) {
      this.retiredScopes.add(transition.previousScope);
    }
    this.activeScope = null;
    this.transition = null;
    this.cancelPending(reason);
    transition?.resolve(true);
  }

  snapshot(): RenderSchedulerStats {
    return {
      queued: this.queue.length,
      active: this.activeTask ? 1 : 0,
      completed: this.completed,
      merged: this.merged,
      cancelled: this.cancelled,
    };
  }

  private enqueue(
    key: string,
    priority: RenderPriority,
    run: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());

    let task = this.tasks.get(key);
    let created = false;
    if (task) {
      this.merged += 1;
      if (task.state === "queued" && PRIORITY_RANK[priority] < PRIORITY_RANK[task.priority]) {
        task.priority = priority;
        this.sortQueue();
      }
    } else {
      task = {
        key,
        priority,
        sequence: this.nextSequence++,
        run,
        subscribers: new Set(),
        state: "queued",
      };
      this.tasks.set(key, task);
      this.queue.push(task);
      this.sortQueue();
      created = true;
    }

    const result = new Promise<T>((resolve, reject) => {
      const subscriber: Subscriber<T> = { resolve, reject, signal, settled: false };
      subscriber.abortListener = () => {
        if (subscriber.settled) return;
        this.settleSubscriber(subscriber, "reject", abortError());
        task.subscribers.delete(subscriber);
        this.cancelled += 1;
        this.removeUnobservedQueuedTask(task);
      };
      task.subscribers.add(subscriber);
      signal?.addEventListener("abort", subscriber.abortListener, { once: true });
    });

    if (created) queueMicrotask(() => this.pump());
    return result;
  }

  private cancelPending(reason: Error): void {
    for (const task of this.queue) {
      this.rejectSubscribers(task, reason, true);
      if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
    }
    this.queue = [];

    if (this.activeTask) {
      this.rejectSubscribers(this.activeTask, reason, true);
      if (this.tasks.get(this.activeTask.key) === this.activeTask) {
        this.tasks.delete(this.activeTask.key);
      }
    }
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => (
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      || left.sequence - right.sequence
    ));
  }

  private pump(): void {
    if (this.activeTask) return;
    const task = this.queue.shift();
    if (!task) return;
    if (task.subscribers.size === 0) {
      if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
      this.pump();
      return;
    }

    task.state = "active";
    this.activeTask = task;
    void Promise.resolve()
      .then(task.run)
      .then(
        (value) => this.finishTask(task, "resolve", value),
        (error: unknown) => this.finishTask(task, "reject", error),
      );
  }

  private finishTask(task: RenderTask<T>, outcome: "resolve" | "reject", value: unknown): void {
    for (const subscriber of task.subscribers) {
      this.settleSubscriber(subscriber, outcome, value);
    }
    task.subscribers.clear();
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
    if (this.activeTask === task) this.activeTask = null;
    this.completed += 1;
    this.pump();
  }

  private rejectSubscribers(task: RenderTask<T>, reason: unknown, countAsCancelled: boolean): void {
    for (const subscriber of task.subscribers) {
      if (subscriber.settled) continue;
      this.settleSubscriber(subscriber, "reject", reason);
      if (countAsCancelled) this.cancelled += 1;
    }
    task.subscribers.clear();
  }

  private settleSubscriber(
    subscriber: Subscriber<T>,
    outcome: "resolve" | "reject",
    value: unknown,
  ): void {
    if (subscriber.settled) return;
    subscriber.settled = true;
    if (subscriber.abortListener) {
      subscriber.signal?.removeEventListener("abort", subscriber.abortListener);
    }
    if (outcome === "resolve") subscriber.resolve(value as T);
    else subscriber.reject(value);
  }

  private removeUnobservedQueuedTask(task: RenderTask<T>): void {
    if (task.state !== "queued" || task.subscribers.size > 0) return;
    this.queue = this.queue.filter((candidate) => candidate !== task);
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
  }
}
