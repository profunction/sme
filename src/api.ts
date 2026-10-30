export type API = <T = unknown>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export function apiFor(token: string): API {
  return async <T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const response = await fetch(`http://127.0.0.1:8765${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Request validation failed",
      );
    return data as T;
  };
}
export function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Request failed";
}

declare global {
  interface Window {
    nightbrew?: {
      session: () => Promise<{ token: string; version: string }>;
      checkForUpdates: () => Promise<{ status: string }>;
      installUpdate: () => Promise<{ status: string }>;
    };
  }
}
