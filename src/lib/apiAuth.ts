import { auth } from "../lib/firebase";

/**
 * Builds authenticated headers for protected backend API requests.
 * Attaches the Firebase ID Bearer token (when authenticated) and active preview token if present.
 */
export async function getApiAuthHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };

  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.warn("[apiAuth] Could not obtain Firebase ID token:", err);
    }
  }

  if (typeof window !== "undefined") {
    const previewToken = window.localStorage.getItem("brokr_preview_token");
    if (previewToken) {
      headers["x-preview-token"] = previewToken;
    }
  }

  return headers;
}
