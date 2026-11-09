import { z } from 'zod';

// FlowKit: omni_first_frame_request / eb1hJf. Keep the wire model in the task
// so duration and resolution stay bound to the operator's original approval.
export const omniVideoModelSchema = z.enum([
  'abra_i2v_4s',
  'abra_i2v_6s',
  'abra_i2v_8s',
  'abra_i2v_10s',
  'abra_i2v_4s_360p',
  'abra_i2v_6s_360p',
  'abra_i2v_8s_360p',
  'abra_i2v_10s_360p',
]);
export type OmniVideoModel = z.infer<typeof omniVideoModelSchema>;
export const flowVideoModelSchema = z.enum([
  ...omniVideoModelSchema.options,
  'veo_3_1_i2v_lite',
  'veo_3_1_i2v_lite_low_priority',
  'veo_3_1_i2v_s_fast_ultra',
]);
export type FlowVideoModel = z.infer<typeof flowVideoModelSchema>;
export const orderVideoModelSchema = z.enum([
  'abra_i2v_8s',
  'veo_3_1_i2v_lite',
]);
export type OrderVideoModel = z.infer<typeof orderVideoModelSchema>;
export const DEFAULT_ORDER_VIDEO_MODEL: OrderVideoModel = 'abra_i2v_8s';
export const orderVideoModelLabels: Record<OrderVideoModel, string> = {
  abra_i2v_8s: 'Omni 1.1 Flash',
  veo_3_1_i2v_lite: 'Veo 3.1 Lite',
};
export const imageSelectionSchema = z.enum(['GEM_PIX_2', 'BELUGA']);
export const omniDurationSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
]);
export const omniResolutionSchema = z.enum(['360p', '720p']);

export function resolveOmniVideoModel(
  duration: unknown,
  resolution: unknown,
): OmniVideoModel {
  const seconds = omniDurationSchema.parse(duration);
  const size = omniResolutionSchema.parse(resolution);
  return omniVideoModelSchema.parse(
    `abra_i2v_${seconds}s${size === '360p' ? '_360p' : ''}`,
  );
}
export function isOmniVideoModel(
  model: FlowVideoModel,
): model is OmniVideoModel {
  return omniVideoModelSchema.safeParse(model).success;
}
