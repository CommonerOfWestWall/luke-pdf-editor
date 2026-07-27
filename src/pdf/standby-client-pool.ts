export interface TerminableClient {
  terminate(): void;
}

export class StandbyClientPool<T extends TerminableClient> {
  private standby: T | null = null;

  constructor(private readonly createClient: () => T) {}

  start(): void {
    this.standby ??= this.createClient();
  }

  take(): T {
    const client = this.standby ?? this.createClient();
    this.standby = null;
    try {
      this.standby = this.createClient();
      return client;
    } catch (error) {
      client.terminate();
      throw error;
    }
  }

  stop(): void {
    this.standby?.terminate();
    this.standby = null;
  }
}
