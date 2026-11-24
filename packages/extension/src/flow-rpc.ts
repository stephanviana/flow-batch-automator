import { flowRpcPage } from './flow-rpc-page.js';
import { readFlowPayload } from './flow-rpc-read.js';
import type {
  FlowRpcReply,
  FlowRpcRequest,
  FlowRpcTransportReply,
} from './flow-rpc-contract.js';

export async function callFlowTransport(
  tabId: number,
  request: FlowRpcRequest,
): Promise<FlowRpcTransportReply> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: flowRpcPage,
    args: [request],
  });
  if (!injection?.result) throw new Error('Flow script returned no reply');
  return injection.result;
}

export async function callFlowRpc(
  tabId: number,
  request: FlowRpcRequest,
): Promise<FlowRpcReply> {
  const response = await callFlowTransport(tabId, request);
  // Response bodies and signed URLs stay inside the extension. Only sanitized
  // checkpoints or inspection messages can leave this browser boundary.
  return response.ok ? readFlowPayload(request, response.payload) : response;
}
