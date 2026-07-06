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

export const scraperApi = {
  get:    <T>(path: string)                => request<T>(path),
  post:   <T>(path: string, body: unknown) => request<T>(path, { method: "POST",   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH",  body: JSON.stringify(body) }),
  delete: <T>(path: string)               => request<T>(path, { method: "DELETE" }),
};

export const SCRAPER_API_URL = process.env.NEXT_PUBLIC_SCRAPER_API_URL || "http://localhost:8000";

export type RunStatus = "pending" | "running" | "scoring" | "drafting" | "completed" | "failed" | "cancelled";

export interface Run {
  id: string;
  combos: string[];
  market: string;
  limit_per_combo: number;
  status: RunStatus;
  total_leads: number;
  hot_count: number;
  warm_count: number;
  cold_count: number;
  error_message?: string;
  output_csv_path?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface Lead {
  id: string;
  run_id: string;
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
