# Third-party notices

## FlowKit

The page-context batchexecute transport in
`packages/extension/src/flow-rpc-page.ts` and
`packages/extension/src/flow-payloads.ts`, together with project creation in
`packages/extension/src/flow-projects.ts`, are adapted from
[`crisng95/flowkit`](https://github.com/crisng95/flowkit), commit
`19cb87d6840759f0c0be1739f84ffd6ce59f985a`, specifically
`extension/background.js` and `agent/services/flow_batch.py`.

Copyright (c) 2026 tuannguyenhoangit-droid. Licensed under the MIT License.
The full license is included in
[`FlowKit-LICENSE.txt`](packages/extension/public/FlowKit-LICENSE.txt) and copied
into the distributed extension.

Earlier distributions also included FlowKit's `extension/hijack_bypass.js`
from the same commit. That script is no longer distributed or loaded.

## Flow MCP design reference

`packages/flow-mcp` is an independent implementation informed by the dedicated
Chrome/CDP architecture and Flow UI selectors documented in
[`GTAI-1/flow-mcp`](https://github.com/GTAI-1/flow-mcp), inspected at commit
`770e00181390e6a41393be6a185e49e9987fc9c6`.
No upstream source files are vendored or copied into this repository.
The upstream manifest declares ISC but that revision has no standalone license
file; this reference does not assert a license grant for other upstream code.
