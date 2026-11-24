import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export function isolatedCompose(docker, project, directory, port) {
  const configuration = JSON.parse(
    docker([
      'compose',
      '-f',
      resolve('compose.yaml'),
      '-p',
      project,
      'config',
      '--format',
      'json',
    ]),
  );
  for (const [name, service] of Object.entries(configuration.services))
    service.image = `${project}-${name}:test`;
  configuration.services.orchestrator.environment.PORT = String(port);
  configuration.services.orchestrator.ports = [
    {
      target: port,
      published: String(port),
      host_ip: '127.0.0.1',
      protocol: 'tcp',
    },
  ];
  const path = join(directory, 'compose.json');
  writeFileSync(path, JSON.stringify(configuration, null, 2) + '\n');
  return path;
}
