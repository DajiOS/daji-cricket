import { createHash, createHmac } from 'node:crypto';
import type { Config } from './config.ts';
import { HttpError } from './errors.ts';
import { now } from './clock.ts';

// The face check at check-in, through Amazon Rekognition (Settings › Connections, face-match). Off until REKOGNITION_KEY_ID and REKOGNITION_SECRET are set;
// until then check-in works without a face check. Daji keeps no face photos: Rekognition keeps a face template in one collection (IndexFaces at
// enrolment), each check-in selfie is searched against that collection once (SearchFacesByImage) and dropped, and a removed face is deleted there
// (DeleteFaces). What Daji keeps is the template id (Rekognition's FaceId) and each yes or no answer with its score.
// Calls are signed with AWS Signature Version 4 to the published Rekognition JSON API. The region defaults to Mumbai (ap-south-1) so faces stay in India.
// Rekognition's separate Face Liveness product needs its own app component and is not used: the camera-only check (checkCameraPhoto) stands in.

/** Below this a selfie is not the same person (Rekognition similarity, 0 to 100). */
export const MATCH_SCORE = 90;

export const faceMatchReady = (cfg: Config): boolean => !!(cfg.faceMatch.keyId && cfg.faceMatch.secret);

const sha = (b: string): string => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string): Buffer => createHmac('sha256', k).update(s).digest();
const DOWN = 'The face check is not answering right now. Try again in a minute, or ask the ground staff to check you in.';

/** SigV4 headers for one Rekognition JSON call. Exported for the test against AWS's published signing steps. */
export function signRekognition(o: { host: string; region: string; target: string; body: string; keyId: string; secret: string; amzDate: string }): Record<string, string> {
  const day = o.amzDate.slice(0, 8), scope = `${day}/${o.region}/rekognition/aws4_request`;
  const hdr: Record<string, string> = { 'content-type': 'application/x-amz-json-1.1', host: o.host, 'x-amz-date': o.amzDate, 'x-amz-target': `RekognitionService.${o.target}` };
  const names = Object.keys(hdr).sort();
  const canon = ['POST', '/', '', names.map((n) => `${n}:${hdr[n]}\n`).join(''), names.join(';'), sha(o.body)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + o.secret, day), o.region), 'rekognition'), 'aws4_request');
  const sig = createHmac('sha256', key).update(['AWS4-HMAC-SHA256', o.amzDate, scope, sha(canon)].join('\n')).digest('hex');
  return { ...hdr, authorization: `AWS4-HMAC-SHA256 Credential=${o.keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

class AwsError extends Error { type: string; constructor(type: string, message: string) { super(message); this.type = type; } }

async function call<T>(cfg: Config, target: string, payload: unknown): Promise<T> {
  if (!faceMatchReady(cfg)) throw new HttpError(409, 'FACE_SERVICE_OFF', 'Face checks are not switched on for this ground.');
  const f = cfg.faceMatch;
  const url = new URL(f.endpoint || `https://rekognition.${f.region}.amazonaws.com/`);
  const body = JSON.stringify(payload);
  const amzDate = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const { host: _h, ...headers } = signRekognition({ host: url.host, region: f.region, target, body, keyId: f.keyId, secret: f.secret, amzDate });
  let res: Response;
  try { res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new HttpError(503, 'FACE_SERVICE_DOWN', DOWN); }
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(out.__type ?? '').split('#').pop() || `HTTP ${res.status}`;
    throw new AwsError(type, String(out.message ?? out.Message ?? ''));
  }
  return out as T;
}

/** The collection is made on first use; "already exists" is fine. */
let collectionReady = '';
async function ensureCollection(cfg: Config): Promise<void> {
  const key = `${cfg.faceMatch.region}/${cfg.faceMatch.collection}`;
  if (collectionReady === key) return;
  try { await call(cfg, 'CreateCollection', { CollectionId: cfg.faceMatch.collection }); }
  catch (e) { if (!(e instanceof AwsError && e.type === 'ResourceAlreadyExistsException')) throw e; }
  collectionReady = key;
}

function down(e: unknown, where: string): never {
  if (e instanceof HttpError) throw e;
  console.error(JSON.stringify({ level: 'error', where, error: e instanceof AwsError ? `${e.type}: ${e.message}` : String((e as Error).message) }));
  throw new HttpError(503, 'FACE_SERVICE_DOWN', DOWN);
}
const noFace = (e: unknown) => e instanceof AwsError && e.type === 'InvalidParameterException';
const NOT_FOUND = 'We could not see one clear face. Only you in the photo, facing the camera in good light, then try again.';

/** Enrols one face. Refuses a photo with no clear face or with more than one face, so only the player is enrolled. */
export async function enrollFace(cfg: Config, jpeg: Buffer, userId: string): Promise<{ templateId: string }> {
  try {
    await ensureCollection(cfg);
    const r = await call<{ FaceRecords?: { Face?: { FaceId?: string } }[]; UnindexedFaces?: { Reasons?: string[] }[] }>(cfg, 'IndexFaces', {
      CollectionId: cfg.faceMatch.collection, Image: { Bytes: jpeg.toString('base64') }, ExternalImageId: userId, MaxFaces: 1, QualityFilter: 'HIGH', DetectionAttributes: [],
    });
    const id = r.FaceRecords?.[0]?.Face?.FaceId;
    const crowd = (r.UnindexedFaces ?? []).some((u) => u.Reasons?.includes('EXCEEDS_MAX_FACES'));
    if (id && crowd) { await forgetFace(cfg, id); throw new HttpError(422, 'MORE_THAN_ONE_FACE', 'Only you in the photo, please. Take the selfie again on your own.'); }
    if (!id) throw new HttpError(422, 'FACE_NOT_FOUND', NOT_FOUND);
    return { templateId: id };
  } catch (e) {
    if (noFace(e)) throw new HttpError(422, 'FACE_NOT_FOUND', NOT_FOUND);
    down(e, 'face-enrol');
  }
}

/** Searches the collection with one selfie and says whether the player's own enrolled face is among the matches. */
export async function verifyFace(cfg: Config, templateId: string, jpeg: Buffer): Promise<{ match: boolean; score: number; faceFound: boolean }> {
  try {
    await ensureCollection(cfg);
    const r = await call<{ FaceMatches?: { Similarity?: number; Face?: { FaceId?: string } }[] }>(cfg, 'SearchFacesByImage', {
      CollectionId: cfg.faceMatch.collection, Image: { Bytes: jpeg.toString('base64') }, MaxFaces: 10, FaceMatchThreshold: 50, QualityFilter: 'HIGH',
    });
    const mine = (r.FaceMatches ?? []).find((m) => m.Face?.FaceId === templateId);
    const raw = typeof mine?.Similarity === 'number' && Number.isFinite(mine.Similarity) ? Math.max(0, Math.min(100, mine.Similarity)) : 0;
    return { match: raw >= MATCH_SCORE, score: Math.round(raw * 10) / 10, faceFound: true };
  } catch (e) {
    if (noFace(e)) return { match: false, score: 0, faceFound: false };
    down(e, 'face-verify');
  }
}

/** Deletes a face template at Rekognition. Never throws: the nightly sweep tries again when it fails. */
export async function forgetFace(cfg: Config, templateId: string): Promise<boolean> {
  try { await call(cfg, 'DeleteFaces', { CollectionId: cfg.faceMatch.collection, FaceIds: [templateId] }); return true; }
  catch (e) { console.error(JSON.stringify({ level: 'error', where: 'face-forget', error: e instanceof AwsError ? `${e.type}: ${e.message}` : String((e as Error).message) })); return false; }
}
