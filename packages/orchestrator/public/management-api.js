export async function api(path, body, headers = {}, asBlob = false) {
  const binary = body instanceof File;
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'X-Flow-Management': '1',
      ...(body !== undefined && !binary
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: binary ? body : JSON.stringify(body) }
      : {}),
  });
  if (response.ok && asBlob) return response.blob();
  const result = await response.json();
  if (!response.ok) {
    const fields = result.issues
      ?.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `${result.error ?? 'Não foi possível confirmar a operação.'}${fields ? `: ${fields}` : ''}`,
    );
  }
  return result;
}
