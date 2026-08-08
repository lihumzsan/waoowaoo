# Codex 与 ComfyUI Provider 收敛设计

## 目标

将项目的媒体生成能力收敛为两个 Provider：

- Codex：负责文本生成和图片生成。
- ComfyUI：负责视频、音频和语音生成。

项目最终不再使用 Ark、OpenRouter、FAL、Google、Mureka 和 Toonflow。

## 已确认的能力边界

| 能力 | 唯一 Provider |
| --- | --- |
| 文本 | Codex |
| 图片 | Codex |
| 视频 | ComfyUI |
| 音频 | ComfyUI |
| 语音 | ComfyUI |

Codex 已升级，图片生成能力可用。本项目不重新开发 Codex 生图，只负责正确路由请求、传递输入和保存结果。

ComfyUI 的图片节点可以作为某些视频工作流的内部依赖，但不作为用户可选择的图片 Provider。

## 架构方案

继续使用当前项目的统一 Provider 注册、能力声明和执行引擎。用户提交任务后，系统根据能力自动选择 Provider：

```text
文本 / 图片  -> Codex Runtime -> 统一结果格式
视频         -> ComfyUI      -> 统一结果格式
音频 / 语音  -> ComfyUI      -> 统一结果格式
```

Codex 使用当前分支已有的 Runtime 和模型网关，只移除旧的 OpenRouter 约束及不再需要的 Provider 分支。

ComfyUI 从 `main` 分支选择性移植客户端、工作流注册、任务提交、状态查询、结果下载和媒体结果提取逻辑，接入当前分支的统一执行引擎。不会把 `main` 的旧 Generator/API Config 体系整体合并进来。

## ComfyUI 地址配置

ComfyUI 服务地址必须从服务端环境变量读取，统一变量名为：

```env
COMFYUI_BASE_URL=http://127.0.0.1:8188
```

约束如下：

1. 代码中不得写死 ComfyUI 主机、端口或完整地址。
2. 只有服务端读取该变量，客户端不暴露该地址配置。
3. 启动或首次调用时校验它是合法的 HTTP/HTTPS URL。
4. 调用时基于该地址拼接 ComfyUI 的 API 路径。
5. 未配置或格式错误时返回明确的配置错误，不发起网络请求。
6. `.env.example` 和部署示例必须包含该变量；实际密钥和本地地址仍放在未提交的环境文件中。

## Provider 清理范围

需要从 Provider 注册、模型目录、能力映射、配置界面和执行路由中移除：

- Ark
- OpenRouter
- FAL
- Google
- Mureka
- Toonflow

同时删除仅被这些 Provider 使用的依赖和配置读取逻辑。数据库中的历史 API 密钥不在本次范围内物理删除；本次只保证它们不再被读取、展示或调用。

## 错误处理

所有 Provider 都要转换为统一的任务错误格式，至少区分：

- Provider 未配置
- 环境变量缺失或 URL 非法
- 请求发送失败
- Provider 返回失败状态
- 任务超时
- 任务完成但没有可用结果

错误信息需要包含可定位的错误码和用户可读提示，但不能泄露 API 密钥、完整请求体或敏感环境变量内容。

## 分阶段实施

### 阶段一：Provider 收敛

- 固定 Codex 和 ComfyUI 的能力声明。
- 删除六个旧 Provider 的注册、模型和配置入口。
- 保证用户界面只出现 Codex 和 ComfyUI。

### 阶段二：Codex 验证

- 保留当前 Codex Runtime 的文本调用。
- 修正旧 OpenRouter 专属判断，使 Codex 作为独立 Provider 工作。
- 验证文本和图片任务都能返回统一媒体结果。

### 阶段三：ComfyUI 接入

- 增加 `COMFYUI_BASE_URL` 配置读取和校验。
- 移植视频工作流和音频/语音工作流。
- 接入任务提交、轮询、超时和结果下载。
- 将结果转换为当前项目统一格式。

### 阶段四：清理和回归

- 删除旧 Provider 的无用依赖。
- 更新环境变量示例和部署文档。
- 执行文本、图片、视频、音频和语音的真实验证。
- 验证旧 Provider 不再显示、不再调用。

## 验收标准

本设计完成后，需要满足：

1. 文字请求只调用 Codex。
2. 图片请求只调用 Codex。
3. 视频请求只调用 ComfyUI。
4. 音频和语音请求只调用 ComfyUI。
5. 修改 `COMFYUI_BASE_URL` 后，服务无需改代码即可切换 ComfyUI 地址。
6. ComfyUI 地址缺失或非法时，系统给出明确错误。
7. Ark、OpenRouter、FAL、Google、Mureka 和 Toonflow 不再出现在配置界面和可用模型列表。
8. 旧 Provider 不会被任务路由或后台默认配置重新启用。
9. Codex 图片生成使用升级后的能力，不新增第二套图片生成链路。

## 不在本次范围内

- 删除数据库中的历史 API 密钥。
- 重写 Codex Runtime。
- 将 ComfyUI 图片生成开放给用户。
- 整体合并 `main` 分支的旧 Provider 架构。
- 新增新的模型市场、计费体系或工作流编辑器。
