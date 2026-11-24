// Synthetic records with distinct workflow, media and CDN file identities.
export function flowMediaMetadata(projectId, mediaId, workflowId) {
  return [
    mediaId,
    null,
    null,
    ['Título livre', [1, 0], null, null, workflowId, 'X'],
    projectId,
  ];
}

export function flowVideoRecord(
  projectId,
  mediaId,
  workflowId,
  videoUrl = null,
) {
  const details = Array(14).fill(null);
  details[8] = [3];
  details[10] = 'https://flow-content.google/image/poster-fixture';
  const video = Array(13).fill(null);
  video[8] = videoUrl;
  video[12] = 'abra_i2v_8s';
  return [workflowId, projectId, mediaId, null, null, details, null, [video]];
}

export function flowImageReply(projectId, mediaId, workflowId, fileId) {
  const details = Array(14).fill(null);
  details[13] = `https://flow-content.google/image/${fileId}?fixture-cdn-token=image`;
  const image = [
    mediaId,
    null,
    workflowId,
    null,
    null,
    null,
    [details, null, [768, 1376]],
  ];
  const workflow = [workflowId, null, null, ['Imagem', [1, 0]], projectId];
  return [[workflow], [image]];
}
