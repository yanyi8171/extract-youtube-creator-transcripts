import {
  classifyFailure,
  cuesToMarkdownBody,
  cuesToSrt,
  isIncompleteYoutubeInfo,
  normalizeChannelInput,
  parseSrt,
  parseVtt,
  redactSensitive,
  renderMarkdown,
  sanitizeTitle,
  selectCaptionTrack,
} from "../core.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

Deno.test("VTT converts to valid SRT and clean rolling transcript", async () => {
  const fixture = new URL("./fixtures/rolling.en.vtt", import.meta.url);
  const cues = parseVtt(await Deno.readTextFile(fixture));
  assert(cues.length === 4, `expected 4 cues, got ${cues.length}`);
  const srt = cuesToSrt(cues);
  assert(
    srt.includes("00:00:00,000 --> 00:00:02,000"),
    "SRT time conversion failed",
  );
  assert(parseSrt(srt).length === cues.length, "SRT roundtrip failed");
  const body = cuesToMarkdownBody(cues);
  assert(
    body.includes("Hello world this is a test."),
    `unexpected body: ${body}`,
  );
  assert(
    count(body.toLowerCase(), "hello world") === 1,
    "rolling phrase was duplicated",
  );
  assert(!body.includes("-->"), "Markdown body leaked a timeline");
});

Deno.test("Chinese rolling captions deduplicate without adding spaces", async () => {
  const fixture = new URL("./fixtures/rolling.zh.vtt", import.meta.url);
  const body = cuesToMarkdownBody(parseVtt(await Deno.readTextFile(fixture)));
  assert(
    count(body, "我们开始") === 1,
    `Chinese rolling phrase duplicated: ${body}`,
  );
  assert(body.includes("我们开始讨论今天的问题。"), "Chinese sentence changed");
  assert(!body.includes("我 们"), "spaces were inserted inside CJK text");
});

Deno.test("caption selection prefers manual and avoids translated auto tracks", () => {
  const manual = selectCaptionTrack({
    language: "en",
    subtitles: { en: [{}] },
    automatic_captions: { "en-orig": [{}], zh: [{}] },
  }, "source");
  assert(
    manual?.kind === "manual" && manual.language === "en",
    "manual source caption was not preferred",
  );
  const automatic = selectCaptionTrack({
    language: "es",
    subtitles: {},
    automatic_captions: { "es-orig": [{}], en: [{}], zh: [{}] },
  }, "source");
  assert(
    automatic?.kind === "automatic" && automatic.language === "es-orig",
    "original auto track was not selected",
  );
  const requested = selectCaptionTrack({
    subtitles: { "en-US": [{}] },
    automatic_captions: { en: [{}] },
  }, "en");
  assert(
    requested?.kind === "manual" && requested.language === "en-US",
    "requested manual language was not preferred",
  );
});

Deno.test("filenames and channel URLs are cross-platform safe", () => {
  assert(
    sanitizeTitle("CON.") === "_CON",
    "Windows reserved title was not sanitized",
  );
  assert(
    sanitizeTitle('A/B? "test".') === "A B test",
    "invalid filename characters were not sanitized",
  );
  assert(
    Array.from(sanitizeTitle("a".repeat(300))).length === 120,
    "long title was not truncated",
  );
  assert(
    normalizeChannelInput("@dankoe") === "https://www.youtube.com/@dankoe",
    "handle normalization failed",
  );
  assert(
    normalizeChannelInput("https://www.youtube.com/@dankoe/shorts?x=1") ===
      "https://www.youtube.com/@dankoe",
    "tab URL normalization failed",
  );
});

Deno.test("Markdown metadata is complete and timelines are absent", () => {
  const markdown = renderMarkdown({
    title: "Test",
    videoId: "abcdefghijk",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    channel: "Creator",
    channelId: "UC123",
    videoType: "short",
    publishDate: "2026-07-15",
    durationSeconds: 42,
    captionLanguage: "en",
    captionKind: "automatic",
    processedAt: "2026-07-15T00:00:00.000Z",
  }, "Clean transcript.");
  for (
    const field of [
      "video_id",
      "channel_id",
      "video_type",
      "caption_language",
      "caption_kind",
      "processed_at",
    ]
  ) {
    assert(markdown.includes(`${field}:`), `missing metadata field ${field}`);
  }
  assert(!markdown.includes("-->"), "timeline leaked into Markdown");
});

Deno.test("failure classification and cookie redaction are safe", () => {
  assert(
    classifyFailure("Sign in to confirm you're not a bot") === "auth_or_pot",
    "bot check misclassified",
  );
  assert(
    classifyFailure("This is a private video") === "members_or_private",
    "private video misclassified",
  );
  const path = "C:\\Users\\me\\Desktop\\cookies.txt";
  const redacted = redactSensitive(`yt-dlp --cookies \"${path}\" URL`, path);
  assert(!redacted.includes("cookies.txt"), "cookie path leaked");
  assert(redacted.includes("[REDACTED]"), "redaction marker missing");
});

Deno.test("incomplete YouTube metadata is treated as bot verification", () => {
  assert(
    isIncompleteYoutubeInfo({
      extractor: "youtube",
      formats: [],
      subtitles: {},
      automatic_captions: {},
      channel_id: null,
      duration: null,
    }),
    "bot-blocked metadata was mistaken for a real no-caption video",
  );
  assert(
    !isIncompleteYoutubeInfo({
      extractor: "youtube",
      formats: [{ format_id: "sb0" }],
      subtitles: {},
      automatic_captions: {},
      channel_id: "UC123",
      duration: 60,
    }),
    "accessible no-caption video was mistaken for bot verification",
  );
});
