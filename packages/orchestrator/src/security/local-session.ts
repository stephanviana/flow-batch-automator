import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { HttpError } from './errors.js';

interface Session {
  authority: string;
  expiresAt: number;
}
const SESSION_DURATION_MS = 1_800_000;
export class LocalSessions {
  private readonly sessions = new Map<string, Session>();

  open(request: FastifyRequest, reply: FastifyReply): void {
    for (const [key, session] of this.sessions)
      if (session.expiresAt <= Date.now()) this.sessions.delete(key);
    if (this.sessions.size >= 100)
      throw new HttpError(429, 'Too many management sessions');
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(this.digest(token), {
      authority: request.headers.host ?? '',
      expiresAt: Date.now() + SESSION_DURATION_MS,
    });
    this.cookie(reply, token);
  }

  renew(request: FastifyRequest, reply: FastifyReply): void {
    this.validateRequest(request);
    const token = this.token(request);
    const session = token ? this.sessions.get(this.digest(token)) : undefined;
    if (
      token &&
      session &&
      session.expiresAt > Date.now() &&
      session.authority === request.headers.host
    ) {
      session.expiresAt = Date.now() + SESSION_DURATION_MS;
      this.cookie(reply, token);
    } else this.open(request, reply);
  }

  private cookie(reply: FastifyReply, token: string): void {
    reply.header(
      'Set-Cookie',
      `flow_session=${token}; Path=/manage; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}`,
    );
  }

  require(request: FastifyRequest): void {
    this.validateRequest(request);
    const token = this.token(request);
    const session = token ? this.sessions.get(this.digest(token)) : undefined;
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      session.authority !== request.headers.host
    )
      throw new HttpError(
        403,
        'A sessão do painel expirou. Tente novamente para continuar.',
        'MANAGEMENT_SESSION_REQUIRED',
      );
  }

  private token(request: FastifyRequest): string | undefined {
    return request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('flow_session='))
      ?.slice(13);
  }

  private validateRequest(request: FastifyRequest): void {
    const authority = request.headers.host ?? '';
    if (request.headers['x-flow-management'] !== '1')
      throw new HttpError(403, 'Management header required');
    if (
      request.headers.origin &&
      request.headers.origin !== `http://${authority}`
    )
      throw new HttpError(403, 'Management origin mismatch');
    if (
      request.method !== 'GET' &&
      request.headers.origin !== `http://${authority}`
    )
      throw new HttpError(403, 'Management origin required');
    if (request.headers['sec-fetch-site'] === 'cross-site')
      throw new HttpError(403, 'Cross-site management denied');
  }

  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
