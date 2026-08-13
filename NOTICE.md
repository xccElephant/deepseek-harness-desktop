# Notices and attribution

## Relationship to DeepSeek

This is an **unofficial, community-built** desktop shell. It is not affiliated
with, endorsed by, or supported by DeepSeek. "DeepSeek" and "DeepSeek Harness"
are names of the upstream project and its author; they are used here only to
describe what this application runs.

For the official project, see
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

## Bundled software

Installers produced from this repository bundle two third-party payloads that
are **not** part of this repository's source:

| Payload | Origin | License |
| --- | --- | --- |
| `@deepseek-ai/dsh` and its dependency tree | [npm](https://www.npmjs.com/package/@deepseek-ai/dsh), built from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | MIT (© DeepSeek) |
| Node.js runtime binary | [nodejs.org/dist](https://nodejs.org/dist/) | MIT (© Node.js contributors, OpenJS Foundation) |

The upstream Harness discloses its own transitive dependency licenses in
[`THIRD_PARTY_NOTICES.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/THIRD_PARTY_NOTICES.md).
That file governs everything inside the bundled `resources/dsh` payload.

This repository's own source code (the Electron shell under `src/`, the build
scripts under `scripts/`) is licensed under the MIT license in
[`LICENSE`](LICENSE).

## No model access is granted

This application ships no API credentials and no model access. Bring your own
provider keys, exactly as you would when running `dsh` from a terminal.
