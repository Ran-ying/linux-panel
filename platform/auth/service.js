import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addAudit } from '../state-store.js';
import { hashPassword, validPassword, verifyPassword } from './password.js';
import { newTotpSecret, verifyTotp, newRecoveryCodes, recoveryDigest } from './totp.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_FAILURE_KEYS = 4096;
const digest = token => createHash('sha256').update(token).digest('hex');
const unauthorized = () => Object.assign(new Error('Authentication required'), { statusCode: 401 });
const invalidCredentials = () => Object.assign(new Error('Invalid username or password'), { statusCode: 401 });
const forbidden = () => Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });

export class AuthService {
  #failures = new Map();
  #accountFailures = new Map();
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

  async login(username, password, ip = 'unknown', secondFactor = '') {
    const now = Date.now();
    const key = String(ip).slice(0, 120);
    // Bounded in-memory bookkeeping: random/spoofed addresses cannot grow the
    // map without limit. The proxy must overwrite X-Forwarded-For with one IP.
    if (this.#failures.size >= MAX_FAILURE_KEYS) {
      for (const [address, timestamps] of this.#failures) {
        const fresh = timestamps.filter(at => now - at < LOGIN_WINDOW);
        if (!fresh.length) this.#failures.delete(address);
        else this.#failures.set(address, fresh);
      }
      if (this.#failures.size >= MAX_FAILURE_KEYS && !this.#failures.has(key))
        throw Object.assign(new Error('Login capacity temporarily exceeded'), { statusCode: 429 });
    }
    const attempts = (this.#failures.get(key) ?? []).filter(at => now - at < LOGIN_WINDOW);
    const accountKey = typeof username === 'string' && /^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(username) ? username.toLowerCase() : '_invalid';
    const accountAttempts = (this.#accountFailures.get(accountKey) ?? []).filter(at => now - at < LOGIN_WINDOW);
    // Account dimension reduces distributed guessing; short cooldown prevents permanent lockout.
    for (const [name, times] of this.#accountFailures) {
      const fresh = times.filter(at => now - at < LOGIN_WINDOW);
      if (fresh.length) this.#accountFailures.set(name, fresh);
      else this.#accountFailures.delete(name);
    }
    if (this.#accountFailures.size >= MAX_FAILURE_KEYS && !this.#accountFailures.has(accountKey))
      throw Object.assign(new Error('Login capacity temporarily exceeded'), { statusCode: 429 });
    if (attempts.length >= MAX_FAILURES || accountAttempts.length >= 12) {
      this.#failures.set(key, attempts);
      throw Object.assign(new Error('Too many attempts; try again later'), { statusCode: 429 });
    }
    const state = await this.store.snapshot();
    if (!state.users.length) {
      throw Object.assign(new Error('Administrator not initialized; use the local CLI'), { statusCode: 503 });
    }
    const user = typeof username === 'string' ? state.users.find(u => u.username === username) : null;
    const valid = user && await verifyPassword(password, user.passwordHash);
    let acceptedCounter = -1;
    let usedRecovery = false;
    if (valid && user.totp?.enabled) {
      acceptedCounter = verifyTotp(user.totp.secret, secondFactor, now, user.totp.lastCounter ?? -1);
      usedRecovery = acceptedCounter < 0 && typeof secondFactor === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{8}$/.test(secondFactor) &&
        user.totp.recoveryHashes?.includes(recoveryDigest(secondFactor));
    }
    if (!valid || (user.totp?.enabled && acceptedCounter < 0 && !usedRecovery)) {
      attempts.push(now);
      accountAttempts.push(now);
      this.#failures.set(key, attempts);
      this.#accountFailures.set(accountKey, accountAttempts);
      throw invalidCredentials();
    }
    this.#failures.delete(key);
    this.#accountFailures.delete(accountKey);
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const expiresAt = new Date(now + SESSION_MS).toISOString();
    await this.store.mutate(current => {
      if (!current.users.some(u => u.id === user.id && u.passwordHash === user.passwordHash))
        throw unauthorized();
      current.sessions = current.sessions.filter(s => Date.parse(s.expiresAt) > now);
      const currentUser = current.users.find(u => u.id === user.id);
      if (currentUser?.totp?.enabled) {
        if (usedRecovery) {
          const digest = recoveryDigest(secondFactor);
          if (!currentUser.totp.recoveryHashes.includes(digest)) throw unauthorized();
          currentUser.totp.recoveryHashes = currentUser.totp.recoveryHashes.filter(v => v !== digest);
          addAudit(current, 'auth.recovery.used', user.id);
        } else {
          if (acceptedCounter <= (currentUser.totp.lastCounter ?? -1)) throw unauthorized();
          currentUser.totp.lastCounter = acceptedCounter;
        }
      }
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
      // Any OAuth grants issued before this credential change are now invalid.
      current.credentialEpoch = (current.credentialEpoch ?? 0) + 1;
      state.sessions = state.sessions.filter(s => s.userId !== current.id);
      addAudit(state, 'auth.password.changed', current.id);
    });
  }


  async verifyStepUp(identity,password,code) {
    const user=(await this.store.snapshot()).users.find(u=>u.id===identity.user.id);
    if(!user?.totp?.enabled || !await verifyPassword(password,user.passwordHash))
      throw forbidden();
    const counter=verifyTotp(user.totp.secret,code,Date.now(),user.totp.lastCounter??-1);
    if(counter<0)throw forbidden();
    await this.store.mutate(state=>{
      const current=state.users.find(u=>u.id===identity.user.id);
      if(!current?.totp?.enabled || counter<=(current.totp.lastCounter??-1))throw forbidden();
      current.totp.lastCounter=counter;
      addAudit(state,'auth.stepup.verified',identity.user.id);
    });
  }

  async totpStatus(identity) {
    const user=(await this.store.snapshot()).users.find(u=>u.id===identity.user.id);
    return { enabled:user?.totp?.enabled===true, recoveryCodesRemaining:user?.totp?.recoveryHashes?.length??0 };
  }

  async beginTotp(identity,password) {
    const user=(await this.store.snapshot()).users.find(u=>u.id===identity.user.id);
    if(!user || !await verifyPassword(password,user.passwordHash)) throw invalidCredentials();
    if(user.totp?.enabled) throw forbidden();
    const secret = newTotpSecret();
    await this.store.mutate(state=>{
      const current=state.users.find(u=>u.id===identity.user.id);
      if(!current || current.totp?.enabled) throw forbidden();
      current.totpPending={secret,expiresAt:Date.now()+10*60*1000};
      addAudit(state,'auth.totp.setup.started',identity.user.id);
    });
    return { secret, uri:'otpauth://totp/'+encodeURIComponent('Linux Panel:'+user.username)+'?'+
      new URLSearchParams({secret,issuer:'Linux Panel',algorithm:'SHA1',digits:'6',period:'30'}) };
  }

  async enableTotp(identity,code) {
    const recoveryCodes=newRecoveryCodes();
    await this.store.mutate(state=>{
      const user=state.users.find(u=>u.id===identity.user.id);
      if(!user || user.totp?.enabled || !user.totpPending ||
          user.totpPending.expiresAt < Date.now()) throw forbidden();
      const counter=verifyTotp(user.totpPending.secret,code);
      if(counter < 0) throw Object.assign(new Error('Invalid authenticator code'),{statusCode:400});
      user.totp={enabled:true,secret:user.totpPending.secret,lastCounter:counter,
        recoveryHashes:recoveryCodes.map(recoveryDigest)};
      delete user.totpPending;
      // Revoke all prior OAuth grants on security-factor changes.
      user.credentialEpoch=(user.credentialEpoch??0)+1;
      state.sessions=state.sessions.filter(s=>s.id===identity.session.id);
      addAudit(state,'auth.totp.enabled',identity.user.id);
    });
    return { enabled:true,recoveryCodes };
  }

  async disableTotp(identity,password,code) {
    const previous=(await this.store.snapshot()).users.find(u=>u.id===identity.user.id);
    if(!previous?.totp?.enabled || !await verifyPassword(password,previous.passwordHash))
      throw invalidCredentials();
    await this.store.mutate(state=>{
      const user=state.users.find(u=>u.id===identity.user.id);
      if(!user?.totp?.enabled) throw forbidden();
      const counter=verifyTotp(user.totp.secret,code,Date.now(),user.totp.lastCounter??-1);
      const digest=typeof code==='string'?recoveryDigest(code):'';
      const usedRecovery=counter<0 && user.totp.recoveryHashes.includes(digest);
      if(counter<0 && !usedRecovery) throw forbidden();
      delete user.totp;
      delete user.totpPending;
      user.credentialEpoch=(user.credentialEpoch??0)+1;
      state.sessions=state.sessions.filter(s=>s.id===identity.session.id);
      addAudit(state,'auth.totp.disabled',identity.user.id);
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
