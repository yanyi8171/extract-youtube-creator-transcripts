import { platformAssetKey } from "../core.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("all required platform asset keys are supported", () => {
  assert(
    platformAssetKey("windows", "x86_64") === "windows-x64",
    "Windows x64 mapping failed",
  );
  assert(
    platformAssetKey("windows", "aarch64") === "windows-arm64",
    "Windows ARM64 mapping failed",
  );
  assert(
    platformAssetKey("darwin", "x86_64") === "macos-x64",
    "macOS Intel mapping failed",
  );
  assert(
    platformAssetKey("darwin", "aarch64") === "macos-arm64",
    "macOS Apple Silicon mapping failed",
  );
});

Deno.test("toolchain lock covers all platforms with SHA-256", async () => {
  const lockPath = new URL("../../toolchain.lock.json", import.meta.url);
  const lock = JSON.parse(await Deno.readTextFile(lockPath));
  for (const tool of ["deno", "yt_dlp"]) {
    for (
      const key of ["windows-x64", "windows-arm64", "macos-x64", "macos-arm64"]
    ) {
      const asset = lock[tool].assets[key];
      assert(asset, `${tool} missing ${key}`);
      assert(
        /^https:\/\/github\.com\//.test(asset.url),
        `${tool} ${key} is not an official GitHub URL`,
      );
      assert(
        /^[a-f0-9]{64}$/.test(asset.sha256),
        `${tool} ${key} has invalid SHA-256`,
      );
      assert(asset.size > 1_000_000, `${tool} ${key} size is implausible`);
    }
  }
});

Deno.test("bootstrap scripts stay self-contained and version-aligned", async () => {
  const lock = JSON.parse(
    await Deno.readTextFile(
      new URL("../../toolchain.lock.json", import.meta.url),
    ),
  );
  const ps = await Deno.readTextFile(
    new URL("../bootstrap.ps1", import.meta.url),
  );
  const sh = await Deno.readTextFile(
    new URL("../bootstrap.sh", import.meta.url),
  );
  for (
    const forbidden of [
      "python",
      "node ",
      "ffmpeg",
      "brew install",
      "winget",
      "docker",
    ]
  ) {
    assert(
      !ps.toLowerCase().includes(forbidden),
      `PowerShell bootstrap unexpectedly requires ${forbidden}`,
    );
    assert(
      !sh.toLowerCase().includes(forbidden),
      `macOS bootstrap unexpectedly requires ${forbidden}`,
    );
  }
  assert(
    sh.includes(`DENO_VERSION=\"${lock.deno.version}\"`),
    "macOS Deno version differs from lock",
  );
  assert(
    sh.includes(`YTDLP_VERSION=\"${lock.yt_dlp.version}\"`),
    "macOS yt-dlp version differs from lock",
  );
  assert(
    sh.includes("shasum -a 256"),
    "macOS bootstrap does not verify SHA-256",
  );
  assert(
    ps.includes("Get-FileHash"),
    "Windows bootstrap does not verify SHA-256",
  );
  assert(
    ps.includes("$env:DENO_DIR") && sh.includes("export DENO_DIR="),
    "Deno cache is not isolated inside the private runtime",
  );
  assert(
    !/[^\x00-\x7F]/.test(ps),
    "PowerShell bootstrap must remain ASCII for Windows PowerShell 5.1",
  );
});
