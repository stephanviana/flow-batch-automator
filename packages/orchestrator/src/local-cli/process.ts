import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
}
export async function runProcess(
  command: string,
  args: string[],
  capture = false,
  environment = process.env,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      timeout: capture ? 15000 : undefined,
      stdio: [
        capture ? 'ignore' : 'inherit',
        capture ? 'pipe' : 'inherit',
        capture ? 'pipe' : 'inherit',
      ],
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    // Captured diagnostics must not print environment or client secrets.
    child.stderr?.resume();
    child.once('error', () =>
      reject(
        new Error(
          `Não foi possível executar ${command}. Confira a instalação e o PATH.`,
        ),
      ),
    );
    const terminate = (): void => {
      child.kill('SIGTERM');
    };
    const interrupt = (): void => {
      child.kill('SIGINT');
    };
    process.once('SIGTERM', terminate);
    process.once('SIGINT', interrupt);
    child.once('close', (code) => {
      process.removeListener('SIGTERM', terminate);
      process.removeListener('SIGINT', interrupt);
      resolve({ code: code ?? 1, stdout });
    });
  });
}
