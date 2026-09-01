import { authFetch, type AuthSession, type RuntimeConfig } from "./auth";

export type AdminUpload = {
  id: string;
  filename: string;
  status: string;
  statusDetail: string;
  progressCompleted: number;
  progressTotal: number;
  updatedAt: string;
};

export type AdminUser = {
  subject: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "rejected";
  role: "user" | "admin";
  phase: string;
  createdAt: string;
  updatedAt: string;
  uploads: number;
  uploadedBytes: number;
  latestUpload: AdminUpload | null;
  datasets: number;
  datasetId: string | null;
  activityCount: number;
  publishedUrl: string | null;
  mapUrl: string | null;
  publishedViews: number;
};

export async function listAdminUsers(config: RuntimeConfig, session: AuthSession): Promise<AdminUser[]> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/me?admin=users`, { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "Admin access required." : "Could not load users.");
  const body = await response.json() as { users: AdminUser[] };
  return body.users;
}

export async function setAdminUserAccess(config: RuntimeConfig, session: AuthSession, subject: string, status: AdminUser["status"]): Promise<void> {
  const response = await authFetch(config, session, `${config.apiUrl}/api/published?admin=access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject, status }),
  });
  if (!response.ok) throw new Error("Could not update user access.");
}
