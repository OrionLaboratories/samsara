export interface SamsaraPaginatedResponse<T> {
  data: T[];
  pagination?: {
    endCursor?: string;
    hasNextPage?: boolean;
  };
}

export interface SamsaraSingleResponse<T> {
  data: T;
}

export interface SamsaraErrorResponse {
  message?: string;
  requestId?: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
