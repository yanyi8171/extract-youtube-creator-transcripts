# YouTube 字幕导出排查

## 返回码

| 返回码 | 含义 | 下一步 |
|---|---|---|
| 0 | 成功，或仅有普通的无字幕项目 | 读取 `RESULT_JSON` 和报告 |
| 2 | 参数或路径错误 | 修正频道、输出目录或语言代码 |
| 20 | 私有 Deno／yt-dlp 未安装 | 告知下载内容和位置，确认后运行 `--install` |
| 21 | 需要 PO Token Provider | 告知本地服务风险，确认后运行 `--install-pot` |
| 22 | 需要账号 Cookie | 使用无痕窗口＋小号临时导出 |
| 23 | Cookie 失效或连续验证失败 | 停止请求，稍后重新导出 Cookie |
| 30 | 工具下载或哈希校验失败 | 不运行该文件；检查网络后重试 |
| 40 | 频道枚举失败 | 检查 URL、频道公开状态和 yt-dlp 版本 |

## Cookie 安全

- 不使用 `--cookies-from-browser`，避免读取整个浏览器资料库。
- 不把 Cookie 内容、完整路径或请求头写入报告。
- 不自动删除用户原始 Cookie 文件。
- YouTube 会轮换打开标签页中的 Cookie；应在唯一无痕标签页访问 `robots.txt` 后导出，并立即关闭无痕窗口。
- 账号可能被限流或封禁，只在匿名方式和 PO Token 方式都失败时使用小号 Cookie。

## 无字幕

`no_captions` 不是脚本故障，表示视频没有满足语言规则的人工或自动字幕。向用户提供：

1. 本地 Whisper：通常免费，但需要下载音频和模型，占空间、耗时。
2. Whisper／其他转写 API：需要密钥并产生费用。
3. 人工处理：适合少量重要视频。

未经用户选择，不执行任何一种补录方式。

## 常见错误分类

- `Sign in to confirm you're not a bot`、PO Token、403：先安装 Provider；仍失败再使用 Cookie。
- `This content isn't available`：可能是限流、地区限制、删除或权限问题，按报告中的原始类别处理。
- `Requested format is not available`：字幕任务必须带 `--ignore-no-formats-error`；不要因此下载视频。
- `Unable to download video subtitles`：重试一次；若伴随 403／bot 文本，按验证失败处理。
- 哈希不匹配：立即删除本次临时下载，不执行；不要绕过校验。

## 私有安装位置

- Windows：`%LOCALAPPDATA%\YouTubeCreatorTranscripts\`
- macOS：`~/Library/Application Support/YouTubeCreatorTranscripts/`

删除这个目录即可移除私有工具和运行状态；Skill 不改系统 PATH、注册表或 shell 启动文件。
