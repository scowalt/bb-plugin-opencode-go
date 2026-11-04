---
name: opencode-go
description: "Check, configure, or troubleshoot the OpenCode Go AI service that writes bb thread titles and commit messages."
---

# OpenCode Go AI service

This plugin registers an AI service, `opencode-go`, that answers bb's thread-title
and commit-message prompts with the user's OpenCode Go subscription. It does not
transcribe voice.

## Commands

```sh
bb settings ai-services show
bb settings ai-services set thread-title opencode-go
bb settings ai-services set commit-message opencode-go
bb settings ai-services test thread-title
bb plugin config opencode-go set model deepseek-v4.1-flash
bb plugin reload opencode-go
```

- The model defaults to `glm-5.3-flash`, which answered in 1.4-2.3 s in testing;
  `deepseek-v4.1-flash` took up to 6 s. A model change takes effect after
  `bb plugin reload opencode-go`.
- Automatic mode tries bb cloud first, then registered services by plugin id, so
  `opencode-go` comes before Codex. Choosing `opencode-go` explicitly never falls
  back to another service.

## Key

The plugin reads the key that `opencode auth login` stores under `opencode-go` in
`$XDG_DATA_HOME/opencode/auth.json` (default `~/.local/share/opencode/auth.json`)
on the bb server machine. `OPENCODE_GO_API_KEY` in the server's environment is
used only when that file has no OpenCode Go key. Never print or paste the key.

## Status

- `not ready: No OpenCode Go key …`: run `opencode auth login` on the server machine.
- `not ready: OpenCode Go HTTP 401/402/403 …`: the last call was refused, usually
  because the subscription is inactive or the key was revoked. The service stays
  not ready for 10 minutes, then tries again.
- Other HTTP errors fail that one request and leave the service ready.

bb aborts a title or commit-message request after 5 seconds. Pick a fast model.
