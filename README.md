# bb-plugin-opencode-go

A headless bb plugin that registers an **OpenCode Go** AI service for thread titles
and commit messages, using an [OpenCode Go](https://opencode.ai/docs/go/)
subscription instead of Codex or bb cloud.

- Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`
- Default model: `glm-5.3-flash` (setting: `model`)
- Key: `opencode-go` entry in opencode's `auth.json`, falling back to `OPENCODE_GO_API_KEY`

```sh
npm install --include=dev
npm test
npm run typecheck
bb plugin install .
bb settings ai-services set thread-title opencode-go
bb settings ai-services set commit-message opencode-go
```

See `skills/opencode-go/SKILL.md` for status messages and troubleshooting.

Install from GitHub:

```sh
bb plugin install git:https://github.com/scowalt/bb-plugin-opencode-go.git
```

## License

MIT
