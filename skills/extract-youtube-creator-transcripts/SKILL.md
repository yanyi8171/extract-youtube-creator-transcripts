---
name: extract-youtube-creator-transcripts
description: 一键导出指定 YouTube 博主或频道当前公开的长视频、Shorts 和直播回放字幕，保存为带时间轴的 SRT 与清洗后的 Markdown，并支持断点续跑和增量补齐。用户提到“导出博主全部字幕”“YouTube 逐字稿”“批量转 MD”“补齐频道字幕”“更新博主字幕库”“下载 Shorts 字幕”时都应使用本 Skill；不要用于只处理单个本地字幕文件、下载视频画面或绕过会员与地区权限。Export all currently public transcripts from a YouTube creator or channel, including videos, Shorts, and stream replays. Use for bulk transcript export, SRT and Markdown generation, incremental updates, or creator transcript archives.
license: MIT
compatibility: 需要支持 Agent Skills／OpenClaw 类 Skill 且允许执行本地脚本的客户端。支持 Windows 10/11（x64、ARM64）与 macOS 10.15+（Intel、Apple Silicon）；首次运行联网下载私有 Deno 与 yt-dlp，不需要 Python、Node、ffmpeg、Homebrew、winget、Docker 或管理员权限。
metadata:
  author: yy1675430-stack
  version: "0.1.1"
---

# YouTube 博主字幕一键导出

把频道链接或 `@handle` 和“博主根目录”交给脚本。根目录里只产生 `长视频`、`短视频` 两个可见目录；每条成功视频保存一份 SRT 和一份同名 Markdown。

## 开始前

1. 确认用户给了频道链接／`@handle` 和保存目录。缺保存目录时只询问这一个信息。
2. 说明将访问 YouTube；只抓字幕，不下载视频和音频。
3. 先做工具预检。若需要安装，告诉用户下载项、大小、私有安装位置和风险，得到确认后才执行安装。用户在当前请求中已经明确同意安装时，不重复确认。
4. 不读取系统浏览器 Cookie，不使用主账号，不修改 PATH 或 shell 配置。

## 选择启动脚本

设 `<skill>` 为本 Skill 目录。

Windows：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<skill>\scripts\bootstrap.ps1" --preflight
powershell -NoProfile -ExecutionPolicy Bypass -File "<skill>\scripts\bootstrap.ps1" --install
powershell -NoProfile -ExecutionPolicy Bypass -File "<skill>\scripts\bootstrap.ps1" --channel "<频道>" --output "<博主根目录>" --language source
```

macOS：

```sh
sh "<skill>/scripts/bootstrap.sh" --preflight
sh "<skill>/scripts/bootstrap.sh" --install
sh "<skill>/scripts/bootstrap.sh" --channel "<频道>" --output "<博主根目录>" --language source
```

预检不会安装或导出。`--install` 只安装私有 Deno 与 yt-dlp。若脚本返回 `21`，说明当前网络需要 PO Token Provider；再次说明它会下载并在任务期间启动本地服务，用户确认后运行 `--install-pot`，再重跑原命令。

## 参数规则

- `--channel`：必填，接受频道 URL、频道 ID URL 或 `@handle`。
- `--output`：必填，指向博主根目录，不是 `长视频` 或 `短视频` 子目录。
- `--language`：默认 `source`。也可传 `en`、`zh-Hans` 等语言代码；只选现有字幕，不调用翻译。
- `--cookies`：仅在脚本返回 `22` 后使用，接受 Netscape 格式 `cookies.txt`。
- `--pilot`：默认 `3`；试跑通过后脚本继续完成全部项目。
- `--dry-run`：只枚举频道和核对已有文件，不下载字幕。

## 固定工作流

1. 先匿名运行，不主动索取 Cookie。
2. 分别枚举频道的 `/videos`、`/shorts`、`/streams`；Shorts 以 Shorts 页成员身份为准，直播回放归入长视频。
3. 人工字幕优先，自动字幕兜底；默认选视频原语言，不静默改用机器翻译轨。
4. 先处理 3 条试样；之后每批 25 条，每条随机等待 5—10 秒。连续 3 次验证失败就停止，保留已经完成的文件。
5. 只下载临时 VTT，由脚本自行生成 SRT 与 Markdown；不安装 ffmpeg。
6. 每次写入前按视频 ID 扫描现有文件：完整配对就跳过，只有 SRT 就补 MD，同一 ID 多份则报告冲突且不删除。
7. 输出文件通过同目录临时文件原子落盘；不覆盖任何已有文件。

## Cookie 只在确有需要时使用

YouTube 官方提取器说明提醒：账号 Cookie 可能导致账号被临时或永久限制。脚本返回 `22` 时：

1. 建议使用小号。
2. 打开一个无痕窗口并登录 YouTube。
3. 在同一标签页访问 `https://www.youtube.com/robots.txt`。
4. 使用开源 `Get cookies.txt LOCALLY` 导出 `youtube.com` Cookie，然后立刻关闭该无痕窗口。
5. 把导出路径通过 `--cookies` 传给脚本。

Cookie 内容和路径不得写进日志、状态或最终回复。脚本不会删除用户导出的原文件；任务结束时提醒用户自行安全删除。

## 内容使用与版权

- 只处理用户有权访问的公开字幕；本工具仅用于个人学习、研究，以及依法备份本人有权访问的公开字幕。
- 未经版权方许可，不得转载、出售、商业化利用他人字幕，也不得用其制作盗版内容。
- 使用者须遵守 YouTube 条款、版权方要求和适用的著作权法律，并自行承担使用责任。
- 以上限制针对通过本工具取得的第三方字幕内容；本 Skill 的代码许可证仍为 MIT。

## 结果与失败处理

脚本结尾输出 `RESULT_JSON=...`，据此向用户报告：频道视频总数、成功、已有跳过、补配对、失败和报告路径。

失败必须逐条说明：

- `no_captions`：视频没有可用字幕。告诉用户可选择本地 Whisper（免费但重）、付费 API 或人工处理；不要自动执行。
- `needs_pot`：确认后安装私有 PO Token Provider，再重跑。
- `needs_cookies`／`cookie_expired`：按上面的无痕小号流程重新导出。
- `members_or_private`、`region_restricted`、`removed`：不绕过权限，说明需要合法访问权限或视频已不可用。
- `network`、`tool_outdated`：先重试；仍失败时建议更新锁定工具链。

详细排查时读取 [references/troubleshooting.md](references/troubleshooting.md)。

## 验收

- 可见输出根目录只有 `长视频`、`短视频` 两个目录。
- 每个成功视频 ID 正好一份 `.srt` 和一份 `.md`。
- Markdown 不含 `-->`、字幕序号或连续滚动重复句。
- 不同视频 ID 即使字幕相同也分别保留；只在报告中标记相同内容。
- 第二次运行不覆盖、不重复，新增为 0 时明确报告。
- macOS 只能称为“自动化兼容测试通过”，除非确实在真实 Mac 上运行过。
