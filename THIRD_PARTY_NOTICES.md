# Third-party notices

This repository does not redistribute the following binaries or source trees. The bootstrap scripts download pinned releases at runtime after user confirmation and verify every downloaded archive with SHA-256.

| Project | Purpose | Pinned version | License | Source |
|---|---|---:|---|---|
| Deno | Runs the bundled TypeScript implementation | 2.9.2 | MIT | https://github.com/denoland/deno |
| yt-dlp | Enumerates YouTube channels and downloads caption tracks | 2026.07.04 | Unlicense | https://github.com/yt-dlp/yt-dlp |
| bgutil-ytdlp-pot-provider | Optional PO Token Provider used only after explicit confirmation | 1.3.1 | GPL-3.0 | https://github.com/Brainicism/bgutil-ytdlp-pot-provider |

The corresponding download URLs, file sizes, commits and SHA-256 hashes are recorded in [`toolchain.lock.json`](skills/extract-youtube-creator-transcripts/toolchain.lock.json).
