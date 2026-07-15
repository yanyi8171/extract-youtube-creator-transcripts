import {
  CaptionChoice,
  CaptionKind,
  classifyFailure,
  cuesToMarkdownBody,
  cuesToSrt,
  formatUploadDate,
  isIncompleteYoutubeInfo,
  MarkdownMetadata,
  normalizeChannelInput,
  parseSrt,
  parseVtt,
  redactSensitive,
  renderMarkdown,
  sanitizeTitle,
  scanExisting,
  selectCaptionTrack,
  sha256Text,
  VideoEntry,
  VideoType,
} from "./core.ts";

interface CliOptions {
  channel: string;
  output: string;
  language: string;
  cookies?: string;
  pilot: number;
  dryRun: boolean;
  ytDlp: string;
  potHome?: string;
  potPlugin?: string;
  maxItems?: number;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Failure {
  video_id: string;
  title: string;
  url: string;
  reason: string;
  detail: string;
}

interface RunSummary {
  status: string;
  channel: string;
  channel_id: string;
  output: string;
  discovered: number;
  long_videos: number;
  shorts: number;
  created: number;
  skipped: number;
  repaired: number;
  conflicts: number;
  failures: Failure[];
  identical_content: Array<{ fingerprint: string; video_ids: string[] }>;
  report_path: string;
}

interface ProviderHandle {
  port: number;
  child: Deno.ChildProcess;
}

interface VideoInfoResult {
  info?: Record<string, unknown>;
  failure?: { reason: string; detail: string };
}

const decoder = new TextDecoder();
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`未知参数：${arg}`);
    const [key, inline] = arg.split("=", 2);
    const value = inline ?? args[++i];
    if (!value || value.startsWith("--")) throw new Error(`参数 ${key} 缺少值`);
    values.set(key, value);
  }
  const channel = values.get("--channel") ?? "";
  const output = values.get("--output") ?? "";
  const ytDlp = values.get("--yt-dlp") ?? "";
  if (!channel || !output || !ytDlp) {
    throw new Error("必须提供 --channel、--output 和内部参数 --yt-dlp");
  }
  const pilot = Number.parseInt(values.get("--pilot") ?? "3", 10);
  if (!Number.isInteger(pilot) || pilot < 1 || pilot > 25) {
    throw new Error("--pilot 必须是 1—25 的整数");
  }
  const maxItemsValue = values.get("--max-items");
  const maxItems = maxItemsValue
    ? Number.parseInt(maxItemsValue, 10)
    : undefined;
  if (maxItems !== undefined && (!Number.isInteger(maxItems) || maxItems < 1)) {
    throw new Error("--max-items 必须是正整数");
  }
  return {
    channel,
    output,
    ytDlp,
    language: values.get("--language") ?? "source",
    cookies: values.get("--cookies"),
    potHome: values.get("--pot-home"),
    potPlugin: values.get("--pot-plugin"),
    pilot,
    dryRun,
    maxItems,
  };
}

function join(...parts: string[]): string {
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/g, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, "")
    )
    .join(separator);
}

function basename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function withoutExtension(path: string): string {
  return path.replace(/\.[^.\\/]+$/, "");
}

function absolute(path: string): string {
  if (Deno.build.os === "windows") {
    if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(path)) return path;
    return join(Deno.cwd(), path);
  }
  return path.startsWith("/") ? path : join(Deno.cwd(), path);
}

function appRoot(): string {
  if (Deno.build.os === "windows") {
    const local = Deno.env.get("LOCALAPPDATA");
    if (!local) throw new Error("找不到 LOCALAPPDATA");
    return join(local, "YouTubeCreatorTranscripts");
  }
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("找不到 HOME");
  return join(
    home,
    "Library",
    "Application Support",
    "YouTubeCreatorTranscripts",
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function atomicWrite(path: string, content: string): Promise<boolean> {
  if (await exists(path)) return false;
  const temp = `${path}.part-${Deno.pid}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await Deno.writeTextFile(temp, content);
    if (await exists(path)) return false;
    await Deno.rename(temp, path);
    return true;
  } finally {
    if (await exists(temp)) await Deno.remove(temp).catch(() => undefined);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.part-${Deno.pid}`;
  await Deno.writeTextFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  if (await exists(path)) await Deno.remove(path);
  await Deno.rename(temp, path);
}

async function runCommand(
  command: string,
  args: string[],
  cookiePath?: string,
  cwd?: string,
): Promise<CommandResult> {
  const child = new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await child.output();
  return {
    code: output.code,
    stdout: redactSensitive(decoder.decode(output.stdout), cookiePath),
    stderr: redactSensitive(decoder.decode(output.stderr), cookiePath),
  };
}

function ytBaseArgs(options: CliOptions, provider?: ProviderHandle): string[] {
  const args = [
    "--ignore-config",
    "--no-warnings",
    "--extractor-retries",
    "3",
    "--socket-timeout",
    "30",
    "--js-runtimes",
    `deno:${Deno.execPath()}`,
  ];
  if (options.cookies) args.push("--cookies", options.cookies);
  if (provider && options.potPlugin) {
    args.push("--plugin-dirs", options.potPlugin);
    args.push("--extractor-args", "youtube:player_client=mweb");
    args.push(
      "--extractor-args",
      `youtubepot-bgutilhttp:base_url=http://localhost:${provider.port}`,
    );
  }
  return args;
}

async function validateCookie(path: string): Promise<void> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) throw new Error("Cookie 路径不是文件");
  const text = await Deno.readTextFile(path);
  if (
    !/^# Netscape HTTP Cookie File/m.test(text) ||
    !/(^|\.)youtube\.com\s/m.test(text)
  ) {
    throw new Error("Cookie 文件不是包含 youtube.com 的 Netscape cookies.txt");
  }
}

function getFreePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const address = listener.addr as Deno.NetAddr;
  listener.close();
  return address.port;
}

async function waitForPort(port: number): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try {
      const connection = await Deno.connect({ hostname: "localhost", port });
      connection.close();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function startProvider(
  options: CliOptions,
): Promise<ProviderHandle | undefined> {
  if (!options.potHome || !options.potPlugin) return undefined;
  const server = join(options.potHome, "server");
  const entry = join(server, "src", "main.ts");
  const modules = join(server, "node_modules");
  if (!(await exists(entry)) || !(await exists(modules))) return undefined;
  const port = getFreePort();
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      "--allow-env",
      "--allow-net",
      `--allow-ffi=${modules}`,
      `--allow-read=${server}`,
      entry,
      "--port",
      String(port),
    ],
    cwd: modules,
    stdout: "null",
    stderr: "null",
  });
  const child = command.spawn();
  if (!(await waitForPort(port))) {
    try {
      child.kill("SIGKILL");
    } catch { /* already stopped */ }
    throw new Error("PO Token Provider 启动失败");
  }
  return { port, child };
}

async function stopProvider(provider?: ProviderHandle): Promise<void> {
  if (!provider) return;
  try {
    provider.child.kill("SIGTERM");
  } catch {
    return;
  }
  await Promise.race([
    provider.child.status.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  try {
    provider.child.kill("SIGKILL");
  } catch { /* already stopped */ }
}

function tabUrl(base: string, tab: string): string {
  return `${base.replace(/\/$/, "")}/${tab}`;
}

async function enumerateTab(
  base: string,
  tab: string,
  type: VideoType,
  options: CliOptions,
  provider?: ProviderHandle,
): Promise<{ entries: VideoEntry[]; channel: string; channelId: string }> {
  const result = await runCommand(options.ytDlp, [
    ...ytBaseArgs(options, provider),
    "--flat-playlist",
    "--dump-single-json",
    "--ignore-errors",
    "--skip-download",
    tabUrl(base, tab),
  ], options.cookies);
  if (result.code !== 0 || !result.stdout.trim()) {
    const message = `${result.stderr}\n${result.stdout}`.trim();
    if (
      tab === "streams" &&
      /does not have a streams tab|url could be a direct video link/i.test(
        message,
      )
    ) return { entries: [], channel: "", channelId: "" };
    throw new Error(message || `无法枚举 ${tab}`);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`yt-dlp 返回了无法解析的 ${tab} 清单`);
  }
  const raw = Array.isArray(data.entries) ? data.entries : [];
  const channel = String(data.channel ?? data.uploader ?? "");
  const channelId = String(data.channel_id ?? data.uploader_id ?? "");
  const entries: VideoEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const id = String(value.id ?? "");
    if (!VIDEO_ID.test(id)) continue;
    entries.push({
      id,
      title: String(value.title ?? id),
      url: `https://www.youtube.com/watch?v=${id}`,
      type,
      channel: String(value.channel ?? value.uploader ?? channel),
      channelId: String(value.channel_id ?? value.uploader_id ?? channelId),
      uploadDate: formatUploadDate(value.upload_date ?? value.release_date),
      duration: typeof value.duration === "number" ? value.duration : undefined,
    });
  }
  return { entries, channel, channelId };
}

async function enumerateChannel(
  base: string,
  options: CliOptions,
  provider?: ProviderHandle,
): Promise<{ videos: VideoEntry[]; channel: string; channelId: string }> {
  const videosTab = await enumerateTab(
    base,
    "videos",
    "long",
    options,
    provider,
  );
  const shortsTab = await enumerateTab(
    base,
    "shorts",
    "short",
    options,
    provider,
  );
  const streamsTab = await enumerateTab(
    base,
    "streams",
    "long",
    options,
    provider,
  );
  const index = new Map<string, VideoEntry>();
  for (const video of [...videosTab.entries, ...streamsTab.entries]) {
    index.set(video.id, video);
  }
  for (const short of shortsTab.entries) index.set(short.id, short);
  const videos = [...index.values()];
  return {
    videos,
    channel: videosTab.channel || shortsTab.channel || streamsTab.channel ||
      videos[0]?.channel || "",
    channelId: videosTab.channelId || shortsTab.channelId ||
      streamsTab.channelId || videos[0]?.channelId || "",
  };
}

async function getVideoInfo(
  video: VideoEntry,
  options: CliOptions,
  provider?: ProviderHandle,
): Promise<VideoInfoResult> {
  const result = await runCommand(options.ytDlp, [
    ...ytBaseArgs(options, provider),
    "--dump-single-json",
    "--skip-download",
    "--ignore-no-formats-error",
    "--no-playlist",
    video.url,
  ], options.cookies);
  if (result.code !== 0 || !result.stdout.trim()) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    return {
      failure: {
        reason: classifyFailure(detail),
        detail: detail.slice(0, 800),
      },
    };
  }
  try {
    const info = JSON.parse(result.stdout) as Record<string, unknown>;
    if (isIncompleteYoutubeInfo(info)) {
      return {
        failure: {
          reason: "auth_or_pot",
          detail:
            "YouTube 只返回了不完整元数据，未提供格式、频道 ID、时长或字幕清单；通常是反机器人验证。",
        },
      };
    }
    return { info };
  } catch {
    return { failure: { reason: "unknown", detail: "无法解析视频字幕元数据" } };
  }
}

function metadataFor(
  video: VideoEntry,
  info: Record<string, unknown> | undefined,
  language: string,
  kind: CaptionKind,
): MarkdownMetadata {
  const duration = info?.duration ?? video.duration;
  return {
    title: String(info?.title ?? video.title),
    videoId: video.id,
    url: video.url,
    channel: String(info?.channel ?? info?.uploader ?? video.channel ?? ""),
    channelId: String(
      info?.channel_id ?? info?.uploader_id ?? video.channelId ?? "",
    ),
    videoType: video.type,
    publishDate: formatUploadDate(
      info?.upload_date ?? info?.release_date ?? video.uploadDate,
    ),
    durationSeconds: typeof duration === "number" ? duration : null,
    captionLanguage: language,
    captionKind: kind,
    processedAt: new Date().toISOString(),
  };
}

function languageForFilename(language: string): string {
  return language.replace(/-orig$/i, "").replace(/[^A-Za-z0-9._-]/g, "-") ||
    "und";
}

async function findVtt(
  directory: string,
  language: string,
): Promise<string | undefined> {
  const candidates: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && /\.vtt$/i.test(entry.name)) {
      candidates.push(join(directory, entry.name));
    }
  }
  return candidates.find((path) => basename(path).includes(`.${language}.`)) ??
    candidates[0];
}

async function downloadCaption(
  video: VideoEntry,
  info: Record<string, unknown>,
  choice: CaptionChoice,
  options: CliOptions,
  workDir: string,
  provider?: ProviderHandle,
  desiredStem?: string,
): Promise<
  {
    created: number;
    fingerprint?: string;
    failure?: { reason: string; detail: string };
  }
> {
  const videoTemp = join(workDir, video.id);
  await Deno.mkdir(videoTemp, { recursive: true });
  const result = await runCommand(options.ytDlp, [
    ...ytBaseArgs(options, provider),
    "--skip-download",
    "--ignore-no-formats-error",
    "--sub-format",
    "vtt",
    "--sub-langs",
    choice.language,
    choice.kind === "manual" ? "--write-subs" : "--write-auto-subs",
    "--output",
    join(videoTemp, `${video.id}.%(ext)s`),
    "--no-playlist",
    video.url,
  ], options.cookies);
  if (result.code !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    return {
      created: 0,
      failure: {
        reason: classifyFailure(detail),
        detail: detail.slice(0, 800),
      },
    };
  }
  const vtt = await findVtt(videoTemp, choice.language);
  if (!vtt) {
    return {
      created: 0,
      failure: {
        reason: "no_captions",
        detail: "选中的字幕轨没有生成 VTT 文件",
      },
    };
  }
  const cues = parseVtt(await Deno.readTextFile(vtt));
  if (!cues.length) {
    return {
      created: 0,
      failure: { reason: "no_captions", detail: "字幕轨为空" },
    };
  }
  const body = cuesToMarkdownBody(cues);
  const metadata = metadataFor(video, info, choice.language, choice.kind);
  const directory = desiredStem
    ? desiredStem.replace(/[\\/][^\\/]+$/, "")
    : join(options.output, video.type === "short" ? "短视频" : "长视频");
  const stem = desiredStem ??
    join(
      directory,
      `${video.id}__${sanitizeTitle(metadata.title)}.${
        languageForFilename(choice.language)
      }`,
    );
  await Deno.mkdir(directory, { recursive: true });
  let created = 0;
  if (await atomicWrite(`${stem}.srt`, cuesToSrt(cues))) created++;
  if (await atomicWrite(`${stem}.md`, renderMarkdown(metadata, body))) {
    created++;
  }
  return {
    created,
    fingerprint: await sha256Text(
      body.replace(/\s+/g, " ").trim().toLocaleLowerCase(),
    ),
  };
}

async function repairMarkdown(
  video: VideoEntry,
  srtPath: string,
  options: CliOptions,
  provider?: ProviderHandle,
): Promise<
  {
    repaired: boolean;
    fingerprint?: string;
    failure?: { reason: string; detail: string };
  }
> {
  const cues = parseSrt(await Deno.readTextFile(srtPath));
  if (!cues.length) {
    return {
      repaired: false,
      failure: { reason: "invalid_srt", detail: "现有 SRT 没有可解析字幕" },
    };
  }
  const infoResult = await getVideoInfo(video, options, provider);
  const info = infoResult.info;
  const filename = basename(srtPath);
  const language = filename.match(/\.([A-Za-z0-9._-]+)\.srt$/i)?.[1] ?? "und";
  const choice = info ? selectCaptionTrack(info, language) : null;
  const body = cuesToMarkdownBody(cues);
  const mdPath = `${withoutExtension(srtPath)}.md`;
  const metadata = metadataFor(
    video,
    info,
    language,
    choice?.kind ?? "unknown",
  );
  const repaired = await atomicWrite(mdPath, renderMarkdown(metadata, body));
  return {
    repaired,
    fingerprint: await sha256Text(
      body.replace(/\s+/g, " ").trim().toLocaleLowerCase(),
    ),
  };
}

function failure(video: VideoEntry, reason: string, detail: string): Failure {
  return {
    video_id: video.id,
    title: video.title,
    url: video.url,
    reason,
    detail,
  };
}

function pilotFirst(videos: VideoEntry[]): VideoEntry[] {
  const long = videos.filter((video) => video.type === "long");
  const shorts = videos.filter((video) => video.type === "short");
  const ordered: VideoEntry[] = [];
  if (long.length) ordered.push(long.shift()!);
  if (shorts.length) ordered.push(shorts.shift()!);
  while (long.length || shorts.length) {
    if (long.length) ordered.push(long.shift()!);
    if (shorts.length) ordered.push(shorts.shift()!);
  }
  return ordered;
}

function reportMarkdown(summary: RunSummary): string {
  const lines = [
    "# YouTube 字幕导出报告",
    "",
    `- 状态：${summary.status}`,
    `- 频道：${summary.channel || summary.channel_id}`,
    `- 发现：${summary.discovered}（长视频 ${summary.long_videos}，Shorts ${summary.shorts}）`,
    `- 新建文件：${summary.created}`,
    `- 已有跳过：${summary.skipped}`,
    `- 补齐 Markdown：${summary.repaired}`,
    `- 冲突：${summary.conflicts}`,
    `- 失败：${summary.failures.length}`,
    "",
  ];
  if (summary.failures.length) {
    lines.push("## 失败项目", "");
    for (const item of summary.failures) {
      lines.push(
        `- [${item.video_id}](${item.url}) ${item.title}｜${item.reason}｜${
          item.detail.replace(/\s+/g, " ")
        }`,
      );
    }
    lines.push(
      "",
      "无字幕可选择：本地 Whisper（免费但重）、付费 API、人工处理。本次均未自动执行。",
      "",
    );
  }
  if (summary.identical_content.length) {
    lines.push("## 相同字幕内容", "");
    for (const group of summary.identical_content) {
      lines.push(
        `- ${group.video_ids.join(", ")}（${group.fingerprint.slice(0, 12)}）`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function persist(
  summary: RunSummary,
  jobDir: string,
  inventory: VideoEntry[],
): Promise<void> {
  await writeJson(join(jobDir, "manifest.json"), {
    updated_at: new Date().toISOString(),
    summary,
    inventory,
  });
  await Deno.writeTextFile(summary.report_path, reportMarkdown(summary));
}

function resultLine(summary: RunSummary): void {
  console.log(`RESULT_JSON=${JSON.stringify(summary)}`);
}

async function main(): Promise<number> {
  let options: CliOptions;
  let cookiePath: string | undefined;
  try {
    options = parseArgs(Deno.args);
    cookiePath = options.cookies;
    options.output = absolute(options.output);
    options.channel = normalizeChannelInput(options.channel);
    if (options.cookies) await validateCookie(options.cookies);
  } catch (error) {
    const detail = redactSensitive(
      error instanceof Error ? error.message : String(error),
      cookiePath,
    );
    console.error(
      `参数错误：${detail}`,
    );
    return 2;
  }

  const jobKey = (await sha256Text(`${options.channel}\n${options.output}`))
    .slice(0, 20);
  const jobDir = join(appRoot(), "jobs", jobKey);
  const workDir = join(jobDir, `work-${Deno.pid}`);
  await Deno.mkdir(jobDir, { recursive: true });
  await Deno.mkdir(workDir, { recursive: true });
  let provider: ProviderHandle | undefined;
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
  };
  try {
    Deno.addSignalListener("SIGINT", onInterrupt);
  } catch { /* unsupported signal */ }

  try {
    provider = await startProvider(options);
    let enumeration: {
      videos: VideoEntry[];
      channel: string;
      channelId: string;
    };
    try {
      enumeration = await enumerateChannel(options.channel, options, provider);
    } catch (error) {
      const detail = redactSensitive(
        error instanceof Error ? error.message : String(error),
        options.cookies,
      );
      const reason = classifyFailure(detail);
      const status = reason === "auth_or_pot"
        ? (!provider
          ? "needs_pot"
          : !options.cookies
          ? "needs_cookies"
          : "cookie_expired")
        : "enumeration_failed";
      const reportPath = join(jobDir, "last-run.md");
      const summary: RunSummary = {
        status,
        channel: "",
        channel_id: "",
        output: options.output,
        discovered: 0,
        long_videos: 0,
        shorts: 0,
        created: 0,
        skipped: 0,
        repaired: 0,
        conflicts: 0,
        failures: [
          failure(
            {
              id: "channel",
              title: options.channel,
              url: options.channel,
              type: "long",
            },
            reason,
            detail.slice(0, 800),
          ),
        ],
        identical_content: [],
        report_path: reportPath,
      };
      await persist(summary, jobDir, []);
      resultLine(summary);
      if (status === "needs_pot") return 21;
      if (status === "needs_cookies") return 22;
      if (status === "cookie_expired") return 23;
      return 40;
    }

    const reportPath = join(jobDir, "last-run.md");
    const summary: RunSummary = {
      status: options.dryRun ? "dry_run" : "running",
      channel: enumeration.channel,
      channel_id: enumeration.channelId,
      output: options.output,
      discovered: enumeration.videos.length,
      long_videos: enumeration.videos.filter((video) =>
        video.type === "long"
      ).length,
      shorts: enumeration.videos.filter((video) =>
        video.type === "short"
      ).length,
      created: 0,
      skipped: 0,
      repaired: 0,
      conflicts: 0,
      failures: [],
      identical_content: [],
      report_path: reportPath,
    };
    await persist(summary, jobDir, enumeration.videos);
    if (options.dryRun) {
      summary.status = "dry_run_complete";
      await persist(summary, jobDir, enumeration.videos);
      resultLine(summary);
      return 0;
    }

    await Deno.mkdir(join(options.output, "长视频"), { recursive: true });
    await Deno.mkdir(join(options.output, "短视频"), { recursive: true });
    const existing = await scanExisting(options.output);
    const contentGroups = new Map<string, string[]>();
    let consecutiveAuth = 0;
    const pendingAll = enumeration.videos.filter((video) => {
      const pair = existing.get(video.id);
      return !pair || pair.srt.length !== 1 || pair.md.length !== 1 ||
        withoutExtension(pair.srt[0]) !== withoutExtension(pair.md[0]);
    });
    summary.skipped = enumeration.videos.length - pendingAll.length;
    const orderedPending = pilotFirst(pendingAll);
    const pending = options.maxItems
      ? orderedPending.slice(0, options.maxItems)
      : orderedPending;

    for (let index = 0; index < pending.length; index++) {
      if (interrupted) {
        summary.status = "interrupted";
        break;
      }
      const video = pending[index];
      const pair = existing.get(video.id) ?? { srt: [], md: [] };
      if (
        pair.srt.length > 1 || pair.md.length > 1 ||
        (pair.srt.length === 1 && pair.md.length === 1 &&
          withoutExtension(pair.srt[0]) !== withoutExtension(pair.md[0]))
      ) {
        summary.conflicts++;
        summary.failures.push(
          failure(
            video,
            "duplicate_id_conflict",
            "同一视频 ID 存在多份或不同名文件，未自动删除",
          ),
        );
        continue;
      }

      let fingerprint: string | undefined;
      let networkUsed = false;
      if (pair.srt.length === 1 && pair.md.length === 0) {
        const repaired = await repairMarkdown(
          video,
          pair.srt[0],
          options,
          provider,
        );
        networkUsed = true;
        if (repaired.failure) {
          summary.failures.push(
            failure(video, repaired.failure.reason, repaired.failure.detail),
          );
        }
        if (repaired.repaired) summary.repaired++;
        fingerprint = repaired.fingerprint;
      } else {
        networkUsed = true;
        const infoResult = await getVideoInfo(video, options, provider);
        if (infoResult.failure) {
          summary.failures.push(
            failure(
              video,
              infoResult.failure.reason,
              infoResult.failure.detail,
            ),
          );
          if (
            infoResult.failure.reason === "auth_or_pot" ||
            infoResult.failure.reason === "cookie_expired"
          ) consecutiveAuth++;
          else consecutiveAuth = 0;
        } else {
          const choice = selectCaptionTrack(infoResult.info!, options.language);
          if (!choice) {
            summary.failures.push(
              failure(
                video,
                "no_captions",
                `没有 ${
                  options.language === "source" ? "原语言" : options.language
                } 的人工或自动字幕`,
              ),
            );
            consecutiveAuth = 0;
          } else {
            const desiredStem = pair.md.length === 1
              ? withoutExtension(pair.md[0])
              : undefined;
            const downloaded = await downloadCaption(
              video,
              infoResult.info!,
              choice,
              options,
              workDir,
              provider,
              desiredStem,
            );
            if (downloaded.failure) {
              summary.failures.push(
                failure(
                  video,
                  downloaded.failure.reason,
                  downloaded.failure.detail,
                ),
              );
              if (
                downloaded.failure.reason === "auth_or_pot" ||
                downloaded.failure.reason === "cookie_expired"
              ) consecutiveAuth++;
              else consecutiveAuth = 0;
            } else {
              summary.created += downloaded.created;
              fingerprint = downloaded.fingerprint;
              consecutiveAuth = 0;
            }
          }
        }
      }

      if (fingerprint) {
        const ids = contentGroups.get(fingerprint) ?? [];
        ids.push(video.id);
        contentGroups.set(fingerprint, ids);
      }
      summary.identical_content = [...contentGroups.entries()].filter((
        [, ids],
      ) => ids.length > 1).map(([fp, ids]) => ({
        fingerprint: fp,
        video_ids: ids,
      }));
      await persist(summary, jobDir, enumeration.videos);

      if (consecutiveAuth > 0 && !provider) {
        summary.status = "needs_pot";
        await persist(summary, jobDir, enumeration.videos);
        resultLine(summary);
        return 21;
      }
      if (consecutiveAuth > 0 && provider && !options.cookies) {
        summary.status = "needs_cookies";
        await persist(summary, jobDir, enumeration.videos);
        resultLine(summary);
        return 22;
      }
      if (consecutiveAuth >= 3) {
        summary.status = "cookie_expired";
        await persist(summary, jobDir, enumeration.videos);
        resultLine(summary);
        return 23;
      }

      if (index + 1 === Math.min(options.pilot, pending.length)) {
        console.log(
          `试跑完成：${
            Math.min(options.pilot, pending.length)
          } 条，继续批量处理。`,
        );
      }
      if ((index + 1) % 25 === 0) {
        console.log(`已完成本批 ${index + 1}/${pending.length}。`);
      }
      if (networkUsed && index < pending.length - 1) {
        const delay = 5000 + Math.floor(Math.random() * 5001);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (summary.status === "running") {
      summary.status = summary.failures.length
        ? "complete_with_failures"
        : "complete";
    }
    await persist(summary, jobDir, enumeration.videos);
    resultLine(summary);
    return 0;
  } finally {
    try {
      Deno.removeSignalListener("SIGINT", onInterrupt);
    } catch { /* unsupported signal */ }
    await stopProvider(provider);
    if (await exists(workDir)) {
      await Deno.remove(workDir, { recursive: true }).catch(() => undefined);
    }
  }
}

if (import.meta.main) {
  const code = await main().catch((error) => {
    console.error(
      `未处理错误：${
        redactSensitive(
          error instanceof Error ? error.stack ?? error.message : String(error),
        )
      }`,
    );
    return 40;
  });
  Deno.exit(code);
}
