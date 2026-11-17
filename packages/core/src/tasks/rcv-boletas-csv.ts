// Public API: descarga asíncrona de boletas electrónicas de venta (RCV tipo UI 3941).
import { withSession } from '../auth/index.js';
import { recordAudit } from '../audit/index.js';
import { DEFAULT_SETTINGS } from '../config/index.js';
import { RcvError } from '../errors/index.js';
import { Periodo } from '../periodo/index.js';
import { Rut } from '../rut/index.js';
import {
  fetchRcvArchivoBlob,
  fetchRcvCtrlAsync,
  pendingVentaJobs,
  pickVentaJobTerminado,
  RCV_COD_TIPO_BOLETAS_ELECTRONICAS,
} from '../portal/rcv-async.js';
import type { RcvAsyncJobRow } from '../portal/rcv-async.js';
import { parseRcvBoletasCsvGzip } from '../portal/rcv-boletas-csv-parse.js';
import type { RcvBoletaCsvRow } from '../portal/rcv-boletas-csv-parse.js';
import type { AuditEntry, Runtime } from '../seams/index.js';

export type { RcvBoletaCsvRow } from '../portal/rcv-boletas-csv-parse.js';
export type { RcvAsyncJobRow } from '../portal/rcv-async.js';

const POLL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 600_000;

const pacingMs = (): number => Math.round(1000 / DEFAULT_SETTINGS.rateLimitRps);

const sessionOpts = (rut?: string): { rut?: string } => (rut !== undefined ? { rut } : {});

function audit(runtime: Runtime, action: string, result: string, extra: Partial<AuditEntry>): void {
  recordAudit(runtime, { action, result, ...extra });
}

export interface DocumentoRcvCsv {
  readonly path: string;
  readonly archivo: string;
  readonly bytes: number;
  readonly contentType: 'application/gzip';
}

export interface RcvBoletasCsvResult {
  readonly rut: string;
  readonly periodo: string;
  readonly side: 'VENTA';
  readonly archivo: DocumentoRcvCsv;
  readonly filas: readonly RcvBoletaCsvRow[];
  readonly totalFilas: number;
  /** Mensaje informativo de SII (p. ej. descarga ya vigente), si lo hubo. */
  readonly avisoSii: string | null;
  readonly job: RcvAsyncJobRow | null;
}

export interface RcvBoletasCsvArgs {
  readonly periodo: string;
  readonly directorio: string;
  readonly rut?: string;
  /** Solicitar generación antes de consultar (default true). */
  readonly solicitar?: boolean;
  readonly timeoutMs?: number;
  /** Parsear filas del CSV (default true). */
  readonly parsear?: boolean;
}

function nombreArchivo(periodo: Periodo, rut: Rut): string {
  return `rcv-venta-boletas-${rut.body}-${periodo.canonical}.csv.gz`;
}

export async function rcvBoletasVentaCsv(
  runtime: Runtime,
  args: RcvBoletasCsvArgs,
): Promise<RcvBoletasCsvResult> {
  const files = runtime.files;
  if (!files) {
    throw new RcvError(
      'Este runtime no tiene un FileSink: no se puede escribir el archivo. Usa ' +
        '`createNodeRuntime()` o inyecta un `files` seam (ADR-022).',
    );
  }
  const periodo = Periodo.parse(args.periodo);
  const solicitar = args.solicitar !== false;
  const parsear = args.parsear !== false;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = runtime.clock.now().getTime();

  try {
    const { res, sessionRut } = await withSession(
      runtime,
      async (session, ctx) => {
        const rut = Rut.parse(ctx.operatingRut);
        const sessionRutParsed = Rut.parse(ctx.sessionRut);
        let avisoSii: string | null = null;

        if (solicitar) {
          await runtime.clock.sleep(pacingMs());
          const gen = await fetchRcvCtrlAsync(session, { rut, periodo, genera: true });
          avisoSii = gen.aviso;
        }

        let job: RcvAsyncJobRow | null = null;
        const deadline = start + timeoutMs;

        for (;;) {
          await runtime.clock.sleep(pacingMs());
          const ctrl = await fetchRcvCtrlAsync(session, { rut, periodo, genera: false });
          if (ctrl.aviso) avisoSii = ctrl.aviso;
          job = pickVentaJobTerminado(ctrl.filas, periodo.canonical);
          if (job?.caIdBLOB && job.caId) break;
          if (!pendingVentaJobs(ctrl.filas, periodo.canonical)) {
            throw new RcvError(
              'No hay una descarga de boletas en curso ni terminada para ese período.',
            );
          }
          if (runtime.clock.now().getTime() >= deadline) {
            throw new RcvError(
              `La descarga de boletas no terminó dentro de ${Math.round(timeoutMs / 1000)} s.`,
            );
          }
          await runtime.clock.sleep(POLL_MS);
        }

        const bin = await fetchRcvArchivoBlob(session, {
          caIdBLOB: job.caIdBLOB,
          usuarioSesionBody: String(sessionRutParsed.body),
          rutEmisor: rut,
          caId: job.caId,
        });

        if (bin.status < 200 || bin.status >= 300 || bin.bytes.byteLength === 0) {
          throw new RcvError('SII no entregó un archivo válido para la descarga de boletas.');
        }

        const archivoNombre = nombreArchivo(periodo, rut);
        const path = await files.write(args.directorio, archivoNombre, bin.bytes);

        const filas = parsear ? await parseRcvBoletasCsvGzip(bin.bytes) : [];

        return {
          res: {
            rut: rut.canonical,
            periodo: periodo.formatted,
            side: 'VENTA' as const,
            archivo: {
              path,
              archivo: archivoNombre,
              bytes: bin.bytes.byteLength,
              contentType: 'application/gzip' as const,
            },
            filas,
            totalFilas: filas.length,
            avisoSii,
            job,
          },
          sessionRut: ctx.sessionRut,
        };
      },
      sessionOpts(args.rut),
    );

    audit(runtime, 'rcv_boletas_csv', 'ok', {
      rut: res.rut,
      periodo: periodo.canonical,
      codTipoDoc: RCV_COD_TIPO_BOLETAS_ELECTRONICAS,
      filas: res.totalFilas,
      bytes: res.archivo.bytes,
      durationMs: runtime.clock.now().getTime() - start,
      ...(res.rut !== sessionRut ? { rutAuth: sessionRut } : {}),
    });
    return res;
  } catch (e) {
    audit(runtime, 'rcv_boletas_csv', 'failed', { periodo: periodo.canonical });
    throw e;
  }
}