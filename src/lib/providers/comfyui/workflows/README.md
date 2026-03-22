# ComfyUI 工作流（API 格式）

网站提交的是 ComfyUI **`/prompt` API 格式**（每个节点为 `"id": { "class_type", "inputs" }`），**不是**界面里「Save」导出的带 `nodes` / `links` 的 JSON。

## 已内置：Qwen 文生图

- **`qwen-image-txt2img.json`**：由用户工作流「🥨Qwen 千问开源…」转换而来（UNET + CLIP + VAE + Lightning LoRA + KSampler 等），模型路径为 ComfyUI 默认的 `qwen\...` 相对名。
- **`qwen-image-txt2img.meta.json`**：把产品里的**提示词**写入节点 `67`（CR Text），**宽高**写入 `70`/`71`（ImpactInt → EmptySD3LatentImage）。

若你本机模型文件名或子目录与 JSON 中不一致，请直接改 JSON 里对应 `unet_name` / `clip_name` / `vae_name` / `lora_name` 字符串。

## 自定义工作流

1. 在 ComfyUI 中 **Export (API)** 得到 API 格式 JSON，保存为  
   `src/lib/providers/comfyui/workflows/<工作流标识>.json`
2. 在 **API 配置** 里添加图片模型，**模型 ID** = `<工作流标识>`（不要 `.json`）。
3. 需要注入提示词或宽高时，增加同名的 **`<工作流标识>.meta.json`**，例如：

```json
{
  "positivePrompt": { "nodeId": "6", "field": "text" },
  "negativePrompt": { "nodeId": "7", "field": "text" },
  "latentWidth": { "nodeId": "70", "field": "value" },
  "latentHeight": { "nodeId": "71", "field": "value" }
}
```

未在 meta 中声明的字段不会改写，完全以 JSON 为准。

## 从界面 JSON 转为 API 格式

若只有 `nodes`/`links` 文件，请在 ComfyUI 里打开该工作流后使用 **Export (API)**，或自行对照节点与连线改写为 API 图。

## 视频

见预设 `comfyui-video`：在 `workflows/comfyui-video.json` 放置 API 格式工作流（或改用你的标识并同步模型 ID）。

修改文件后请 **重启** `npm run dev` / Worker，以便重新读取磁盘上的 JSON。
