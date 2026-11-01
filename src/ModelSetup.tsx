import { useEffect, useState } from "react";
import { errorText, type API } from "./api";
import { Icon } from "./Icon";
type Models = { local_model: string; cloud_model: string; cloud_url: string };
export function ModelSetup({
  api,
  onSaved,
}: {
  api: API;
  onSaved: () => Promise<void>;
}) {
  const [models, setModels] = useState<Models>({
    local_model: "llama3.2:3b",
    cloud_model: "",
    cloud_url: "https://api.openai.com/v1",
  });
  const [installed, setInstalled] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<Models>("/settings/models")
      .then((m) => {
        if (active) setModels(m);
      })
      .catch((e) => {
        if (active) setStatus(errorText(e));
      });
    api<{ models: string[] }>("/hardware")
      .then((h) => {
        if (active) setInstalled(h.models);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <div className="model-setup">
      <div className="feature-guide">
        <Icon name="sparkle" />
        <div>
          <strong>让 AI 开始工作的两种方式</strong>
          <p>
            本地：安装并启动
            Ollama，准备模型，保存模型名后测速。云端：填写你使用的模型与服务地址，保存密钥并确认价格与使用许可。不会自动下载模型或发起付费推理。
          </p>
        </div>
      </div>
      <h2>模型配置</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setStatus("");
          try {
            await api("/settings/models", "PUT", models);
            await onSaved();
            setStatus(
              "模型配置已保存。更换本地模型后请重新测速；更换云端模型或服务后请重新确认价格与许可。",
            );
          } catch (e) {
            setStatus(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="row">
            <label>
              本地 Ollama 模型名称
              <input
                aria-label="本地 Ollama 模型名称"
                required
                value={models.local_model}
                onChange={(e) =>
                  setModels({ ...models, local_model: e.target.value })
                }
                list="installed-models"
                maxLength={200}
                placeholder="例如 llama3.2:3b"
              />
              <datalist id="installed-models">
                {installed.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <small>
                {installed.length
                  ? `检测到 ${installed.length} 个模型，可从列表选择。`
                  : "未检测到本地模型。保存名称不会安装或下载模型。"}
              </small>
            </label>
            <label>
              云端模型名称
              <input
                aria-label="云端模型名称"
                value={models.cloud_model}
                onChange={(e) =>
                  setModels({ ...models, cloud_model: e.target.value })
                }
                maxLength={200}
                placeholder="填写服务商提供的准确模型 ID"
              />
              <small>留空表示尚未配置自有密钥的云端模型。</small>
            </label>
          </div>
          <label>
            OpenAI 兼容服务地址（HTTPS）
            <input
              type="url"
              required
              value={models.cloud_url}
              onChange={(e) =>
                setModels({ ...models, cloud_url: e.target.value })
              }
              maxLength={2000}
            />
            <small>
              填写公开 HTTPS API 根路径，不要把 API
              密钥放进网址。使用公司额度网关时，由管理员配置受信服务。
            </small>
          </label>
          <button>保存模型配置</button>
        </fieldset>
      </form>
      {status && <p role="status">{status}</p>}
    </div>
  );
}
