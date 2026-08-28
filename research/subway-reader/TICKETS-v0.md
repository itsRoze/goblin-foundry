# Subway Reader — v0 ticket breakdown (exported 2026-08-26; horizontal, to be re-cut into vertical slices)

## Dependencies

- SR-1 blocks SR-2
- SR-2 blocks SR-3
- SR-3 blocks SR-4
- SR-3 blocks SR-5
- SR-3 blocks SR-6
- SR-4 blocks SR-8
- SR-4 blocks SR-13
- SR-5 blocks SR-7
- SR-6 blocks SR-8
- SR-7 blocks SR-8
- SR-7 blocks SR-14
- SR-8 blocks SR-9
- SR-9 blocks SR-10
- SR-9 blocks SR-11
- SR-9 blocks SR-12

## SR-1 — Scaffold: Gradle modules, Android shell, and an APK on the Boox

The repo is an empty `git init`. Nothing downstream can start until there is a
build, and this is the ticket that decides the module boundary every other
ticket has been written against.

**Gradle, multi-module:**

```
settings.gradle.kts
gradle/libs.versions.toml     version catalog — Kotlin, AGP, Compose pinned here
core/       build.gradle.kts  kotlin("jvm")  ← NOT com.android.library
androidApp/ build.gradle.kts  com.android.application, depends on core
```

**`core/` is a plain Kotlin JVM module, and that is the whole point.** SR-2, SR-3
and SR-5 all say "no Android imports in core/". As a JVM module that stops being
a rule anyone has to remember — an Android import will not compile. It is also
what makes SR-8 (KMP promotion) a build-file change instead of an extraction:
swap the plugin, add the iOS targets, done.

**minSdk / targetSdk:** read them off the Boox Go 7 rather than guessing. Check
what the device actually runs (`adb shell getprop ro.build.version.release` /
`ro.build.version.sdk`) and set minSdk from that, not from a default.

**Sideload path:** prove it now, while the app is empty and a failure is cheap.
Developer options + ADB over USB or WiFi, install a debug build, launch it.

Done when:
- `./gradlew build` is green from a clean checkout
- an empty Compose activity installs and launches on the Boox Go 7
- `core/` has a passing placeholder test, run by `./gradlew :core:test`
- adding `import android.content.Context` to a file in `core/` FAILS the build
  — verify this by hand once; it is the guarantee the rest of the graph rests on

Not in scope: any feature. This ticket ends at a running blank app.

(smriti's own bootstrap — PROJECT.md, principles install — happens on the first
`/begin` in the repo and is not work for this ticket.)

## SR-2 — Feed engine: RSS/Atom subscriptions + OPML import

Parse RSS and Atom feeds, manage subscriptions, import/export OPML. Foundation for everything else.

Lives in `core/` — pure Kotlin, **no Android imports**. This module is promoted to a Kotlin Multiplatform shared module when the iOS app starts (SR-8), so an Android dependency here is a rewrite later.

## SR-3 — Scheduled offline prefetch

WorkManager job at a user-set time (e.g. 6 AM), WiFi-aware. Fetch each new item's full page, run readability extraction, cache images locally. Everything must be readable with zero network — this is the core promise of the app.

Split: fetch + readability extraction + image caching live in `core/` (pure Kotlin, **no Android imports**). WorkManager is the Android *driver* for that core and stays in `androidApp/`. iOS supplies its own driver in SR-9.

## SR-4 — E-ink reading UI

Paginated tap-to-page reading view (never scroll), high-contrast serif typography, zero animation, e-ink refresh-aware. This is the product's identity — where we win the e-ink niche.

Android only. Onyx e-ink refresh control (fast/A2 for paging, full refresh to clear ghosting) is a native Android API and does not cross to iOS. The iPhone reading view is a separate design with none of these constraints — SR-10.

## SR-5 — Retention engine / auto-expiry

Configurable rules: unstarred articles older than N days are auto-deleted by the daily job. Starred articles never expire. Device stays clean by default — no guilt-pile.

Lives in `core/` — pure Kotlin, **no Android imports**. The rules are shared with iOS; only the scheduling that triggers them is per-platform.

## SR-6 — Share-sheet: save URL for tomorrow's batch

Android share-sheet target: share any URL from any app → it's queued and downloaded in the next scheduled batch. Cheap to build, and it quietly turns the app from an RSS reader into a Pocket successor.

Android half. The iOS Share Extension is SR-11.

## SR-7 — Settings: schedule, retention, feeds

Download time picker, WiFi-only toggle, "keep articles for N days" retention rule, "starred never expire," storage cap. Nothing hardcoded — any feeds, any schedule, any retention rules.

Android half — Compose UI over the retention rules in `core/` (SR-5). The iOS settings screen is SR-12.

## SR-8 — iOS: promote core/ to a Kotlin Multiplatform module

The enabling step for the iPhone app, and the first iOS ticket to run.

`core/` was written as pure Kotlin with no Android imports (SR-2, SR-3, SR-5) on top of the JVM-module boundary set up in SR-1, so this is a build-file change plus whatever leaked: swap the Kotlin JVM plugin for the multiplatform one, add the iosArm64/iosSimulatorArm64 targets, and produce an XCFramework the iOS app links against. Audit for JVM-only APIs (java.time, java.io.File, okhttp) and replace them with multiplatform equivalents.

Done when: androidApp still builds and passes unchanged, and the core test suite runs green on an iOS simulator target.

## SR-9 — iOS: scheduled offline prefetch (BGTaskScheduler)

The iOS driver for the prefetch core (SR-3), the counterpart to Android's WorkManager.

**Known constraint, decided at project level:** iOS will not guarantee a 6 AM fetch. BGAppRefreshTask/BGProcessingTask are opportunistic — you register an earliest-begin date and iOS schedules from charging, battery and usage patterns. Design for it rather than around it: register the task, and give the UI an honest "last downloaded" state plus a manual pull so a missed window is recoverable and never silently empty.

Do NOT copy Android's copy in the UI. The Boox app can promise 6 AM; this one cannot.

## SR-10 — iOS: reading view (SwiftUI)

The iPhone counterpart to the e-ink reading UI (SR-4) — a separate design, not a port.

None of the e-ink constraints apply: the phone has a backlight, real animation, and a refresh rate. Pagination stays (it is the reading model, not an e-ink workaround), but the typography, contrast and transitions are free to be phone-native. Reads from core/'s article store; no fetching logic here.

Worth its own design pass before build — the existing mockups are e-ink and should not be followed literally.

## SR-11 — iOS: Share Extension — save URL for next batch

The iOS counterpart to the Android share-sheet target (SR-6). A Share Extension that takes a URL from any app and queues it in core/'s pending-links store for the next prefetch run (SR-9).

Note the App Group requirement: the extension runs in a separate process, so the shared store has to live in an App Group container both the app and the extension can reach.

## SR-12 — iOS: settings — schedule, retention, feeds

The iOS counterpart to SR-7. SwiftUI over the same retention rules in `core/` (SR-5), so behaviour matches Android and only the presentation differs.

One honest divergence: the download-time picker means something weaker here than on Android (see SR-9). Word it as a preferred window, not a guarantee.

## SR-13 — V2: Stylus annotation layer → Obsidian export

V2 — after the daily-driver works. Vector ink strokes anchored to article text (not baked into images), with the Onyx Pen SDK as an optional low-latency fast path on Boox. Export path: each annotated article becomes a Markdown note with embedded ink, dropped into a folder Syncthing carries to the Obsidian vault. Stroke-as-data leaves the door open for handwriting recognition later.

## SR-14 — V2: Web app — save + read articles, account sync

V2 — Pocket/Readwise-Reader-style web app: save articles from the browser, read them on the web, sync state with the Android app via an account. Longer-term this could grow into a self-built Readwise replacement that connects directly to Obsidian.

