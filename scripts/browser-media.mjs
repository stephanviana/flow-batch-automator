import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { resolve } from 'node:path';

export async function startMediaFixture(directory) {
  const keyPath = resolve(directory, 'fixture-key.pem');
  const certPath = resolve(directory, 'fixture-cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=flow-content.google',
      '-addext',
      'subjectAltName=DNS:flow-content.google,DNS:flow.google.com',
      '-days',
      '1',
    ],
    { stdio: 'ignore' },
  );
  const [key, cert, video] = await Promise.all([
    readFile(keyPath),
    readFile(certPath),
    readFile(new URL('./fixtures/blue.mp4', import.meta.url)),
  ]);
  const spki = new X509Certificate(cert).publicKey.export({
    type: 'spki',
    format: 'der',
  });
  const requests = [];
  let holdNext = false;
  let release;
  const server = createServer({ key, cert }, (request, response) => {
    const url = new URL(request.url, 'https://flow-content.google');
    if (!/^\/video\/[a-f0-9-]{36}$/.test(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    requests.push(url.pathname);
    const invalid = url.searchParams.has('html');
    response.writeHead(200, {
      'content-type': invalid ? 'text/html' : 'video/mp4',
      'content-length': invalid ? 18 : video.length,
    });
    if (holdNext && !invalid) {
      holdNext = false;
      response.flushHeaders();
      release = () => response.end(video);
    } else response.end(invalid ? '<html>error</html>' : video);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    requests,
    holdNextDownload: () => {
      holdNext = true;
    },
    releaseDownload: () => {
      release?.();
      release = undefined;
    },
    video,
    args: [
      `--host-resolver-rules=MAP flow-content.google:443 127.0.0.1:${port}, MAP flow.google.com:443 127.0.0.1:${port}`,
      `--ignore-certificate-errors-spki-list=${createHash('sha256').update(spki).digest('base64')}`,
      '--no-proxy-server',
    ],
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
