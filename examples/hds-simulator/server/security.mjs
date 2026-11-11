import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, realpath, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export const createToken = () => randomBytes(32).toString('hex');
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isId = value => Number.isSafeInteger(value) || typeof value === 'string' && value.length <= 64;
export const isInstanceId = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function isBoundedJson(value) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.depth > 32) return false;
    if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

export function validRoutedParams(method, params) {
  const allowed = method === 'field.set' ? ['id', 'value'] : method.startsWith('button.') ? ['id'] : method === 'clock.advance' ? ['ms'] : [];
  if (Object.keys(params).some(key => !['instanceId', 'controllerId', ...allowed].includes(key))) return false;
  if (method === 'field.set') return typeof params.id === 'string' && params.id.length <= 64 &&
    (typeof params.value === 'boolean' || typeof params.value === 'number' && Number.isFinite(params.value) || typeof params.value === 'string' && params.value.length <= 128);
  if (method.startsWith('button.')) return typeof params.id === 'string' && params.id.length <= 64 && (method === 'button.press' || ['circle', 'square'].includes(params.id));
  if (method === 'clock.advance') return typeof params.ms === 'number' && Number.isFinite(params.ms) && params.ms >= 0 && params.ms <= 86400000;
  return true;
}

export function tokenMatches(candidate, token) {
  if (typeof candidate !== 'string' || !/^[0-9a-f]{64}$/.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

export function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function requestAllowed(request, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const headerCount = name => request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length;
  if (headerCount('host') !== 1 || !hosts.includes(request.headers.host)) return false;
  if (headerCount('origin') > 1) return false;
  return request.headers.origin === undefined || hosts.some(host => request.headers.origin === `http://${host}`);
}

export function requestPath(rawUrl) {
  const rawPath = rawUrl.split('?')[0];
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) throw new Error('Invalid path');
  const decoded = decodeURIComponent(rawPath);
  if (/[\\:\x00-\x1f\x7f]/.test(decoded)) throw new Error('Invalid path');
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.') || segment.endsWith('.') || segment.endsWith(' ') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment.split('.')[0].trim()))) throw new Error('Invalid path');
  return segments.length === 0 ? 'index.html' : segments.join('/');
}

export async function staticPath(appRoot, relative) {
  const resolved = await realpath(path.join(appRoot, relative));
  if (!isInside(appRoot, resolved)) throw new Error('Outside app root');
  const segments = path.relative(appRoot, resolved).split(path.sep);
  if (segments.some(segment => segment.startsWith('.') || segment.includes(':'))) throw new Error('Hidden path');
  return resolved;
}

export async function writeConnectionFile(filename, appRoot, connection) {
  const absolute = path.resolve(filename);
  if (isInside(appRoot, absolute)) throw new Error('Connection file must be outside the served app');
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(absolute));
  if (isInside(appRoot, parent)) throw new Error('Connection file parent resolves inside the served app');
  const target = path.join(parent, path.basename(absolute));
  const temporary = `${target}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return target;
}
