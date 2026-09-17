# im Windows x64 支持实施计划

> 状态：实施中；PR 前验收尚未完成。最后核对：2026-09-17（Asia/Shanghai）。
>
> 上游讨论：[Issue #7](https://github.com/yetlinghao/im/issues/7)。维护者已表示欢迎 Windows PR；“Tauri 理论上可以打包”不代表当前版本已通过 Windows 原生构建或运行验证。

## 1. 目标与交付边界

目标是在不改变现有 macOS 体验的前提下，提供可安装、可正常聊天的 Windows x64 版本，并形成便于上游审查的 PR。第一阶段优先正确性、可恢复性和可维护性，不追求两平台原生外观及功能完全一致。

Windows MVP 必须做到：

- 在受支持的 Windows x64 环境中，能从干净检出构建、安装、启动和卸载；首次启动可见主窗口。
- 能添加 Provider、保存 API Key、获取或手填模型，发送/停止/重新生成消息，处理流式回复、图片与导出；重启后设置和会话仍可读写。
- 正常关闭主窗口后应用退出，不能留下无法从任务栏找回的后台进程；macOS 继续保持原有“关闭即隐藏、Dock 可重新打开”行为。
- 菜单、快捷键、设置说明及窗口控件在 Windows 上不误导用户；Quick Input 至少具备基础输入和提交能力，跨应用选区抓取明确不支持或不展示。
- 通过 TypeScript 检查、Rust 测试、Windows 原生构建、真实 Windows 手工冒烟测试；macOS 现有构建和关键行为不回退。

首个 PR **不包含**：Windows UI Automation 读取其他应用选区、Mica/Acrylic 视觉特效、托盘常驻、ARM64/32 位、Microsoft Store、代码签名证书采购，以及未经验证的 Windows 自动更新上线。上述项应另开后续 PR。若维护者希望首个 PR 直接带更新功能，应先明确发布密钥和维护责任。

## 2. 已知现状与需复核的假设

| 领域 | 当前观察 | 实施前核对 |
| --- | --- | --- |
| 技术栈 | Tauri 2、Rust 后端、原生 TypeScript/Vite 前端；`package-lock.json`，应使用 npm | 同步上游后核对版本、锁文件与新增脚本 |
| 核心逻辑 | `engine`、`llm`、`sse`、`store` 大体不依赖 AppKit | 在 Windows 上 `cargo test --locked` 和端到端运行证实 |
| 窗口配置 | `tauri.conf.json` 以 macOS 透明窗口、Overlay 标题栏、交通灯和 `.app` bundle 为中心 | 用平台专属配置，避免改变 macOS 视觉与打包结果 |
| 生命周期 | `lib.rs` 的 macOS 关闭拦截有 `cfg`，但 `menu.rs` 的 `close` 无条件 `hide()` | Windows 菜单关闭、标题栏 X、Alt+F4 行为逐一验证 |
| Quick Input | `quick.rs` 已有非 macOS 的基础 `show`/`focus` 分支；选区和鼠标定位仅 macOS | Windows 全局快捷键、透明背景、失焦、缩放和多显示器需实测 |
| 存储 | `store.rs` 将 JSON 写到临时文件并用 `fs::rename` 替换目标；密钥 0600 只覆盖 Unix | Windows 已存在目标文件时的覆盖、崩溃恢复、权限及数据目录需实测 |
| 图片 | 前端尝试解码 HEIC/TIFF，但 WebView2 可解码格式未验证 | Windows 至少保证 PNG/JPEG/WebP；不承诺 HEIC 与 macOS 对等 |
| 更新 | 发布工作流仅 macOS，最新 `latest.json` 仅 Darwin 平台 | 首个 PR 不覆盖/破坏现有 feed；Windows 更新另行设计与测试 |
| 上游变化 | 远端较当前本地克隆已有新增提交、根目录 `AGENTS.md` 和 Biome | 开工前同步并完整阅读最新约定；本文件以当前本地代码为基线，不把行号当作稳定接口 |

当前机器此前已成功运行前端 `npm run build`，但 Tauri 自检显示缺少 Rust/Cargo 和 Visual Studio C++ Build Tools，因此**尚无 Windows 原生构建通过的证据**。WebView2 当时已检测到。计划中的时间估算只在环境齐备后有效。

## 3. 实施原则与技术决策

1. **先原生编译，再改代码。** 把编译错误、打包错误和运行时错误分开记录；不因为前端构建成功就宣布移植完成。
2. **平台差异只放在边界层。** 优先使用 Tauri 的 `tauri.windows.conf.json`、Rust `cfg(target_os = "windows")` 和极少量前端平台文案；不复制聊天引擎或维护两套页面。
3. **Windows 用系统标题栏作为首版默认。** 避免无框窗口自行实现拖拽、最大化、系统菜单和无障碍。先保证窗口稳定，再评估 Mica 等美化。
4. **macOS 行为保持原样。** 不重构 AppKit Quick Input，不更改现有 `.app` 安装脚本与更新流程。平台配置数组会整体替换，实施时必须完整重复需保留的窗口字段。
5. **以可测试的降级替代假对等。** 未实现 Windows 选区读取时不显示 macOS Accessibility 授权按钮，不宣传“自动引用选中文字”；不读取或篡改用户剪贴板作为隐式替代。
6. **敏感数据以实际安全边界处理。** Windows 的 `keys.json` 没有 Unix `0600` 语义；先确认数据目录及 ACL，避免把“本地存储”描述成系统凭据库。若涉及改变密钥存储格式，应单独评审迁移方案。

## 4. 分阶段实施与验收门槛

### P0：同步上游、建立可重现的 Windows 基线

- 在工作树干净且不覆盖用户改动的条件下同步 `main`；从最新提交建 `feat/windows-support`（具体分支名可调整）。确认是否已有其他 Windows PR/Issue，避免冲突。
- 阅读新版本的 `AGENTS.md`、`CLAUDE.md`、`docs/DEVELOPMENT.md`、Biome 配置、CI 和锁文件，重查本计划中的路径与假设。
- 准备 Windows x64 构建环境：优先使用 GitHub 托管的 Windows runner 提供 Rust stable **MSVC** 工具链、Visual Studio C++ Build Tools（含 Windows SDK）和项目指定的 Node 版本；本机只负责下载安装包及运行验收，WebView2 已检测到。本机安装系统级构建工具须单独授权，非本轮前提。
- 使用 `npm ci`、`npm run build`、项目新增的格式/lint 命令、`cargo test --locked`、`npm run tauri -- info` 和不发布的 Tauri debug 构建记录原始结果。若构建失败，先定位失败于依赖、Rust 条件编译、Tauri 配置还是 WebView2，而非一次性修改多个层次。

**门槛：**有可复现的基线日志和失败清单；新上游变动已反映到任务列表。若 Rust/Build Tools 不可用，不能进入“Windows 已验证”结论。

### P1：原生编译与窗口生命周期

- 检查 `src-tauri/Cargo.toml` 的 macOS 私有 API 特性及按平台依赖是否能在 Windows 编译；仅做必要的 `cfg` 隔离，不能粗暴移除 macOS 功能。
- 用 `src-tauri/tauri.windows.conf.json` 覆盖 Windows 主窗口配置：系统装饰、非透明或有明确绘制背景、合理最小尺寸、任务栏可见；Quick Input 单独配置。确认 `app.windows` 数组替换语义，避免遗漏 `quick` 窗口或前端 URL。
- 审核 `lib.rs`、`menu.rs`：Windows 标题栏 X、Alt+F4、`File → Close` 均应结束应用或有明确、可找回的入口；macOS 保持 hide/reopen。菜单中的 `.services()`、`.hide()`、`.hide_others()` 等 macOS 专属项按平台构造或移除，不把 macOS 应用菜单硬塞到 Windows。
- 实测启动失败时的 5 秒兜底显示、主窗口首次显示、最小化/最大化/恢复、多显示器和 DPI 缩放。

**门槛：**Windows 上关闭行为一致且无残留不可见进程；macOS 窗口行为回归通过。可将这一阶段单独提交，便于审查。

### P2：数据持久化与核心聊天冒烟

- 先写聚焦测试覆盖 `Store::save_settings`、`upsert_provider`、`set_api_key`、`save_session` 对**已存在文件**的再次写入；Windows 上特别验证 `fs::rename` 的覆盖语义，以及 `.json.tmp` 遗留文件不会破坏旧数据。只有测试证实有问题时再改为可靠的原子替换方案，不凭印象改写。
- 核对 Windows 默认数据目录与 `IM_DATA_DIR` 覆盖、路径中空格/中文、会话 ID 校验、导出到用户指定路径、删除 Provider 后密钥清理。临时测试数据必须隔离于用户真实数据目录。
- 用项目 `mock_server.py` 或测试服务验证三个协议：Chat Completions、Anthropic Messages、Responses 的发送、流式增量、取消、错误展示和会话持久化；再用用户自选真实端点做非必需的端到端验证，不提交或记录真实 API Key。
- 验证 WebView2 的粘贴、拖放、文件选择、PNG/JPEG/WebP 解码与预览；对 HEIC/TIFF 未支持的行为提供清晰错误，不静默丢附件。

**门槛：**新旧 JSON 文件往返可读，重复保存不报错、不丢数据；核心聊天功能在 Windows 实际运行，而不仅 Rust 单测通过。

### P3：快捷键、Quick Input 与前端平台文案

- Windows 的菜单快捷键由 Tauri 原生菜单负责，避免在 WebView 中再绑定造成一次按键执行两次。逐项核对新聊天、模型选择、设置、停止、导出、侧栏/轨迹栏切换与输入法组合期行为。
- `Alt+Space` 与 Windows 系统窗口菜单可能冲突。先在目标系统实测注册结果；若确实冲突，为**新 Windows 设置**选一个可用默认组合或默认关闭，保留用户自定义与冲突报错。旧设置需有清晰迁移/回退行为，不能因默认变更覆盖用户已保存的快捷键。
- Quick Input 第一版只保证快捷键召唤、正确显示与聚焦、输入、Enter 提交、Esc/失焦关闭、主窗口前置；窗口应采用 Windows 可见背景，避免 macOS vibrancy 缺失时变成透明不可读。暂不实现自动读取别的应用选区或恢复前台应用焦点的复杂行为，文案据此调整。
- 将 `⌘`/`⌥` 提示、Finder/Accessibility 文案和设置项按平台展示。抽出少量平台信息或格式化函数集中处理，不全局替换字符串；macOS 界面截图应保持一致。
- 核对 Ctrl/Alt 与中文输入法、系统保留快捷键、WebView2 默认快捷键的碰撞；手工测试快捷键录制器能正确显示和保存。

**门槛：**Windows 界面无明显 macOS 操作提示；Quick Input 不谎称有选区访问；macOS 原有快捷键和文案不变。

### P4：安装包、CI 与文档

- 在 Windows 平台配置选择 **NSIS x64** 作为首版安装包；先采用用户级安装，不要求管理员权限。确保应用标识、图标、安装/卸载行为一致，卸载不会未经提示清理用户聊天数据。
- 增加独立 `windows-2022` CI：锁定 npm 依赖、运行上游现有 lint/format/typecheck、`cargo test --locked`、Windows Tauri build，并上传可测试构建产物。避免 PR CI 直接发布 Release 或获取生产签名密钥。
- 在 `docs/DEVELOPMENT.md` 加 Windows 构建依赖、开发/测试命令、数据目录、已知功能差异；README 继续保持精简。发布前由维护者决定是否给首页增加 Windows 入口。
- 保留现有 macOS 发布 job 和 `install.sh`。不要让两个 job 同时生成并覆盖同名 `latest.json`；Windows Release 和自动更新进入 P5 设计评审。

**门槛：**干净 Windows CI 可构建，手工下载产物可安装、启动、卸载；macOS CI/发布工作流仍可用。若 GitHub Actions 构建受限，先以可复现的本地构建和手工验收向维护者说明，不宣称发布就绪。

### P5：独立后续 PR——Windows 自动更新与原生增强

- 自动更新：明确 Windows NSIS 产物及 Tauri 签名文件，设计单一最终 `latest.json` 聚合步骤，包含既有 Darwin 和新增 Windows target；避免 CI 并发覆盖。使用维护者现有 Tauri updater 私钥签名，贡献者不接触私钥。分别测试旧版升级、新版无更新、签名错误、下载中断、安装失败与数据保留。
- 分发安全：与维护者确认 Windows 代码签名证书及 SmartScreen 提示策略；Tauri updater 签名和 Windows Authenticode 是不同问题，不混为一谈。
- Quick Input 增强：若维护者需要，再评估 Windows UI Automation 读取选中文字、鼠标邻近定位、焦点交还与不同应用兼容性，单独做隐私/权限审查和回归测试。
- 视觉增强：Mica/Acrylic 只在 Windows 11/受支持系统按需启用，有纯色回退；不能牺牲可读性、性能或窗口稳定性。

## 5. 预期改动面（实施前以最新上游为准）

| 文件/模块 | 预计方向 |
| --- | --- |
| `src-tauri/tauri.conf.json`、新增 `src-tauri/tauri.windows.conf.json` | 基础配置与 Windows 平台覆盖，NSIS target，窗口尺寸/装饰/背景；谨慎处理数组替换 |
| `src-tauri/src/lib.rs`、`menu.rs` | 窗口关闭与菜单平台分支，保留 macOS hide/reopen |
| `src-tauri/src/quick.rs`、`model.rs` | Windows Quick Input 降级、默认快捷键与旧设置兼容 |
| `src-tauri/src/store.rs` 及其测试 | Windows 重复写入/原子替换语义与路径验证 |
| `src/shortcut.ts`、`src/ui/settings.ts`、其他 UI 提示 | Windows 键名、文案、选区授权项显隐；不散落平台判断 |
| `src/styles.css`、`src/quick.css` | Windows 无 vibrancy 时的可见背景、标题栏占位和 DPI 适配 |
| `.github/workflows/`、`docs/DEVELOPMENT.md` | Windows CI/安装包与平台说明；Release 自动更新另 PR |

不预设所有文件必然修改；每项只在验证到具体问题后落实。尤其 `store.rs` 的覆盖行为、图片格式、快捷键冲突，均列为“先测后改”。

## 6. 验证矩阵

| 测试场景 | Windows x64 | macOS 回归 | 自动化/人工 |
| --- | --- | --- | --- |
| 类型、格式、lint、前端构建 | 必需 | 必需 | CI |
| Rust 单测与协议流式测试 | 必需 | 必需 | CI |
| Tauri 原生构建 | 必需 | 必需 | CI/本机 |
| 安装、首次启动、关闭、卸载 | 必需 | 现有安装流程不变 | 人工 |
| 添加/修改 Provider、密钥、模型 | 必需 | 抽样 | 人工 + 存储测试 |
| 新聊天、流式、取消、重试、错误 | 必需 | 抽样 | mock server + 人工 |
| 重启后会话与设置恢复、导出 | 必需 | 抽样 | 自动化 + 人工 |
| 图片粘贴、拖放、选择、预览 | PNG/JPEG/WebP 必需 | 抽样 | 人工 |
| 主窗口、菜单、快捷键、Quick Input | 必需 | 关键路径必需 | 人工，必要时截图 |
| 亮/暗色、100%/150% DPI、多显示器 | 必需 | 现有视觉不变 | 人工 |
| 安装包升级与自动更新 | P5 才必需 | P5 必需 | 人工 + 发布验证 |

## 7. PR 拆分、风险与停止条件

**建议拆分：**

1. `PR A — Windows MVP`：P0–P3 的运行正确性、聚焦测试、平台文案；不碰 Release 签名或现有 macOS 发布逻辑。
2. `PR B — Windows CI and NSIS package`：P4 的打包、CI 和文档。若上游偏好单 PR，可与 A 合并，但提交仍按“配置/生命周期/存储/UI/CI”分层。
3. `PR C — Windows updater`：P5 的签名、manifest 聚合与升级验证，必须由维护者参与发布密钥相关操作。
4. 可选独立 PR：Windows 原生选区读取与视觉增强。

**主要风险：**上游快速迭代造成代码漂移；Windows 原生工具链缺失；WebView2 与 WebKit 行为差异；`fs::rename` 覆盖及密钥文件权限；隐藏窗口、全局快捷键冲突；Release `latest.json` 覆盖及未签名安装包 SmartScreen 提示。

**停止/升级条件：**若需要更改会话数据格式、迁移密钥存储、使用维护者签名私钥、破坏 macOS 体验，或需要超出 MVP 的跨应用选区读取，应先在 Issue/PR 与维护者确认，而不是自行扩大范围。若本机缺少原生构建工具，可用 Windows CI 构建，但不能仅凭 CI 编译结果合并“可用版”结论；仍须在真实 Windows 桌面安装和验收。

## 8. 参考依据

- 上游 [Issue #7](https://github.com/yetlinghao/im/issues/7)、[当前项目说明](https://github.com/yetlinghao/im/blob/main/docs/DEVELOPMENT.md)、[上游 AGENTS.md](https://github.com/yetlinghao/im/blob/main/AGENTS.md)。
- Tauri 官方：[简介](https://v2.tauri.app/start/)、[平台配置](https://v2.tauri.app/reference/config/)、[Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)、[更新器](https://v2.tauri.app/plugin/updater/)、[Windows 构建前提](https://v2.tauri.app/start/prerequisites/)。

本计划记录执行路线和验收标准；已实施项目以第 9 节为准，不能据此推断 Windows 原生构建已通过或维护者认可了每个设计细节。

## 9. 当前 PR 前验收记录（2026-09-17）

- 已完成：同步上游至 `1bf807f`；Windows 平台配置、窗口退出处理、存储重复写入测试、平台文案与非透明窗口背景回退；Windows CI 已配置构建和关闭场景检查。
- 本机已通过：`npm ci`、`npm run biome:check`、`npm run build`、`git diff --check`。`npm audit --audit-level=high` 检查锁文件依赖，未发现公告漏洞。
- 浏览器预览：Windows 样式的设置页暗色及 Quick Input 亮/暗色可读；这不等价于原生 WebView2、系统菜单或安装包验收。
- 尚未通过：本机缺少 Rust、Cargo、MSVC 和 Windows SDK，无法运行 `cargo test --locked` 或 Tauri/NSIS 原生构建；Windows CI 尚未运行，原生窗口、安装/卸载及真实聊天流程尚未人工验证。
- 停止条件：上述原生构建与运行门槛未通过前，不创建 PR，也不宣称 Windows MVP 已验证可用。

## 10. 下一轮执行方案：云端构建、本机验收、最后提 PR

**本节仅供新对话执行；写入计划不代表已推送、已触发 CI、已安装或已验收。** 用户同意优先使用 GitHub Windows runner 构建，再将产物下载到本机测试；未授权安装本机 Rust/Visual Studio 工具链，也未授权提前创建 PR。

### 10.1 准备独立分支和可触发的 CI（尚不创建 PR）

1. 检查 `git status`、完整 diff、上游 `main` 和项目 `AGENTS.md`；保留当前所有改动，不用 `reset --hard` 或覆盖式切换。确认计划文件、新增配置、文档和工作流均会进入提交。若上游有新提交，先评估冲突和重新验证范围。
2. 当前 `.github/workflows/windows.yml` 只在 `main` push 或 `pull_request` 时运行。**推送特性分支前**，把其 `push.branches` 加上实际分支名（例如 `feat/windows-support`），使 fork 中的分支 push 即可触发 CI，而不必先开 PR；保留 `pull_request` 触发器。确认 fork 的 Actions 已启用。不要依赖 `workflow_dispatch`，因为新工作流不在 fork 默认分支时手动触发可能不可用。
3. 在自己的 fork 上创建并推送特性分支；保留 `origin` 指向上游，新增单独的 fork remote，避免误推。当前 `gh auth status` 显示凭据无效，开始前需由用户在本机重新登录 GitHub CLI，或用浏览器/其他已授权方式完成 fork 与 push；不要在聊天、日志或提交中粘贴 token。创建提交/推送前核对 `git diff --cached`、作者信息和目标 remote。未经再次确认不创建 PR。
4. 提交只包含 Windows MVP、测试、CI、文档和本计划，不混入生产密钥、构建产物、真实聊天数据或不相关改动。记录提交 SHA 和 Actions run URL。

### 10.2 Windows runner 构建与故障闭环

1. 在 fork 的 Actions 中找到该特性分支 push 触发的 `windows` workflow，核实 checkout 的 SHA 与本地提交一致。若未触发，先检查分支过滤、Actions 开关和 YAML，而不是直接创建 PR。
2. 要求 `npm ci`、`npm run biome:check`、`npm run typecheck`、`cargo test --locked --manifest-path src-tauri/Cargo.toml`、`npm run tauri build -- --debug --bundles nsis`、主窗口关闭 smoke、`upload-artifact` 全部成功。关注 Rust/MSVC、WebView2、NSIS 和路径问题。现有关闭 smoke 尚未经 runner 实证；如 hosted runner 不支持 GUI 场景，应记录限制、调整自动测试，并把真实关闭行为列为本机强制验收，不能静默删掉检查。
3. 失败时读取完整日志，区分环境、编译、测试、打包和运行问题；针对性修复并在同一分支重新推送，直至最新 SHA 的整条工作流通过。记录失败原因与修复。不能靠跳过 Rust 测试、取消 smoke 或 `continue-on-error` 伪造绿色结果。
4. 核对 artifact 名 `im-windows-x64` 和 NSIS `.exe`。debug 安装包仅供验收，不是签名发布包，不上传正式 Release，也不当作自动更新产物。

### 10.3 下载、隔离安装和真实 Windows 验收

1. 从**已通过的最新 SHA** 对应 Actions run 下载 artifact：可用 GitHub 网页，或在 `gh auth status` 恢复后执行 `gh run download <run-id> -n im-windows-x64 -D <专用目录>`。记录 run URL、SHA、文件名和 SHA-256，确认 `.exe` 源自预期 fork/分支。
2. 安装前备份或避开任何现有 `im` 安装和真实数据。优先在独立 Windows 用户/测试机验收；若用本机，先明确安装、卸载和数据目录，只用测试 Provider/API Key，不导入真实私密会话。确认 WebView2 可用。未签名包可能触发 SmartScreen；不要全局关闭系统保护，仅在核实来源后由用户决定是否运行。
3. 依照 `docs/WINDOWS.md` 和第 6 节矩阵逐项验证：安装/首次启动/卸载，主窗口 X/Alt+F4/菜单关闭无残留，设置与会话重复保存和重启恢复，Provider/API Key/模型，mock 服务聊天的流式/取消/重试/错误，导出，PNG/JPEG/WebP 附件，快捷键与 Quick Input，亮暗色、100%/150% DPI、中文路径和多显示器。记录结果、系统版本及必要截图/日志；无法测试的项标注“未验证”，不能写“通过”。
4. 特别核对卸载不意外删除用户数据、`keys.json` 是本地明文而非 Windows 凭据库、Windows 更新入口不误导用户。测试后只清理明确属于本轮测试的安装和数据，不删除已有资料。
5. 若验收失败，修复后重新推送、等待 CI 通过、下载**同一最新 SHA**的新产物复测；不能用旧 artifact 证明新代码。最终按第 6 节形成逐项验收记录，附 CI run、SHA 和安装包 SHA-256。

### 10.4 PR 前最终门槛

- 最新提交的 Windows workflow 全绿，真实 Windows 安装及核心功能验收通过；关键项失败或未测则先修复/补测。
- 重新运行本地 Biome、TypeScript/前端构建、依赖审计和 `git diff --check`，核对 macOS 发布/更新签名流程未受影响。当前机器不能做 macOS 原生回归，须明确留给上游 macOS CI/维护者验证，不能伪称通过。
- 核对分支相对上游 `main` 的完整 diff、提交历史、文档、Issue #7 范围和残余风险；准备简短中文 PR 描述，写明 Windows MVP、已知限制、测试证据及不含自动更新/跨应用选区。**只有用户在新对话明确要求提交 PR 后才创建 PR。**
