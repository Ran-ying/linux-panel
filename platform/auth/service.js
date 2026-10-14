import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addAudit } from '../state-store.js';
import { hashPassword, validPassword, verifyPassword } from './password.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const digest = token => createHash('sha256').update(token).digest('hex');
const unauthorized = () => Object.assign(new Error('Authentication required'), { statusCode: 401 });
const invalidCredentials = () => Object.assign(new Error('Invalid username or password'), { statusCode: 401 });
const forbidden = () => Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });

export class AuthService {
  #failures = new Map();
  constructor(store) { this.store = store; }

  async isInitialized() {
    return (await this.store.snapshot()).users.length > 0;
  }

  async bootstrap(username, password) {
    if (typeof username !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(username))
      throw new Error('Username must be 3–32 ASCII letters, digits, underscore or hyphen');
    const passwordHash = await hashPassword(password);
    return this.store.mutate(state => {
      if (state.users.length) throw new Error('Administrator already exists: bootstrap disabled');
      const user = { id: randomUUID(), username, role: 'admin', passwordHash, createdAt: new Date().toISOString() };
      state.users.push(user);
      addAudit(state, 'admin.bootstrap', user.id);
      return { id: user.id, username: user.username, role: user.role };
    });
  }

  async login(username, password, ip = 'unknown') {
    const now = Date.now();
    const key = String(ip).slice(0, 120);
    const attempts = (this.#failures.get(key) ?? []).filter(at => now - at < LOGIN_WINDOW);
    if (attempts.length >= MAX_FAILURES) {
      this.#failures.set(key, attempts);
      throw Object.assign(new Error('Too many attempts; try again later'), { statusCode: 429 });
    }
    const state = await this.store.snapshot();
    if (!state.users.length) {
      throw Object.assign(new Error('Administrator not initialized; use the local CLI'), { statusCode: 503 });
    }
    const user = typeof username === 'string' ? state.users.find(u => u.username === username) : null;
    const valid = user && await verifyPassword(password, user.passwordHash);
    if (!valid) {
      attempts.push(now);
      this.#failures.set(key, attempts);
      throw invalidCredentials();
    }
    this.#failures.delete(key);
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const expiresAt = new Date(now + SESSION_MS).toISOString();
    await this.store.mutate(current => {
      if (!current.users.some(u => u.id === user.id && u.passwordHash === user.passwordHash))
        throw unauthorized();
      current.sessions = current.sessions.filter(s => Date.parse(s.expiresAt) > now);
      current.sessions.push({
        id: sessionId, tokenHash: digest(token), csrf, userId: user.id,
        createdAt: new Date(now).toISOString(), expiresAt
      });
      addAudit(current, 'auth.login', user.id);
    });
    return { token, csrf, expiresAt, user: { id: user.id, username: user.username, role: user.role } };
  }

  async authenticate(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
    const state = await this.store.snapshot();
    const item = state.sessions.find(s => s.tokenHash === digest(token));
    const user = item && state.users.find(u => u.id === item.userId);
    if (!item || !user || Date.parse(item.expiresAt) <= Date.now()) throw unauthorized();
    return { session: item, user: { id: user.id, username: user.username, role: user.role } };
  }

  requirePermission(identity, permission) {
    if (!identity || identity.user.role !== 'admin' || !permission) throw forbidden();
  }

  async logout(identity) {
    await this.store.mutate(state => {
      state.sessions = state.sessions.filter(s => s.id !== identity.session.id);
      addAudit(state, 'auth.logout', identity.user.id);
    });
  }

  async changePassword(identity, currentPassword, nextPassword) {
    if (!validPassword(nextPassword)) throw Object.assign(new Error('New password must be 12–256 UTF-8 bytes'), { statusCode: 400 });
    const previous = (await this.store.snapshot()).users.find(u => u.id === identity.user.id);
    if (!previous || !await verifyPassword(currentPassword, previous.passwordHash))
      throw invalidCredentials();
    const hash = await hashPassword(nextPassword);
    await this.store.mutate(state => {
      const current = state.users.find(u => u.id === identity.user.id);
      if (!current || current.passwordHash !== previous.passwordHash) throw unauthorized();
      current.passwordHash = hash;
      state.sessions = state.sessions.filter(s => s.userId !== current.id);
      addAudit(state, 'auth.password.changed', current.id);
    });
  }

  async listSessions(identity) {
    const state = await this.store.snapshot();
    return state.sessions.filter(s => s.userId === identity.user.id && Date.parse(s.expiresAt) > Date.now())
      .map(s => ({ id: s.id, current: s.id === identity.session.id, createdAt: s.createdAt, expiresAt: s.expiresAt }));
  }

  async revokeSession(identity, id) {
    await this.store.mutate(state => {
      if (!state.sessions.some(s => s.id === id && s.userId === identity.user.id))
        throw Object.assign(new Error('Session not found'), { statusCode: 404 });
      state.sessions = state.sessions.filter(s => s.id !== id);
      addAudit(state, 'auth.session.revoked', identity.user.id);
    });
  }

  async audit(identity) {
    this.requirePermission(identity, 'audit:read');
    return (await this.store.snapshot()).audit.slice(-100).reverse();
  }
}
