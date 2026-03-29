import { SamsaraPaginatedResponse, SamsaraErrorResponse } from "./types.js";

export class SamsaraClient {
  private baseUrl: string;
  private token: string;

  constructor(token: string, baseUrl = "https://api.samsara.com") {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private buildUrl(path: string, params?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(method: string, path: string, options?: {
    params?: Record<string, string | undefined>;
    body?: unknown;
  }): Promise<T> {
    const url = this.buildUrl(path, options?.params);
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let errorMsg: string;
      try {
        const errorBody = (await response.json()) as SamsaraErrorResponse;
        errorMsg = errorBody.message || `HTTP ${response.status} ${response.statusText}`;
        if (errorBody.requestId) {
          errorMsg += ` (requestId: ${errorBody.requestId})`;
        }
      } catch {
        errorMsg = `HTTP ${response.status} ${response.statusText}`;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        errorMsg += retryAfter ? ` - Rate limited, retry after ${retryAfter}s` : " - Rate limited";
      }

      throw new Error(errorMsg);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  async get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  async getAllPages<T>(
    path: string,
    params?: Record<string, string | undefined>,
    maxPages = 10,
  ): Promise<T[]> {
    const allData: T[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    while (pageCount < maxPages) {
      const queryParams = { ...params, ...(cursor ? { after: cursor } : {}) };
      const response = await this.get<SamsaraPaginatedResponse<T>>(path, queryParams);

      if (response.data) {
        allData.push(...response.data);
      }

      const hasNextPage = response.pagination?.hasNextPage ?? false;
      cursor = response.pagination?.endCursor;
      pageCount++;

      if (!hasNextPage || !cursor) {
        break;
      }
    }

    return allData;
  }
}
