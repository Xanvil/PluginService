/**
 * 鉴权：推送与管理页共用 NUGET_API_KEY。
 */

import type { Env } from "./types";

/**
 * 断言请求具备推送 / 管理权限。
 * 从 `X-NuGet-ApiKey` 读取密钥，与 `NUGET_API_KEY` 做近似常量时间比较。
 * @returns 通过时无返回值；失败时抛出带 status 的 Error（401 / 500）
 */
export function assertPushAuthorized(request: Request, env: Env): void {
  const provided = request.headers.get("X-NuGet-ApiKey") ?? "";
  const expected = env.NUGET_API_KEY ?? "";

  if (!expected) {
    const err = new Error("Server API key is not configured");
    (err as Error & { status: number }).status = 500;
    throw err;
  }

  if (!provided || !timingSafeEqualString(provided, expected)) {
    const err = new Error("Invalid API key");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
}

/**
 * 管理页鉴权（与 CLI 推送同一密钥 / 同一请求头）。
 * 等价于 `assertPushAuthorized`。
 */
export function assertAdminAuthorized(request: Request, env: Env): void {
  assertPushAuthorized(request, env);
}

/**
 * 字符串近似常量时间比较（长度不同时仍做一轮循环，降低长度侧信道）。
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  const len = Math.max(aBuf.length, bBuf.length);
  let diff = aBuf.length ^ bBuf.length;

  for (let i = 0; i < len; i++) {
    const av = i < aBuf.length ? aBuf[i]! : 0;
    const bv = i < bBuf.length ? bBuf[i]! : 0;
    diff |= av ^ bv;
  }

  return diff === 0;
}
