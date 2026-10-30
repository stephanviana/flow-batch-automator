# Third-party notices

## FlowKit

The page-context batchexecute transport in
`packages/extension/src/flow-rpc-page.ts` and
`packages/extension/src/flow-payloads.ts` is adapted from
[`crisng95/flowkit`](https://github.com/crisng95/flowkit), commit
`19cb87d6840759f0c0be1739f84ffd6ce59f985a`, specifically
`extension/background.js` and `agent/services/flow_batch.py`.

Copyright (c) 2026 tuannguyenhoangit-droid. Licensed under the MIT License.
The full license is included in
[`FlowKit-LICENSE.txt`](packages/extension/public/FlowKit-LICENSE.txt) and copied
into the distributed extension.

`packages/extension/public/flowkit-hijack.js` is a copy of FlowKit
`extension/hijack_bypass.js` from the same commit, with an attribution header.
It is loaded in the Flow page at document start. Upstream formatting is preserved.
No FlowKit Python dependencies or proprietary Google reCAPTCHA scripts are included.
