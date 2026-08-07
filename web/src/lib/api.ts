import { z } from "zod";

type ApiOptions<T = unknown> = RequestInit & {
  schema?: z.ZodType<T>;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions<T> = {}
): Promise<T> {
  const { schema, headers, ...rest } = options;
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      ...(rest.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...rest,
  });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  if (schema) {
    return schema.parse(data);
  }
  return data as T;
}

export const apiJson = {
  get: <T>(path: string, schema?: z.ZodType<T>) =>
    api<T>(path, { method: "GET", schema }),
  post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) =>
    api<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      schema,
    }),
  put: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) =>
    api<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
      schema,
    }),
  delete: <T>(path: string, schema?: z.ZodType<T>) =>
    api<T>(path, { method: "DELETE", schema }),
};
