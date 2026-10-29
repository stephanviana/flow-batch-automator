import { z } from 'zod';
import {
  pairingReceiptSchema,
  extensionStateSchema,
  type ExtensionState,
} from '@flow-batch/protocol';

const preferencesSchema = z.strictObject({
  enabled: z.boolean(),
  revoked: z.boolean(),
  clientId: z.uuid().optional(),
  pending: pairingReceiptSchema.optional(),
  retryAt: z.number().optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export async function preferences(): Promise<Preferences> {
  const stored = await chrome.storage.local.get('connection');
  const parsed = preferencesSchema.safeParse(stored.connection);
  return parsed.success ? parsed.data : { enabled: false, revoked: false };
}
export async function savePreferences(connection: Preferences): Promise<void> {
  await chrome.storage.local.set({ connection });
}
export async function setState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ status: state });
}
export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get('status');
  const parsed = extensionStateSchema.safeParse(stored.status);
  return parsed.success
    ? parsed.data
    : { phase: 'disconnected', message: 'Desconectada.' };
}
