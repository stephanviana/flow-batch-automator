const SESSION_REFRESH_MS = 20 * 60 * 1000;
const SESSION_REQUIRED = 'MANAGEMENT_SESSION_REQUIRED';
let refreshAt = Date.now() + SESSION_REFRESH_MS;
let renewal = null;
let sessionRevision = 0;

function sessionError() {
  return new Error(
    'Não foi possível renovar a sessão do painel. Tente novamente; os dados preenchidos foram mantidos.',
  );
}
async function renewSession() {
  if (!renewal) {
    renewal = fetch('/manage/session', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'X-Flow-Management': '1' },
    })
      .then((response) => {
        if (!response.ok) throw sessionError();
        refreshAt = Date.now() + SESSION_REFRESH_MS;
        sessionRevision++;
      })
      .catch(() => {
        throw sessionError();
      })
      .finally(() => {
        renewal = null;
      });
  }
  await renewal;
}
async function request(path, body, headers) {
  const binary = body instanceof File;
  try {
    return await fetch(path, {
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
  } catch {
    throw new Error(
      'Não foi possível acessar o servidor local. Confira o estado da operação antes de tentar novamente.',
    );
  }
}
function responseError(response, result) {
  if (result.code === SESSION_REQUIRED) return sessionError();
  if (response.status === 403)
    return new Error(
      'O painel não pôde autorizar esta operação. Recarregue a página e tente novamente.',
    );
  const fields = result.issues
    ?.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return new Error(
    `${result.error ?? 'Não foi possível confirmar a operação.'}${fields ? `: ${fields}` : ''}`,
  );
}
export async function api(path, body, headers = {}, asBlob = false) {
  if (Date.now() >= refreshAt) await renewSession();
  const revision = sessionRevision;
  let response = await request(path, body, headers);
  if (response.status === 403) {
    const denied = await response
      .clone()
      .json()
      .catch(() => ({}));
    if (denied.code === SESSION_REQUIRED) {
      if (sessionRevision === revision || renewal) await renewSession();
      response = await request(path, body, headers);
    }
  }
  if (response.ok && asBlob) return response.blob();
  const result = await response.json();
  if (!response.ok) throw responseError(response, result);
  return result;
}
