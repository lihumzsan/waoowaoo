# 剪映接入与跨机器交接

这是本功能的操作入口。另一台电脑拉取包含本功能的代码后，从本文件开始即可继续；操作步骤和必需材料均在仓库中，无需依赖之前的聊天、本机绝对路径或交接 ZIP。

执行顺序：**确认代码与环境 → 独立 Codex 小样 → 剪映原生验证 → Wao 聊天验证 → 记录结果**。最终使用入口是 Wao 聊天；独立 Codex 小样用于先确认目标机器的剪映工程能力。

## 当前交付状态

已实现视频排序与裁切、绑定片段的角色姓名/身份说明、文字渐入渐出，以及可编辑剪映工程 ZIP 导出。Wao 负责解析精确 Resource 版本并通过原有 Task/Resource 链路交付；用户不需要复制 Resource ID 给外部 Codex。

| 项目 | 已有证据 / 待验证 |
| --- | --- |
| 类型与接线 | `typecheck`、94 项 conformance、ESLint 已通过 |
| 时间与实际编码 | 7 项时间/画幅逻辑、3 项真实视频轨验证已通过；覆盖累计帧取整、帧间裁切及尾帧 |
| 工程结构与文件安全 | 已检查中文、动画资源 ID、确定性 ZIP、路径搬迁、拒绝覆盖/篡改/越界路径 |
| 剪映 5.0 | 草稿识别、动画播放、排版、重新打开和手动导出仍待目标机器验证 |
| Wao 完整链路 | 原生 Skill 调用、正式工具、登录下载和真实数据库/Temporal 组合仍待目标机器验证 |

结构探针曾使用上游 5.9 模板，**该结果不能证明剪映 5.0 兼容**。目标机器必须用自己的剪映 5.0 创建空白模板后重新生成小样。

## 1. 接收包含本功能的代码

建议给目标机器的 Codex 这段指令：

> 先阅读仓库规则和 `scripts/jianying/README.md`。确认当前提交包含剪映一期功能，并保留本机已有代码改动和配置。按文档检查运行环境、准备真实剪映空白模板、生成独立小样并记录原生验证结果；小样通过后再验证 Wao 聊天导出。不要把本机配置或凭据写入 Git，也不要把结构检查当作剪映播放通过。

在仓库根目录确认代码：

```powershell
git status --short
git branch --show-current
git log -1 --oneline
```

开发分支为 `codex/jianying-phase1-integration`。远端发布该分支或后续合入的提交后，再在目标机器检出对应代码；**仅有本地改动、文档或分支名不代表远端已有这批代码**。正常拉取代码后无需再应用旧交接补丁。

应能找到以下文件：

- `scripts/jianying/create-sample.ts`：独立小样入口，复用生产导出器。
- `scripts/jianying/probe_environment.py`：只读检查 Python、固定依赖摘要和动画元数据。
- `scripts/jianying/export_project.py`、`import_project.py`：封闭序列化与新目录导入。
- `scripts/jianying/vendor/`、`source-manifest.json`：已随代码提供的固定依赖与摘要。
- `src/lib/creative-skills/skills/video-editing/SKILL.md`：Wao 原生专业 Skill。

不需要另行把上游 Skill 安装到 Codex Home，也不需要让 Wao Runtime 执行任意脚本。

## 2. 准备目标机器环境

需要 Node.js 22+、项目 npm 依赖、Python 3.10+ 的 Python 3 版本，以及目标剪映。Wao 应用、Temporal Worker 和 Python 在 Windows 宿主机运行，Docker 承载现有基础设施。

按[项目 README 的本地开发流程](../../README.md)准备依赖和已有本机配置。已有 `.env` 应保留，只补充本功能需要的字段。本功能没有新增数据库迁移；本手册不要求执行 `db:push`、重置数据库或清理数据。

新检出的工作区尚未安装依赖时，在仓库根目录安装：

```powershell
npm ci
```

FFmpeg/ffprobe 沿用项目既有解析入口；若本机需要指定二进制目录，配置 `.env.example` 中已有的 `FFMPEG_BINARY_DIR`。

### 创建真实空白模板

1. 在目标剪映 5.0 中创建全新的空白工程，然后退出剪映。
2. 把该空白工程目录复制到专用模板目录，保留原文件名和同目录元数据。
3. 模板需包含 `draft_content.json` 或 `draft_info.json`，以及同目录的 `draft_meta_info.json`。
4. 模板应没有素材、轨道或时长。包含素材、加密或结构不支持的模板会明确失败。

不要使用个人正式工程作为模板，不要通过重命名文件把其他版本伪装成 5.0。

在本机 `.env` 补充实际绝对路径：

```dotenv
JIANYING_PYTHON_PATH="C:/Python312/python.exe"
JIANYING_TEMPLATE_FILE="D:/WaoTemplates/Jianying5/draft_content.json"
```

以上均是占位示例，应替换成目标机器路径。应用与 Worker 使用相同配置和代码。模板、项目画幅、首段实测帧率及运行依赖摘要在提交时冻结；执行时会核对环境版本，重试不会重新读取当前项目配置或更换模板。

可先用与 `.env` 一致的 Python 路径做只读检查：

```powershell
& "C:/Python312/python.exe" --version
& "C:/Python312/python.exe" scripts/jianying/probe_environment.py
```

预期输出包含 `pythonVersion` 和 `sourceManifestHash`。这只证明序列化依赖可用，不证明剪映已识别工程。

## 3. 先生成独立小样

准备两段真实视频，每段至少 5 秒，至少一段包含原声。姓名和说明由测试者明确提供。预先创建一个新的验证目录，例如 `D:/WaoValidation/run-001`。

在仓库根目录运行。`--env-file=.env` 会让命令读取上一步的本机配置，包括 Python、模板及 FFmpeg 路径：

```powershell
npx tsx --env-file=.env scripts/jianying/create-sample.ts --first "D:/clips/one.mp4" --second "D:/clips/two.mp4" --name "林舟" --description "调查记者" --locale zh --ratio "9:16" --resolution 720p --out "D:/WaoValidation/run-001/sample.zip"
```

脚本使用生产导出器，每段截取最多前 5 秒，在第二段开始处添加最长 3 秒的姓名说明和 300ms 渐入/渐出，并保留原声。输出文件必须尚不存在。脚本不写数据库、不启动 Wao、不控制剪映。

再次验证时使用新的目录或输出文件名，避免覆盖已有结果。

## 4. 在剪映中验证小样

先关闭剪映，解压 ZIP：

```powershell
Expand-Archive -LiteralPath "D:/WaoValidation/run-001/sample.zip" -DestinationPath "D:/WaoValidation/run-001/extracted"
```

把目标路径替换成**实际剪映草稿根目录下尚不存在的新工程目录**，再运行包内导入脚本：

```powershell
& "C:/Python312/python.exe" "D:/WaoValidation/run-001/extracted/import_project.py" --source "D:/WaoValidation/run-001/extracted" --destination "D:/ACTUAL-JIANYING-DRAFTS/wao-phase1-run-001"
```

导入器先验证 profile、路径和摘要，再独占创建新目录、复制声明的文件并重定位媒体路径。已有目标目录会被拒绝；它不修改其他草稿或剪映全局草稿列表。

打开剪映，逐项确认：

- 新草稿能被识别和打开；两段视频顺序及画幅正确。
- 第二段的中文姓名、身份说明、位置和显示区间正确。
- 渐入、渐出实际播放，文字仍可编辑，原声完整。
- 关闭后重新打开，素材路径仍有效，并能由剪映手动导出 MP4。
- 将 ZIP 移动到另一目录后，仍能按新路径导入；导入已有目标目录会被拒绝。

若剪映没有发现新目录，记录版本和实际草稿路径，并确认该版本支持的导入方式。不要把进程退出成功当作原生验证通过，也不要直接改写全局索引绕过问题。

小样的草稿识别、文字和动画通过后，再进入 Wao 验证；失败时保留错误与目标版本事实，先修复已证实的兼容问题。

## 5. 验证 Wao 聊天链路

更新前先让全部正在运行的旧合并任务完成；无法完成的任务通过现有取消入口结束。然后让应用与 Worker 同时使用新代码。本次使用 `merge_videos/v9` 和 `workspace_resource_video_merge_v3`，没有旧参数或旧 payload 的兼容解释器。

按项目本地流程启动：

```powershell
npm run infra:check
npm run dev
```

已有基础设施不满足检查时，按项目 README 排查并保留错误，不用重建或清空数据掩盖问题。为本功能修改 `.env` 后，需要重启应用与 Worker。

在 Wao 登录当前用户，打开项目，确认项目画幅及两段视频 Resource 已 ready，并明确角色姓名、身份和片段归属。例如：

> 把这两段视频按剧情顺序编排，第二段从第 1 秒截取 4 秒。在第二段开始后 0.5 秒显示“林舟 / 调查记者”2 秒，使用渐入渐出，保留原声，导出剪映工程。

应观察到同一主 Agent 读取 `video-editing` Skill，经 `merge_videos` 提交正式 Task，工程 Resource 按 pending → ready/failed 变化；成功后出现工程卡和下载入口。Wao 应自行读取精确资源版本，缺少视频内容或角色归属事实时询问，不要求用户复制 ID。

下载后重复第 4 节的原生检查，并补充验证：

- 同一视频重复使用、片段重排后，姓名层跟随正确的片段使用。
- 中文名称和错误说明正确，画布能查看输入来源。
- 缺失配置、越界裁切、MP4 携带文字层、不支持的音频模式明确失败。
- 失败或取消不会显示假完成；下载使用当前用户的正式权限入口。

## 6. 能力范围与已知限制

- 剪映工程支持单主轨视频编排、裁切、姓名/身份说明、底部左右位置、文字渐入/渐出，以及保留或静音原声。它交付可编辑工程，不自动控制剪映或导出 MP4。
- 现有 MP4 合并保留音频模式及 cue mixer；文字层目前只支持剪映工程。没有跟踪、自动识别人脸/首次出场、任意效果、转场或付费模板。
- 编排、文字和原声保留用户给出的毫秒区间。MP4 把累计切点映射到最近帧：24fps 的三个100ms片段为2、3、2帧，共约291.667ms，整片误差至多半帧；不会把逐段编码的观测时长用作后续音轨或片段区间。没有输出帧的片段会在提交前被拒绝。
- 剪映工程保留原始毫秒区间和播放速度，不把 MP4 的物理帧取整倒写到创作内容。
- **已知待修：**300ms有声 MP4 样本在现有响度分析中报 `VIDEO_MERGE_LOUDNESS_ANALYSIS_FAILED`。该短例以静音验证，有声验证使用3.3秒；本轮没有更改响度算法。剪映工程的原声直接保留，不经过该 MP4 响度处理。
- 剪映5.0、真实 Wao App Server/数据库/Temporal组合、登录下载与浏览器视觉仍需目标机器验收；已有结构和代码检查不能替代这些证据。

## 7. 失败时记录什么

| 现象 | 首先核对 / 记录 |
| --- | --- |
| `JIANYING_CONFIGURATION_REQUIRED` | 实际 Python 路径、版本、只读 probe 输出；确认样本命令加载了 `.env` |
| `JIANYING_TEMPLATE_INVALID` | 原生文件名、目标剪映版本、空白状态，以及同目录元数据是否齐全 |
| FFmpeg/ffprobe 无法运行 | 本机二进制目录及原始错误；沿用现有 `FFMPEG_BINARY_DIR` 配置 |
| 草稿打不开、动画不播放 | 目标剪映版本、原生草稿结构、动画资源 ID、截图或人工观察；保留失败样本 |
| 工程导出 Task 失败 | Operation/Task/Resource 的真实 ID、终态和原生错误，避免只记录一段聊天文案 |
| 导入目标已存在或摘要不符 | 使用新验证目录，核对包是否完整，不覆盖已有工程 |

建议保留一次验收记录：日期、Git commit、Python/剪映版本、使用的模板原生文件名、视频顺序/裁切/姓名/动画/原声/重开/导出的逐项结果，以及失败时的原始错误。仅保存必要事实，不提交 `.env`、模板原件、个人视频或本机凭据。

## 开发验证与权威入口

唯一正式提交入口是 `merge_videos`，复用 `WORKSPACE_RESOURCE_VIDEO_MERGE`、checkpoint 和 Task terminal materializer。MP4 与工程包 renderer 只负责目标格式；持久 writer 和 Project 所有权没有增加。工程为 `archive` Resource，经现有 MediaObject/Resource 关系授权下载，不进入媒体播放器或生成 Provider。

参照物为既有视频生产链；音乐合并链提供音轨与 cue 参照。

| 参照物触点 | 新实例覆盖 / 不适用原因 | 已有验证 |
| --- | --- | --- |
| 领域、Skill、Output、原生 inventory | editing → video-editing → video_edit，沿用 admitted snapshot | Creative Output conformance、类型检查 |
| identity、版本、顺序、权限 | 精确 Resource 版本，clipId 区分每次使用，现有 resolver 与事务内复验 | 时间/帧逻辑5项、几何2项；真实DB请求待验证 |
| 提交、失败、取消、重放、终态 | 同一 Operation/Task/事务及 writer，冻结编排/模板/技术参数 | ZIP字节一致；真实Temporal故障组合待验证 |
| 音轨与视频 | 现有 FFmpeg renderer，累计帧边界，原声区间独立保留 | 真实视频轨3项；50短片段及原声/色彩探针 |
| 姓名与动画 | 片段使用锚点，原生文字与渐入/渐出 | 原生JSON区间、中文和资源ID；5.0播放待验证 |
| 持久化与下载 | archive schema、media内容、原权限入口 | Resource/Canvas conformance；真实登录下载待验证 |
| 画布、聊天选择、i18n | 既有resourceCard、工程说明及下载，zh/en | 类型与lint；视觉待验证 |
| Provider、计费、外部UI控制 | 不适用：确定性本地后期，无新增Provider或剪映控制 | 本地Provider边界检查 |
| 文件搬迁与用户文件安全 | 摘要、路径白名单、独占新目录 | 真实文件系统搬迁、覆盖/篡改/穿越拒绝 |

已执行并通过：

```sh
npm run typecheck
npm run test:conformance
./node_modules/.bin/vitest run tests/unit/video-compose/composition-timing.test.ts tests/unit/video-compose/composition-format.test.ts tests/integration/video-compose/video-merge-video-track.integration.test.ts --config vitest.config.ts
```

分别对应应用/runtime脚本类型与边界检查、20文件94项conformance、3文件10项定向验证；受影响文件ESLint也通过。原生结构探针保留了原始毫秒区间、文字锚点与速度，但未运行真实剪映5.0。

关键代码入口：`src/lib/creative-skills/`、`src/lib/operations/domains/workspace-resource/video-merge-ops.ts`、`src/lib/video-compose/composition-timing.ts`、`src/lib/task/execution/handlers/workspace-resource-video-merge.ts`、`src/lib/jianying/`。Runtime临时目录不是交付来源。

## 固定依赖来源

上游为 [Naizei/jianying-editor-skill](https://github.com/Naizei/jianying-editor-skill)，固定 commit `32c56928ded4f9e2c2b80e099dc7abb793d2c30b`（Skill1.7.0）。仅复用 vendored pyJianYingDraft 的低层序列化。

`vendor/pyJianYingDraft/__init__.py` 经本地适配，只导入序列化接口，移除 UI 控制导入与废弃别名；`util.py` 使用标准注解 API 支持 Python3.14。未使用高层覆盖/自动导出生命周期。MIT、Apache-2.0通知及 `source-manifest.json` 已随代码保留。
