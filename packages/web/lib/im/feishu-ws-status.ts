export type FeishuWSStatus = {
  running: boolean;
  startedAt?: string;
  lastError?: string;
  /** Consecutive automatic reconnect attempts scheduled since the last successful start. */
  reconnectAttempts?: number;
  /** ISO timestamp of the pending automatic reconnect attempt, if one is scheduled. */
  nextRetryAt?: string;
};

let status: FeishuWSStatus = {
  running: false,
};

export function getFeishuWSClientStatus(): FeishuWSStatus {
  return { ...status };
}

export function setFeishuWSClientStatus(nextStatus: FeishuWSStatus): void {
  status = { ...nextStatus };
}

export function __resetFeishuWSClientStatusForTests(): void {
  status = {
    running: false,
  };
}
