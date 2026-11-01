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
  const message = e instanceof Error ? e.message : "请求未完成，请稍后再试。";
  if (/local preview/i.test(message))
    return "本地试用版仅支持你电脑上的 Ollama，不含云端 AI、支付或商业授权服务。";
  if (/failed to fetch|networkerror|load failed/i.test(message))
    return "无法连接本机应用服务。请重新打开应用，或检查工作区是否已连接。";
  if (/license|entitlement|subscription|activate/i.test(message))
    return "此功能需要有效设备授权。请到“订阅与用量”检查激活状态，或联系企业管理员。";
  if (/consent/i.test(message))
    return "需要你同意本次消息使用云端 AI。勾选同意后再试；私密资料请选择本地模式。";
  if (/benchmark|ollama|local model/i.test(message))
    return "本地 AI 尚未就绪。请先启动 Ollama、准备配置的模型，再到“AI 与隐私设置”检查或测速。";
  if (/unauthorized|invalid.*token/i.test(message))
    return "工作区连接已失效，请重新打开应用后再试。";
  if (/budget|credit|spending|quota/i.test(message))
    return "当前可用额度或任务预算不足。请在“订阅与用量”及“AI 与隐私设置”中查看限制。";
  if (/Request validation failed/i.test(message))
    return "填写的资料未通过检查。请确认必填项、数值范围，以及服务地址是否为不含密钥的公开 HTTPS 网址。";
  return message;
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
