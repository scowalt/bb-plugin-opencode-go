import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  DEFAULT_MODEL,
  createOpencodeGoClient,
  readOpencodeGoKey,
} from "./opencode-go.ts";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    model: {
      type: "string",
      label: "Model",
      description:
        "OpenCode Go model id for thread titles and commit messages, such as deepseek-v4.1-flash or glm-5.3-flash. Reload the plugin after changing it.",
      default: DEFAULT_MODEL,
    },
  });
  const configured = (await settings.get()).model.trim();
  const model = configured.length > 0 ? configured : DEFAULT_MODEL;

  const client = createOpencodeGoClient({
    fetch: globalThis.fetch,
    readKey: () => readOpencodeGoKey(),
    model: () => model,
    now: Date.now,
  });

  bb.experimental_aiServices.register({
    id: "opencode-go",
    displayName: "OpenCode Go",
    complete: (prompt, { signal }) => client.complete(prompt, signal),
    status: () => client.status(),
  });

  bb.log.info(`registered OpenCode Go AI service with model ${model}`);
}
