// RCV — descargas asíncronas de detalle (boletas electrónicas venta, tipo UI 3941).
// Bundle `consdcvinternetui` app.full.min.js (www4.sii.cl, observed 2026-11). Same SDI
// envelope + POST seam as portal/rcv.ts (ADR-004).
import { z } from 'zod';
import { HOSTS } from '../config/index.js';
import { NetworkError, NotAuthenticatedError, RcvError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import type { Periodo } from '../periodo/index.js';
import type { BinaryResponse, JsonRequest, PortalSession } from '../seams/index.js';

/** Código de tipo en la UI RCV para «Descargar Boletas electrónicas» (no es el DTE 39 del CSV). */
export const RCV_COD_TIPO_BOLETAS_ELECTRONICAS = '3941';
export const RCV_ACCION_BOLETAS_ASYNC = 'RCV_DBEA';
export const RCV_ESTADO_JOB_TERMINADO = 'TERMINADO';
const CONVERSATION_COOKIE = 'TOKEN';
const RECAPTCHA_TOKEN = 't-o-k-e-n-web';

const FACADE_BASE = `${HOSTS.portalApi}/consdcvinternetui/services/data/facadeService`;
const CTRL_ASYNC_URL = `${FACADE_BASE}/getCtrlAsync`;
const CTRL_ASYNC_NS =
  'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getCtrlAsync';

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Origin: HOSTS.portalApi,
  Referer: `${HOSTS.portalApi}/consdcvinternetui/`,
  Accept: 'application/json, text/plain, */*',
};

const Row = z.record(z.string(), z.unknown());
const Envelope = z
  .object({
    respEstado: z
      .object({
        codRespuesta: z.union([z.number(), z.string()]).nullish(),
        msgeRespuesta: z.string().nullish(),
        codError: z.string().nullish(),
      })
      .loose()
      .nullish(),
    data: z.array(Row).nullish(),
    datos: z.array(Row).nullish(),
  })
  .loose();

const ASYNC_ALIASES = {
  caEstado: ['caEstado', 'estado'],
  caIdBLOB: ['caIdBLOB', 'idBlob', 'caIdBlob'],
  caId: ['caId', 'id'],
  caPeriodo: ['caPeriodo', 'periodo', 'ptributario'],
  caTipoDoc: ['caTipoDoc', 'tipoDoc', 'codTipoDoc'],
  compraOVenta: ['compraOVenta', 'cprVta'],
  seccionCompra: ['seccionCompra', 'seccion'],
} as const;

export interface RcvAsyncJobRow {
  readonly caEstado: string | null;
  readonly caIdBLOB: string | null;
  readonly caId: string | null;
  readonly caPeriodo: string | null;
  readonly caTipoDoc: string | null;
  /** `C` = compra; otro valor (p. ej. `V`) = venta — observado en la SPA. */
  readonly compraOVenta: string | null;
  readonly seccionCompra: string | null;
  readonly raw: Record<string, unknown>;
}

export interface RcvCtrlAsyncResult {
  readonly aviso: string | null;
  readonly filas: readonly RcvAsyncJobRow[];
}

const aliasGet = (row: Record<string, unknown>, aliases: readonly string[]): unknown => {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const asStr = (v: unknown): string | null => (v === null || v === undefined ? '' : String(v).trim()) || null;

const CTRL_OK = new Set([0, '0', 1, '1']);

function siiRejected(resp: z.infer<typeof Envelope>['respEstado']): string | null {
  if (!resp) return null;
  const code = resp.codRespuesta;
  if (code === undefined || code === null) return null;
  if (code === 98 || code === '98') {
    return 'SII solicitó verificación reCAPTCHA para la descarga del RCV.';
  }
  if (code === 99 || code === '99') {
    return 'No se encontraron documentos para descargar.';
  }
  if (CTRL_OK.has(code)) return null;
  return asStr(resp.msgeRespuesta ?? resp.codError) ?? 'SII rechazó la solicitud de descarga del RCV.';
}

function metaData(namespace: string, conversationId: string): Record<string, unknown> {
  return {
    namespace,
    conversationId,
    transactionId: globalThis.crypto.randomUUID(),
    page: null,
  };
}

async function postSdi(
  session: PortalSession,
  url: string,
  namespace: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  const conversationId = (await session.cookie(`${HOSTS.portalApi}/`, CONVERSATION_COOKIE)) ?? '';
  const request: JsonRequest = {
    method: 'POST',
    headers: HEADERS,
    body: { metaData: metaData(namespace, conversationId), data },
  };
  try {
    return await session.requestJson(url, request);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) throw e;
    if (e instanceof NetworkError) throw e;
    throw new RcvError('Respuesta inesperada de SII (no es JSON).');
  }
}

function projectJobRow(r: Record<string, unknown>): RcvAsyncJobRow {
  return {
    caEstado: asStr(aliasGet(r, ASYNC_ALIASES.caEstado)),
    caIdBLOB: asStr(aliasGet(r, ASYNC_ALIASES.caIdBLOB)),
    caId: asStr(aliasGet(r, ASYNC_ALIASES.caId)),
    caPeriodo: asStr(aliasGet(r, ASYNC_ALIASES.caPeriodo)),
    caTipoDoc: asStr(aliasGet(r, ASYNC_ALIASES.caTipoDoc)),
    compraOVenta: asStr(aliasGet(r, ASYNC_ALIASES.compraOVenta)),
    seccionCompra: asStr(aliasGet(r, ASYNC_ALIASES.seccionCompra)),
    raw: r,
  };
}

function parseCtrlAsync(raw: unknown): RcvCtrlAsyncResult {
  const parsed = Envelope.safeParse(raw);
  if (!parsed.success) {
    throw new RcvError('Respuesta inesperada de SII (no es un objeto JSON del RCV).');
  }
  const rejected = siiRejected(parsed.data.respEstado);
  if (rejected) throw new RcvError(rejected);
  const code = parsed.data.respEstado?.codRespuesta;
  const aviso =
    code === 1 || code === '1'
      ? asStr(parsed.data.respEstado?.msgeRespuesta)
      : null;
  const rows = parsed.data.data ?? parsed.data.datos ?? [];
  return { aviso, filas: rows.map(projectJobRow) };
}

export interface FetchRcvCtrlAsyncParams {
  readonly rut: Rut;
  readonly periodo: Periodo;
  /** true = solicitar generación; false = solo consultar estado. */
  readonly genera: boolean;
  readonly codTipoDoc?: string;
  readonly totDoc?: number;
  readonly accionRecaptcha?: string;
}

/** POST `getCtrlAsync` — solicitar o consultar jobs de descarga diferida. */
export async function fetchRcvCtrlAsync(
  session: PortalSession,
  params: FetchRcvCtrlAsyncParams,
): Promise<RcvCtrlAsyncResult> {
  const {
    rut,
    periodo,
    genera,
    codTipoDoc = RCV_COD_TIPO_BOLETAS_ELECTRONICAS,
    totDoc = 0,
    accionRecaptcha = RCV_ACCION_BOLETAS_ASYNC,
  } = params;
  const raw = await postSdi(session, CTRL_ASYNC_URL, CTRL_ASYNC_NS, {
    rutEmisor: String(rut.body),
    dvEmisor: rut.dv,
    ptributario: periodo.canonical,
    codTipoDoc,
    generaCtrl: genera,
    operacion: 'VENTA',
    estadoContab: 'REGISTRO',
    totDoc,
    accionRecaptcha,
    tokenRecaptcha: RECAPTCHA_TOKEN,
  });
  return parseCtrlAsync(raw);
}

export interface FetchRcvArchivoBlobParams {
  readonly caIdBLOB: string;
  /** Cuerpo numérico del RUT del titular de sesión (no el operando). */
  readonly usuarioSesionBody: string;
  readonly rutEmisor: Rut;
  readonly caId: string;
}

/** GET binario `obtenerArchivoBLOB` — el `.csv.gz` del job terminado. */
export async function fetchRcvArchivoBlob(
  session: PortalSession,
  params: FetchRcvArchivoBlobParams,
): Promise<BinaryResponse> {
  const { caIdBLOB, usuarioSesionBody, rutEmisor, caId } = params;
  const path =
    `${FACADE_BASE}/obtenerArchivoBLOB/${encodeURIComponent(caIdBLOB)}/` +
    `${encodeURIComponent(usuarioSesionBody)}/` +
    `${encodeURIComponent(String(rutEmisor.body))}/` +
    `${encodeURIComponent(caId)}`;
  try {
    return await session.requestBinary(path, {
      method: 'GET',
      headers: {
        Referer: `${HOSTS.portalApi}/consdcvinternetui/`,
        Accept: '*/*',
      },
    });
  } catch (e) {
    if (e instanceof NotAuthenticatedError) throw e;
    if (e instanceof NetworkError) throw e;
    throw new RcvError('No se pudo descargar el archivo del RCV.');
  }
}

/** Selecciona un job de venta terminado para el período (canonical `YYYYMM`). */
export function pickVentaJobTerminado(
  filas: readonly RcvAsyncJobRow[],
  periodoCanonical: string,
): RcvAsyncJobRow | null {
  const matches = filas.filter(
    (r) =>
      r.caEstado === RCV_ESTADO_JOB_TERMINADO &&
      r.compraOVenta !== 'C' &&
      (r.caPeriodo === null || r.caPeriodo === periodoCanonical),
  );
  return matches[0] ?? null;
}

export function pendingVentaJobs(filas: readonly RcvAsyncJobRow[], periodoCanonical: string): boolean {
  return filas.some(
    (r) =>
      r.caEstado !== RCV_ESTADO_JOB_TERMINADO &&
      r.compraOVenta !== 'C' &&
      (r.caPeriodo === null || r.caPeriodo === periodoCanonical),
  );
}