export type API = <T = unknown>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export class APIError extends Error {
  constructor(message: string, public code = "", public mode = "", public model = "", public providerStatus?: number) {
    super(message); this.name = "APIError";
  }
}
const providerMessages: Record<string, [string, string]> = {
  AI_CLOUD_CHECK_TIMEOUT: ["查询云端模型列表超时。请检查网络与 API 服务地址；本次没有发起生成回答。", "Cloud model-list check timed out. Check the network and API URL; no answer generation was requested."],
  AI_CLOUD_CHECK_RESPONSE: ["模型列表接口没有返回预期资料，无法验证此连接。请检查地址；有些兼容服务不支持这个检查接口。", "Model-list endpoint returned an unexpected response. Check the URL; some compatible providers do not support this check."],
  AI_CLOUD_AUTH: ["云端拒绝了 API Key（无效、已过期或没有使用权限）。请确认密钥属于当前服务商，并在 AI 设置重新测试。", "Cloud API key rejected: invalid, expired or missing permission. Check that the key belongs to the selected provider and test it in AI settings."],
  AI_CLOUD_BALANCE: ["云端返回余额或计费问题（HTTP 402）。请到 AI 服务商账户检查 API 余额与计费状态；软件里的预算不是服务商余额。", "Cloud provider reported a billing or balance issue (HTTP 402). Check your API account balance and billing. The app budget is not your provider balance."],
  AI_CLOUD_NOT_FOUND: ["找不到云端接口或模型（HTTP 404）。请核对 AI 服务地址和准确模型名称。", "Cloud endpoint or model not found (HTTP 404). Check the provider URL and exact model name."],
  AI_CLOUD_RATE_LIMIT: ["云端暂时限制请求（HTTP 429），可能是请求频率或账户额度限制。请检查服务商用量，稍后由你决定是否重试。", "Cloud provider rate or quota limit (HTTP 429). Check provider usage and decide whether to retry later."],
  AI_CLOUD_SERVER: ["云端服务暂时出错。请稍后检查服务商状态；没有自动重试或更换服务商。", "Cloud provider reported a service error. Check its status; no retry or provider change was attempted."],
  AI_CLOUD_REQUEST: ["云端拒绝了请求。请核对服务地址、模型名称和该模型支持的参数。", "Cloud provider rejected the request. Check the URL, model and supported parameters."],
  AI_CLOUD_TIMEOUT: ["等待云端回答超时。请求可能已经被服务商处理，请先检查服务商用量再决定是否重试。", "Cloud response timed out. The provider may have processed the request; check its usage before retrying."],
  AI_CLOUD_NETWORK: ["无法连接云端 AI。请检查网络、代理和 API 服务地址；这次没有切换到本地模型。", "Cannot reach cloud AI. Check the network, proxy and provider URL. No local fallback was attempted."],
  AI_CLOUD_RESPONSE: ["云端没有返回可用的文字回答。请核对是否使用 OpenAI 兼容的文字聊天接口及支持的模型。", "Cloud returned no usable text answer. Check that the endpoint and model support OpenAI-compatible text chat."],
  AI_LOCAL_OFFLINE: ["无法连接这台电脑上的 Ollama。请启动 Ollama；如果你要使用已填写的 API Key，请把处理方式选为云端 AI。", "Cannot reach local Ollama. Start Ollama, or select Cloud AI to use your configured API key."],
  AI_LOCAL_MODEL_MISSING: ["Ollama 找不到配置的模型或接口（HTTP 404）。请到 AI 设置选择已安装的准确模型名称。", "Ollama model or endpoint not found (HTTP 404). Select an installed model with its exact name in AI settings."],
  AI_LOCAL_TIMEOUT: ["本机 Ollama 回答超时。模型可能还在加载或硬件不足，请检查 Ollama 状态。", "Local Ollama timed out. The model may be loading or exceeding hardware capacity; check Ollama."],
  AI_LOCAL_SERVER: ["本机 Ollama 返回错误。请检查模型加载情况和 Ollama 日志；可能需要更小的模型。", "Local Ollama returned an error. Check model loading and Ollama logs; a smaller model may be needed."],
  AI_LOCAL_RESPONSE: ["本机 Ollama 没有返回可用的文字回答。请检查模型是否支持文字聊天。", "Local Ollama returned no usable text answer. Check that the model supports text chat."],
};
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
    if (!response.ok) {
      const detail = data.detail;
      if (detail && typeof detail === "object" && typeof detail.code === "string" && detail.code in providerMessages)
        throw new APIError(typeof detail.message === "string" ? detail.message : "AI request failed", detail.code, typeof detail.mode === "string" ? detail.mode : "", typeof detail.model === "string" ? detail.model : "", typeof detail.provider_status === "number" ? detail.provider_status : undefined);
      throw new Error(typeof detail === "string" ? detail : "Request validation failed");
    }
    return data as T;
  };
}
export function errorText(e: unknown, language: "zh" | "en" = "zh") {
  if (e instanceof APIError && providerMessages[e.code]) return providerMessages[e.code][language === "en" ? 1 : 0];
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
