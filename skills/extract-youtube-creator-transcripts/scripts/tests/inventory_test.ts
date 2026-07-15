import { scanExisting } from "../core.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("existing index detects complete, missing and conflicting pairs", async () => {
  const root = await Deno.makeTempDir({ prefix: "yt-transcript-index-" });
  try {
    await Deno.mkdir(`${root}/长视频`);
    await Deno.mkdir(`${root}/短视频`);
    await Deno.writeTextFile(
      `${root}/长视频/abcdefghijk__Complete.en.srt`,
      "x",
    );
    await Deno.writeTextFile(`${root}/长视频/abcdefghijk__Complete.en.md`, "x");
    await Deno.writeTextFile(`${root}/长视频/lmnopqrstuv__OnlySrt.en.srt`, "x");
    await Deno.writeTextFile(`${root}/短视频/12345678901__A.en.srt`, "x");
    await Deno.writeTextFile(`${root}/短视频/12345678901__B.en.srt`, "x");
    const index = await scanExisting(root);
    assert(
      index.get("abcdefghijk")?.srt.length === 1 &&
        index.get("abcdefghijk")?.md.length === 1,
      "complete pair missing",
    );
    assert(
      index.get("lmnopqrstuv")?.srt.length === 1 &&
        index.get("lmnopqrstuv")?.md.length === 0,
      "SRT-only pair not detected",
    );
    assert(
      index.get("12345678901")?.srt.length === 2,
      "duplicate ID conflict not detected",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
