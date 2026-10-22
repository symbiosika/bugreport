# Changelog

All notable changes to the `@symbiosika/bugreport-*` packages are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the packages use [Semantic Versioning](https://semver.org/) — while the
version is `0.x`, minor releases may contain breaking changes.

## [Unreleased]

## [0.1.0]

Initial public release.

- `@symbiosika/bugreport-core`: shared types, valibot schemas and the
  normalized `BugReport` contract.
- `@symbiosika/bugreport-client`: consent dialog, recording overlay (Shadow
  DOM), screen frame sampling, optional video, microphone recording, console /
  network / breadcrumb collection, redaction, upload.
- `@symbiosika/bugreport-vue`: `<BugReportButton />` and `useBugReport()`.
- `@symbiosika/bugreport-server`: web-standard request handler, validation,
  rate limiting, frame-selection heuristic, processing pipeline and the
  `StorageAdapter`, `LlmAdapter` and `BugReportAction` interfaces.
