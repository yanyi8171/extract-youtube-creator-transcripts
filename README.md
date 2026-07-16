# YouTube Creator Transcripts

一键导出指定 YouTube 创作者或频道当前公开的长视频、Shorts 与直播回放字幕，保存为带时间轴的 SRT 和清洗后的 Markdown。

Export all currently public transcripts from a YouTube creator or channel into timestamped SRT files and cleaned Markdown transcripts.

## 能做什么

- 分别枚举频道的长视频、Shorts 和直播回放。
- 人工字幕优先，自动字幕兜底，不静默改用机器翻译轨。
- 支持断点续跑、增量补齐、SRT／Markdown 配对修复。
- 不下载视频或音频，不绕过会员、私有、地区或删除限制。
- 默认匿名访问；只有匿名方式和 PO Token 都失败时，才提示使用临时小号 Cookie。

## 支持范围

Skill 本体遵循 [Agent Skills 开放标准](https://agentskills.io/specification)，支持 Windows 10／11（x64、ARM64）和 macOS 10.15+（Intel、Apple Silicon）。客户端还必须允许执行本地 PowerShell 或 POSIX shell 脚本。

| 客户端 | 安装方式 | 当前状态 |
|---|---|---|
| Claude Code | GitHub CLI | 标准格式支持 |
| Codex | GitHub CLI／内置 Skill Installer | 标准格式支持 |
| Hermes Agent | Hermes Skills Hub／GitHub Tap | 官方支持多文件 GitHub Skill |
| Tencent WorkBuddy | Release ZIP 上传 | WorkBuddy v5.1.7 真机验证通过 |
| 其他兼容客户端 | `npx skills` 或 `gh skill` | 取决于客户端是否允许本地脚本执行 |

说明：Claude、GPT、DeepSeek 等是模型；真正负责发现、安装和执行 Skill 的是 Claude Code、Codex、Hermes、WorkBuddy 等 Agent 客户端。

## 安装

### Claude Code

```powershell
gh skill install yy1675430-stack/extract-youtube-creator-transcripts extract-youtube-creator-transcripts --agent claude-code --scope user
```

### Codex

```powershell
gh skill install yy1675430-stack/extract-youtube-creator-transcripts extract-youtube-creator-transcripts --agent codex --scope user
```

也可以在 Codex 中使用内置安装器：

```text
$skill-installer install https://github.com/yy1675430-stack/extract-youtube-creator-transcripts/tree/main/skills/extract-youtube-creator-transcripts
```

安装后如果没有立即出现，请重启 Codex。

### Hermes Agent

```powershell
hermes skills tap add yy1675430-stack/extract-youtube-creator-transcripts
hermes skills install yy1675430-stack/extract-youtube-creator-transcripts/extract-youtube-creator-transcripts
```

安装前可以先运行 `hermes skills inspect`，安装后运行 `hermes skills audit`。

### Tencent WorkBuddy

WorkBuddy 当前没有公开、稳定的命令行安装格式。请下载本仓库 Release 中的 `extract-youtube-creator-transcripts-v0.1.1.zip`，然后：

1. 打开“专家 技能·连接器”→“技能”。
2. 点击“添加技能”→“上传技能”。
3. 点击“拖拽文件或点击上传”，选择下载的 ZIP。
4. 等待安全检测完成，不要跳过检测。
5. 在“已安装”中确认出现 `extract-youtube-creator-transcripts`。

WorkBuddy v5.1.7 真机验证结果：ZIP 被正确识别，安全检测显示“非高风险自动安装”，安装后名称和完整描述正常显示。不要使用尚未实现的 `codebuddy install` 命令。

### 其他 Agent 客户端

```powershell
npx skills add yy1675430-stack/extract-youtube-creator-transcripts --skill extract-youtube-creator-transcripts -g
```

或者使用 GitHub CLI，并把 `<client>` 换成 `gh skill install --help` 列出的客户端名称：

```powershell
gh skill install yy1675430-stack/extract-youtube-creator-transcripts extract-youtube-creator-transcripts --agent <client> --scope user
```

## 使用

安装后直接对 Agent 说：

```text
把 https://www.youtube.com/@examplecreator 的所有公开视频字幕导出到 D:\博主全集\Example。先预检，不要下载视频或音频。
```

Agent 应先运行预检，说明需要下载的私有工具、大小、安装位置和风险，得到确认后才安装。

手动预检与执行方式见 [`SKILL.md`](skills/extract-youtube-creator-transcripts/SKILL.md)。

## 首次运行会下载什么

- Deno：执行本 Skill 自带的 TypeScript 脚本。
- yt-dlp：只枚举公开视频和下载字幕轨。
- PO Token Provider：只有 YouTube 反机器人验证要求时，经用户再次确认后才安装。

所有下载都锁定版本并校验 SHA-256，安装在用户目录下，不修改 PATH，不需要管理员权限。第三方项目和许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 安全边界

- 不使用 `--cookies-from-browser`，不读取主浏览器 Cookie 数据库。
- Cookie 只接受用户主动提供的 Netscape `cookies.txt`，路径和内容不写入报告。
- 不自动删除用户 Cookie 原文件；任务结束后由用户自行安全删除。
- 不绕过会员、私有、地区、删除或其他访问限制。
- 安装和运行脚本前，请先阅读代码和权限说明。第三方 Agent 通常会对公开 Skill 进行安全扫描。

## 内容使用与版权／Content Use and Copyright

**仅限个人学习与研究，严禁商业盗版。** 本工具也可用于依法备份本人有权访问的公开字幕。未经版权方许可，不得转载、出售、商业化利用他人字幕，也不得用其制作盗版内容。使用者须遵守 YouTube 条款、版权方要求和适用的著作权法律，并自行承担使用责任。

**For personal learning and research only; commercial piracy is strictly prohibited.** The tool may also be used for lawful backup of public transcripts the user is authorized to access. Do not reproduce, sell, commercially exploit, or use third-party transcripts to create pirated material without permission from the rights holder. Users are responsible for complying with YouTube's Terms, rights-holder requirements, and applicable copyright law.

以上限制针对通过本工具取得的第三方字幕内容；本仓库代码仍按 MIT 许可证开放。

These restrictions concern third-party transcript content obtained with the tool; the repository code remains available under the MIT License.

## 成功标志

- Agent 的 Skill 列表中能看到 `extract-youtube-creator-transcripts`。
- 预检返回 `ready: true`，或明确列出待安装工具与位置。
- 输出根目录只有 `长视频`、`短视频` 两个可见目录。
- 每个成功视频 ID 正好有一份同名 `.srt` 和 `.md`。
- 第二次运行不覆盖、不重复，只补新增或缺失文件。

## 排查

1. 找不到 Skill：确认安装到了正确客户端和作用域，重启客户端后再看 Skill 列表。
2. Skill 不触发：直接说“使用 extract-youtube-creator-transcripts”，并提供频道链接和保存目录。
3. 返回 `20`：核心工具未安装，确认后运行 `--install`。
4. 返回 `21`：YouTube 需要 PO Token Provider，确认风险后运行 `--install-pot`。
5. 返回 `22／23`：按 [`troubleshooting.md`](skills/extract-youtube-creator-transcripts/references/troubleshooting.md) 使用无痕窗口和小号临时 Cookie。
6. WorkBuddy 导入失败：确认选择的是 Release 中的完整 ZIP，并确认 ZIP 内的 `extract-youtube-creator-transcripts` 文件夹包含 `SKILL.md`；安装后到“已安装”列表核对名称。

## 更新

```powershell
gh skill update
```

或：

```powershell
npx skills update extract-youtube-creator-transcripts
```

## 许可证

[MIT](LICENSE)。你可以使用、修改和再分发，但必须保留许可证和版权声明。普通用户不能直接修改本仓库；他们只能 Fork 或提交 Pull Request，是否合并由仓库所有者决定。
