import { describe, expect, it } from "vitest";
import { StandbyClientPool } from "./standby-client-pool";

class FakeClient {
  terminated = false;

  terminate(): void {
    this.terminated = true;
  }
}

describe("StandbyClientPool", () => {
  it("recreates a live standby client after a Strict Mode cleanup cycle", () => {
    const created: FakeClient[] = [];
    const pool = new StandbyClientPool(() => {
      const client = new FakeClient();
      created.push(client);
      return client;
    });

    pool.start();
    pool.stop();
    pool.start();
    const client = pool.take();

    expect(created).toHaveLength(3);
    expect(created[0].terminated).toBe(true);
    expect(client).toBe(created[1]);
    expect(client.terminated).toBe(false);
    expect(created[2].terminated).toBe(false);

    pool.stop();
    expect(created[2].terminated).toBe(true);
  });
});
