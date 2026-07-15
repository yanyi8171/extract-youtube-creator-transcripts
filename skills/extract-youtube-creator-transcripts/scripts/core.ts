export type VideoType = "long" | "short";
export type CaptionKind = "manual" | "automatic" | "unknown";

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface VideoEntry {
  id: string;
  title: string;
  url: string;
  type: VideoType;
  channel?: string;
  channelId?: string;
  uploadDate?: string;
  duration?: number;
}

export interface CaptionChoice {
  language: string;
  kind: Exclude<CaptionKind, "unknown">;
}

export interface ExistingPair {
  srt: string[];
  md: string[];
}

export interface MarkdownMetadata {
  title: string;
  videoId: string;
  url: string;
  channel: string;
  channelId: string;
  videoType: VideoType;
  publishDate: string;
  durationSeconds: number | null;
  captionLanguage: string;
  captionKind: CaptionKind;
  processedAt: string;
}

const TIMING =
  /((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseTimestamp(value: string): number {
  const parts = value.replace(",", ".").split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(`无效时间码：${value}`);
  }
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) {
    throw new Error(`无效时间码：${value}`);
  }
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lrm: "",
    rlm: "",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const hex = code[1]?.toLowerCase() === "x";
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

export function cleanCueText(text: string): string {
  return decodeEntities(
    text
      .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function parseVtt(input: string): Cue[] {
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(
    "\n",
  );
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === "WEBVTT" || line.startsWith("X-TIMESTAMP-MAP")) {
      i++;
      continue;
    }
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(line)) {
      i++;
      while (i < lines.length && lines[i].trim()) i++;
      continue;
    }
    let timingLine = line;
    if (
      !TIMING.test(timingLine) && i + 1 < lines.length &&
      TIMING.test(lines[i + 1])
    ) {
      i++;
      timingLine = lines[i].trim();
    }
    const match = timingLine.match(TIMING);
    if (!match) {
      i++;
      continue;
    }
    const startMs = parseTimestamp(match[1]);
    const endMs = parseTimestamp(match[2]);
    i++;
    const text: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      text.push(lines[i]);
      i++;
    }
    const cleaned = cleanCueText(text.join("\n"));
    if (cleaned && endMs >= startMs) {
      cues.push({ startMs, endMs, text: cleaned });
    }
  }
  return cues;
}

export function parseSrt(input: string): Cue[] {
  const blocks = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(
    /\n{2,}/,
  );
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(TIMING)!;
    const text = cleanCueText(lines.slice(timingIndex + 1).join("\n"));
    if (text) {
      cues.push({
        startMs: parseTimestamp(match[1]),
        endMs: parseTimestamp(match[2]),
        text,
      });
    }
  }
  return cues;
}

function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${String(hours).padStart(2, "0")}:${
    String(minutes).padStart(2, "0")
  }:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function cuesToSrt(cues: Cue[]): string {
  return cues.map((cue, index) =>
    `${index + 1}\n${formatSrtTime(cue.startMs)} --> ${
      formatSrtTime(cue.endMs)
    }\n${cue.text}`
  ).join("\n\n") + "\n";
}

interface Token {
  raw: string;
  norm: string;
}

function tokens(text: string): Token[] {
  const values = text.replace(/\n+/g, " ").match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu,
  ) ?? [];
  return values.map((raw) => ({
    raw,
    norm: raw.normalize("NFKC").toLocaleLowerCase(),
  }));
}

function sameToken(a: Token, b: Token): boolean {
  return a.norm === b.norm;
}

function findOverlap(previous: Token[], next: Token[]): number {
  const max = Math.min(100, previous.length, next.length);
  for (let size = max; size > 0; size--) {
    let equal = true;
    for (let i = 0; i < size; i++) {
      if (!sameToken(previous[previous.length - size + i], next[i])) {
        equal = false;
        break;
      }
    }
    if (equal) return size;
  }
  return 0;
}

function isContainedInTail(previous: Token[], next: Token[]): boolean {
  if (!next.length || next.length > previous.length) return false;
  const start = Math.max(0, previous.length - 140);
  for (let i = start; i <= previous.length - next.length; i++) {
    if (next.every((token, offset) => sameToken(previous[i + offset], token))) {
      return true;
    }
  }
  return false;
}

const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NO_SPACE_BEFORE = /^[,.;:!?%\)\]\}，。；：！？、）》】”’]$/u;
const NO_SPACE_AFTER = /^[\(\[\{（《【“‘]$/u;

function joinTokens(values: Token[]): string {
  let output = "";
  for (let i = 0; i < values.length; i++) {
    const current = values[i].raw;
    const previous = i > 0 ? values[i - 1].raw : "";
    const addSpace = output && !NO_SPACE_BEFORE.test(current) &&
      !NO_SPACE_AFTER.test(previous) && !CJK.test(current) &&
      !CJK.test(previous);
    output += `${addSpace ? " " : ""}${current}`;
  }
  return output;
}

function joinFragment(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const last = left.at(-1) ?? "";
  const first = right[0] ?? "";
  const space = !NO_SPACE_AFTER.test(last) && !NO_SPACE_BEFORE.test(first) &&
    !CJK.test(last) && !CJK.test(first);
  return `${left}${space ? " " : ""}${right}`;
}

function splitLongParagraph(text: string, limit = 720): string[] {
  const result: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = -1;
    const sentence = /[.!?。！？](?:["'”’）】》])?\s*/gu;
    for (const match of window.matchAll(sentence)) {
      if ((match.index ?? 0) >= 280) cut = (match.index ?? 0) + match[0].length;
    }
    if (cut < 0) cut = window.lastIndexOf(" ");
    if (cut < 280) cut = limit;
    result.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) result.push(rest);
  return result;
}

export function cuesToMarkdownBody(cues: Cue[]): string {
  const accumulated: Token[] = [];
  const paragraphs: string[] = [];
  let paragraph = "";
  let previousEnd = 0;
  for (const cue of cues) {
    const next = tokens(cue.text);
    if (!next.length || isContainedInTail(accumulated, next)) {
      previousEnd = Math.max(previousEnd, cue.endMs);
      continue;
    }
    const overlap = findOverlap(accumulated, next);
    const fresh = next.slice(overlap);
    if (!fresh.length) continue;
    if (cue.startMs - previousEnd > 2500 && paragraph.length >= 180) {
      paragraphs.push(...splitLongParagraph(paragraph));
      paragraph = "";
    }
    paragraph = joinFragment(paragraph, joinTokens(fresh));
    accumulated.push(...fresh);
    if (accumulated.length > 400) {
      accumulated.splice(0, accumulated.length - 300);
    }
    previousEnd = Math.max(previousEnd, cue.endMs);
    if (paragraph.length >= 900) {
      const parts = splitLongParagraph(paragraph);
      paragraphs.push(...parts.slice(0, -1));
      paragraph = parts.at(-1) ?? "";
    }
  }
  if (paragraph.trim()) paragraphs.push(...splitLongParagraph(paragraph));
  return paragraphs.filter(Boolean).join("\n\n").trim() +
    (paragraphs.length ? "\n" : "");
}

function yaml(value: string): string {
  return `"${
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")
  }"`;
}

export function renderMarkdown(
  metadata: MarkdownMetadata,
  body: string,
): string {
  const duration = metadata.durationSeconds === null
    ? "null"
    : String(Math.round(metadata.durationSeconds));
  return [
    "---",
    `title: ${yaml(metadata.title)}`,
    `video_id: ${yaml(metadata.videoId)}`,
    `url: ${yaml(metadata.url)}`,
    `channel: ${yaml(metadata.channel)}`,
    `channel_id: ${yaml(metadata.channelId)}`,
    `video_type: ${metadata.videoType}`,
    `publish_date: ${metadata.publishDate || "null"}`,
    `duration_seconds: ${duration}`,
    `caption_language: ${yaml(metadata.captionLanguage)}`,
    `caption_kind: ${metadata.captionKind}`,
    `processed_at: ${yaml(metadata.processedAt)}`,
    "---",
    "",
    `# ${metadata.title}`,
    "",
    body.trim(),
    "",
  ].join("\n");
}

export function sanitizeTitle(title: string, maxCodePoints = 120): string {
  let value = Array.from(
    title.normalize("NFKC"),
    (character) => character.charCodeAt(0) < 32 ? " " : character,
  ).join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) {
    value = `_${value}`;
  }
  value = Array.from(value).slice(0, maxCodePoints).join("").replace(
    /[. ]+$/g,
    "",
  ).trim();
  return value || "untitled";
}

export function normalizeChannelInput(input: string): string {
  const value = input.trim();
  if (/^@[A-Za-z0-9._-]+$/.test(value)) {
    return `https://www.youtube.com/${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("频道必须是 YouTube 频道链接或 @handle");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") {
    throw new Error("只接受 YouTube 频道链接");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    !parts.length || ["watch", "playlist", "shorts", "live"].includes(parts[0])
  ) throw new Error("请提供频道主页链接，不要提供单条视频或播放列表链接");
  if (
    ["videos", "shorts", "streams", "featured"].includes(parts.at(-1) ?? "")
  ) parts.pop();
  url.pathname = `/${parts.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function platformAssetKey(
  os: "windows" | "darwin",
  arch: "x86_64" | "aarch64",
): string {
  return `${os === "darwin" ? "macos" : "windows"}-${
    arch === "aarch64" ? "arm64" : "x64"
  }`;
}

function languageMatches(key: string, requested: string): boolean {
  const clean = key.toLowerCase().replace(/-orig$/, "");
  const want = requested.toLowerCase();
  return clean === want || clean.startsWith(`${want}-`) ||
    want.startsWith(`${clean}-`);
}

function chooseKey(keys: string[], requested: string): string | undefined {
  return keys.find((key) => key.toLowerCase() === requested.toLowerCase()) ??
    keys.find((key) => languageMatches(key, requested));
}

export function selectCaptionTrack(
  info: Record<string, unknown>,
  requested = "source",
): CaptionChoice | null {
  const manualObject =
    (info.subtitles && typeof info.subtitles === "object"
      ? info.subtitles
      : {}) as Record<string, unknown>;
  const autoObject =
    (info.automatic_captions && typeof info.automatic_captions === "object"
      ? info.automatic_captions
      : {}) as Record<string, unknown>;
  const manual = Object.keys(manualObject).sort();
  const automatic = Object.keys(autoObject).sort();
  if (requested !== "source") {
    const manualKey = chooseKey(manual, requested);
    if (manualKey) return { language: manualKey, kind: "manual" };
    const autoKey = chooseKey(automatic, requested);
    return autoKey ? { language: autoKey, kind: "automatic" } : null;
  }
  const source = typeof info.language === "string" ? info.language : "";
  if (source) {
    const manualKey = chooseKey(manual, source);
    if (manualKey) return { language: manualKey, kind: "manual" };
  }
  const manualOriginal = manual.find((key) => /-orig$/i.test(key));
  if (manualOriginal) return { language: manualOriginal, kind: "manual" };
  if (manual.length === 1) return { language: manual[0], kind: "manual" };
  if (manual.includes("en")) return { language: "en", kind: "manual" };
  if (source) {
    const autoKey = chooseKey(automatic, `${source}-orig`) ??
      chooseKey(automatic, source);
    if (autoKey) return { language: autoKey, kind: "automatic" };
  }
  const autoOriginal = automatic.find((key) => /-orig$/i.test(key));
  if (autoOriginal) return { language: autoOriginal, kind: "automatic" };
  if (automatic.length === 1) {
    return { language: automatic[0], kind: "automatic" };
  }
  if (automatic.includes("en-orig")) {
    return { language: "en-orig", kind: "automatic" };
  }
  if (automatic.includes("en")) return { language: "en", kind: "automatic" };
  return manual.length ? { language: manual[0], kind: "manual" } : null;
}

export function isIncompleteYoutubeInfo(
  info: Record<string, unknown>,
): boolean {
  const manual = info.subtitles && typeof info.subtitles === "object"
    ? Object.keys(info.subtitles as Record<string, unknown>).length
    : 0;
  const automatic = info.automatic_captions &&
      typeof info.automatic_captions === "object"
    ? Object.keys(info.automatic_captions as Record<string, unknown>).length
    : 0;
  const formats = Array.isArray(info.formats) ? info.formats.length : 0;
  return String(info.extractor ?? "").toLowerCase() === "youtube" &&
    formats === 0 && manual === 0 && automatic === 0 &&
    !info.channel_id && info.duration == null;
}

export async function scanExisting(
  root: string,
): Promise<Map<string, ExistingPair>> {
  const index = new Map<string, ExistingPair>();
  for (const directory of ["长视频", "短视频"]) {
    const path = `${root}${
      root.endsWith("/") || root.endsWith("\\") ? "" : "/"
    }${directory}`;
    try {
      for await (const entry of Deno.readDir(path)) {
        if (!entry.isFile) continue;
        const match = entry.name.match(/^([A-Za-z0-9_-]{11})__/);
        if (!match || !VIDEO_ID.test(match[1])) continue;
        const pair = index.get(match[1]) ?? { srt: [], md: [] };
        const full = `${path}/${entry.name}`;
        if (/\.srt$/i.test(entry.name)) pair.srt.push(full);
        if (/\.md$/i.test(entry.name)) pair.md.push(full);
        index.set(match[1], pair);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return index;
}

export function formatUploadDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : value;
}

export function classifyFailure(message: string): string {
  const value = message.toLowerCase();
  if (
    /sign in to confirm|not a bot|po token|proof of origin|http error 403/.test(
      value,
    )
  ) return "auth_or_pot";
  if (/private video|members-only|join this channel/.test(value)) {
    return "members_or_private";
  }
  if (/not available in your country|region|geo-restricted/.test(value)) {
    return "region_restricted";
  }
  if (
    /video unavailable|removed by the uploader|has been removed/.test(value)
  ) return "removed";
  if (/cookie|login required|sign in/.test(value)) return "cookie_expired";
  if (
    /timed out|temporary failure|network|connection|unable to download/.test(
      value,
    )
  ) return "network";
  return "unknown";
}

export function redactSensitive(text: string, cookiePath?: string): string {
  let output = text.replace(
    /(--cookies(?:=|\s+))(?:"[^"]+"|'[^']+'|\S+)/gi,
    "$1[REDACTED]",
  );
  if (cookiePath) {
    output = output.split(cookiePath).join("[REDACTED_COOKIE_PATH]");
  }
  return output;
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
