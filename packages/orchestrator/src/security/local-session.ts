import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { HttpError } from './errors.js';

interface Session {
  authority: string;
  expiresAt: number;
}
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
      expiresAt: Date.now() + 1800000,
    });
    reply.header(
      'Set-Cookie',
      `flow_session=${token}; Path=/manage; HttpOnly; SameSite=Strict; Max-Age=1800`,
    );
  }

  require(request: FastifyRequest): void {
    const token = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('flow_session='))
      ?.slice(13);
    const session = token ? this.sessions.get(this.digest(token)) : undefined;
    const authority = request.headers.host ?? '';
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      session.authority !== authority ||
      request.headers['x-flow-management'] !== '1'
    )
      throw new HttpError(403, 'Management session required');
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
