import type { RunLog } from "./scraper-api";

const WS_URL = process.env.NEXT_PUBLIC_SCRAPER_WS_URL || "ws://localhost:8000";

export function createLogSocket(
  runId: string,
  onMessage: (log: RunLog) => void,
  onDone: (status: string) => void
): WebSocket {
  const ws = new WebSocket(`${WS_URL}/ws/logs/${runId}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "done") {
      onDone(data.status);
    } else {
      onMessage(data as RunLog);
    }
  };

  ws.onerror = () => {
    onDone("failed");
  };

  return ws;
}

export type { RunLog };
