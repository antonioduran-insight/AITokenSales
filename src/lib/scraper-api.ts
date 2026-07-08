const API_URL = "/api/scraper";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// Valid backend routes: GET /health, POST /runs, GET /runs/{id}, GET /runs/{id}/logs, DELETE /runs/{id}
export const scraperApi = {
  get:    <T>(path: string)                => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: "POST",   body: JSON.stringify(body) }),
  delete: <T>(path: string)               => request<T>(path, { method: "DELETE" }),
};

export type RunStatus = "pending" | "running" | "scoring" | "drafting" | "completed" | "failed" | "cancelled";

export interface Lead {
  id: string;
  run_id: string;
  sdr_id?: string;
  linkedin_url?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  title?: string;
  industry?: string;
  company_size?: string;
  location?: string;
  email?: string;
  icp_score?: number;
  temperature?: "HOT" | "WARM" | "COLD";
  market?: string;
  search_combo?: string;
  custom1?: string;
  custom2?: string;
  exported_to_crm: boolean;
  created_at: string;
}

export interface RunLog {
  id: string;
  run_id: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
  created_at: string;
}
