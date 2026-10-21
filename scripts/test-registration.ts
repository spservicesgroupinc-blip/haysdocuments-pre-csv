/** Exercise current registration/login/session routes with in-memory Google services. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { environment } from './test-apps-script-harness';

const code = (value: string) => (error: any) => error.code === value;
const invite = 'invite-code-for-testing-1234';
const rows = (e: ReturnType<typeof environment>) => e.sheets.get('Users')!.rows.slice(1);
const register = (e: ReturnType<typeof environment>, email = 'new.user@example.com', password = 'password123', inviteCode?: string) => e.call('registerUser_', email, 'New User', password, inviteCode);
const route = (e: ReturnType<typeof environment>, payload: unknown) => JSON.parse(e.sandbox.doPost({ postData: { contents: JSON.stringify(payload) } }));

test('registration preserves the existing open default and can be explicitly closed/reopened', () => {
  const e = environment(); assert.equal(e.call('registrationMode_'), 'open'); assert.equal(e.call('registrationRequiresCode_'), false);
  const result = register(e); assert.ok(result.sessionToken); assert.equal(result.user.role, 'editor'); assert.equal(rows(e).length, 1);
  e.call('disableRegistration'); assert.equal(e.call('registrationEnabled_'), false);
  assert.throws(() => register(e, 'closed@example.com'), code('registration_closed')); assert.equal(rows(e).length, 1);
  e.call('enableRegistration'); assert.equal(e.call('registrationMode_'), 'open'); assert.ok(register(e, 'reopened@example.com').sessionToken);
  assert.equal(typeof e.call('describeRegistrationMode_'), 'string');
});

test('invite policy checks codes before creating users and never leaks the invite through public routes', () => {
  const e = environment(); assert.throws(() => e.call('useInviteCode', 'short'), /at least 12/); assert.equal(e.call('registrationMode_'), 'open');
  e.call('useInviteCode', invite); assert.equal(e.call('registrationRequiresCode_'), true);
  assert.throws(() => register(e), code('invalid_invite_code')); assert.throws(() => register(e, 'new@example.com', 'password123', 'wrong'), code('invalid_invite_code'));
  assert.equal(rows(e).length, 0);
  const result = route(e, { action: 'register', email: 'routed@example.com', name: 'Routed', password: 'password123', inviteCode: invite });
  assert.equal(result.ok, true); assert.ok(result.data.sessionToken); assert.equal(JSON.stringify(result).includes(invite), false);
  assert.equal(route(e, { action: 'listJobs' }).code, 'unauthorized');
  assert.equal(route(e, { action: 'register', email: 'bad@example.com', password: 'password123', inviteCode: 'wrong' }).code, 'invalid_invite_code');
  e.call('useInviteCode', 'rotated-invite-code-5678'); assert.throws(() => register(e, 'stale@example.com', 'password123', invite), code('invalid_invite_code'));
});

test('password and address policy reject malformed accounts without a user row', () => {
  const e = environment();
  assert.throws(() => register(e, 'not-an-email'), code('invalid_email'));
  assert.throws(() => register(e, 'a@example.com', 'short'), code('weak_password')); assert.equal(rows(e).length, 0);
  e.call('useInviteCode', invite); assert.throws(() => register(e, 'a@example.com', 'abc', invite), code('weak_password')); assert.equal(rows(e).length, 0);
});

test('registration normalizes identity and stores a salted hash with a usable session', () => {
  const e = environment(); const result = register(e, '  NEW.User@Example.COM  ');
  assert.equal(result.user.email, 'new.user@example.com'); assert.equal(result.user.name, 'New User'); assert.equal(result.user.role, 'editor'); assert.equal(rows(e).length, 1);
  const row = rows(e)[0]; assert.equal(row[2], 'editor'); assert.equal(row[5], true); assert.ok(row[3]); assert.ok(row[4]);
  assert.notEqual(row[4], 'password123'); assert.equal(String(row[4]).includes('password123'), false); assert.equal(Buffer.from(String(row[4]), 'base64').length, 32);
  assert.equal(e.call('hashPassword_', 'password123', row[3]), row[4]);
  const authenticated = e.call('authenticateRequest_', { sessionToken: result.sessionToken }); assert.equal(authenticated.email, result.user.email); assert.equal(authenticated.role, 'editor');
  const login = e.call('loginUser_', 'NEW.USER@EXAMPLE.COM', 'password123'); assert.ok(login.sessionToken); assert.equal(login.user.email, result.user.email);
  assert.throws(() => e.call('loginUser_', result.user.email, 'wrong-password'), code('invalid_credentials'));
  assert.throws(() => register(e, result.user.email), code('user_exists')); assert.equal(rows(e).length, 1);
  e.call('revokeSession_', result.sessionToken); assert.throws(() => e.call('authenticateRequest_', { sessionToken: result.sessionToken }), code('session_expired'));
});

test('public registration cannot mint administrator accounts from script defaults or payload roles', () => {
  const e = environment(); e.properties.REGISTRATION_DEFAULT_ROLE = 'admin';
  assert.equal(e.call('selfRegistrationRole_'), 'editor'); assert.equal(register(e).user.role, 'editor');
  const result = route(e, { action: 'register', email: 'payload@example.com', name: 'Payload', password: 'password123', role: 'admin' });
  assert.equal(result.data.user.role, 'editor'); assert.equal(rows(e).some(row => row[2] === 'admin'), false);
  e.properties.REGISTRATION_DEFAULT_ROLE = 'viewer'; assert.equal(register(e, 'viewer@example.com').user.role, 'viewer');
});

test('domain allow-list uses exact normalized domains and rejects lookalikes', () => {
  const e = environment(); e.properties.REGISTRATION_EMAIL_DOMAINS = 'haysandsons.com';
  assert.throws(() => register(e, 'x@gmail.com'), code('domain_not_allowed')); assert.throws(() => register(e, 'x@not-haysandsons.com'), code('domain_not_allowed')); assert.equal(rows(e).length, 0);
  assert.ok(register(e, '  OK@HAYSANDSONS.COM  ').sessionToken);
});
