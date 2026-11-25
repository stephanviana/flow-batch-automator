import { z } from 'zod';

export const projectIdSchema = z.uuid();
export const mediaIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const projectInputSchema = z.strictObject({
  projectId: projectIdSchema,
});
export const assetInputSchema = projectInputSchema.extend({
  limit: z.number().int().min(1).max(200).default(100),
  maxScrolls: z.number().int().min(0).max(40).default(20),
});
export const findImageInputSchema = assetInputSchema.extend({
  mediaId: mediaIdSchema,
});
export type AssetInput = z.infer<typeof assetInputSchema>;

export interface BrowserStatus {
  phase:
    | 'manual-login'
    | 'browser-closed'
    | 'no-flow-tab'
    | 'login-required'
    | 'project-required'
    | 'not-ready'
    | 'busy'
    | 'ready';
  projectId: string | null;
  language: string | null;
  checkedAt: number;
  message: string;
}
export interface FlowAsset {
  mediaId: string;
  title: string;
  kind: 'image' | 'video';
}
export interface AssetListing {
  projectId: string;
  scope: 'current-view';
  assets: FlowAsset[];
  reachedEnd: boolean;
  unidentifiedTilesSeen: boolean;
}

export class FlowBrowserError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function projectFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://flow.google.com') return null;
    const parsed = projectIdSchema.safeParse(url.pathname.split('/')[2]);
    return url.pathname.startsWith('/project/') && parsed.success
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function isFlowUrl(value: string): boolean {
  try {
    return new URL(value).origin === 'https://flow.google.com';
  } catch {
    return false;
  }
}

export function requireProject(value: string, expected: string): void {
  if (projectFromUrl(value) !== expected)
    throw new FlowBrowserError(
      'project_changed',
      'O projeto aberto não corresponde ao projeto solicitado.',
    );
}

export function isGoogleLoginUrl(value: string): boolean {
  try {
    return new URL(value).origin === 'https://accounts.google.com';
  } catch {
    return false;
  }
}
