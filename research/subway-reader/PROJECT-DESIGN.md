# Subway Reader — project design (exported from factory v0, 2026-08-26)

Mockups: https://claude.ai/code/artifact/980f0773-adfa-410a-b3af-47578dcc58e4

Read feeds and saved articles **fully offline** — on e-ink first (Boox Go 7), on iPhone after.

**The problem:** RSS/news readers require a connection to load articles — useless on the subway. Read-later apps that cache offline aren't built for e-ink.

**The core loop:** auto-download full article content (readability-extracted text + images) on a schedule (e.g. 6 AM on WiFi) → read paginated, high-contrast, zero-animation → unstarred articles auto-expire after N days so the device stays clean.

**Why now:** Pocket shut down in 2025; no surviving reader is offline-first + e-ink-first. Boox/Kobo/Hisense users are a real, underserved community.

**Path:** personal daily-driver first (sideloaded to Boox), designed so nothing is hardcoded — any feeds, any schedule, any retention rules. iPhone version after the Boox app is a daily driver. Generalize/publish later (F-Droid + Play Store + App Store).

## Architecture

Android ships first, native, and **no cross-platform tax is paid before there is a second platform**:

```
subway-reader/
  core/          pure Kotlin — feeds, prefetch, readability, retention, store
                 NO Android imports; this is the KMP module before it is one
  androidApp/    Compose — e-ink reading UI, WorkManager, Onyx e-ink refresh
  iosApp/        (later) SwiftUI — reading UI, BGTaskScheduler
```

`core/` is promoted to a Kotlin Multiplatform module when the iOS work starts, and SwiftUI is written on top of it. Nothing is rewritten. The rule that makes this work is on the engine tickets: **no Android imports in `core/`**.

Not React Native/Expo: the two things that make this distinctive on its lead platform — Onyx e-ink refresh control and the pen ink path — are native Android APIs, so a JS framework would be carried for an app whose differentiators live outside it. If iPhone were the lead platform, that answer would flip.

## Known platform constraint

**iOS will not guarantee a scheduled 6 AM fetch.** `BGTaskScheduler` is opportunistic — you request "no earlier than," and iOS decides from charging, battery and usage patterns. Android's WorkManager gets a real window. This is true in Swift, Kotlin or JavaScript alike, so the iPhone version's core promise is inherently softer than the Boox version's and the UI should not claim otherwise.

**V2 direction:** stylus annotation layer (vector strokes anchored to article text, Onyx Pen SDK fast path) exporting to Obsidian; web app for saving + reading with account sync — potentially growing into a self-built Readwise replacement connected directly to Obsidian.

**Design:** [V1 screen mockups (6 screens, e-ink design)](https://claude.ai/code/artifact/980f0773-adfa-410a-b3af-47578dcc58e4)
