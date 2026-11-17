import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryFileSink,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '../adapters/fake/index.js';
import type { JsonRequest, Runtime } from '../seams/index.js';
import { initOperateState } from '../identity/index.js';
import { writeSession } from '../auth/index.js';
import { rcvBoletasVentaCsv } from './rcv-boletas-csv.js';

const SELF = '20000042-0';
const CSV_HEADER =
  'Tipo Doc;RUT Receptor;Fecha Docto;Fecha Venc.;Indicador Servicio;Folio;Monto Neto;Monto IVA; Monto Exento;Monto Total\n';
const CSV_ROW = '39;1-9;01/02/2026;;1;99;100;19;0;119\n';
const GZ = new Uint8Array(gzipSync(Buffer.from(CSV_HEADER + CSV_ROW, 'utf8')));

function makeRuntime(
  requestJson: (url: string, options?: JsonRequest) => unknown,
  requestBinary?: () => { status: number; contentType: string; bytes: Uint8Array },
): Runtime {
  let poll = 0;
  const json = (url: string, options?: JsonRequest): unknown => {
    if (url.includes('getCtrlAsync')) {
      poll++;
      if (poll === 1) {
        return {
          respEstado: { codRespuesta: 1, msgeRespuesta: 'Descarga vigente.' },
          data: [{ caEstado: 'EN PROCESO', compraOVenta: 'V', caPeriodo: '202601' }],
        };
      }
      return {
        respEstado: { codRespuesta: 0 },
        data: [
          {
            caEstado: 'TERMINADO',
            caIdBLOB: 'blobx',
            caId: '5',
            caPeriodo: '202601',
            compraOVenta: 'V',
          },
        ],
      };
    }
    return requestJson(url, options);
  };
  return {
    clock: new FixedClock(new Date('2026-06-27T12:00:00Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    files: new InMemoryFileSink(),
    portal: new FakePortalDriver({
      restoreSession: {
        requestJson: json,
        requestBinary: requestBinary ?? (() => ({ status: 200, contentType: 'application/gzip', bytes: GZ })),
        cookies: { TOKEN: 't' },
      },
    }),
  };
}

async function seed(runtime: Runtime): Promise<void> {
  await writeSession(runtime.store, { rut: SELF, cookies: ['c'], savedAt: '2026-06-27T12:00:00Z' });
  await initOperateState(runtime.store, {
    selfRut: SELF,
    accountType: 'persona',
    operable: [{ rut: SELF, razonSocial: 'Test', isSelf: true }],
  });
}

describe('rcvBoletasVentaCsv', () => {
  it('polls until TERMINADO, writes gzip, parses filas tipadas', async () => {
    const rt = makeRuntime(() => ({}));
    await seed(rt);
    const res = await rcvBoletasVentaCsv(rt, {
      periodo: '2026-01',
      directorio: '/tmp/rcv',
      timeoutMs: 120_000,
    });
    expect(res).toMatchObject({
      rut: SELF,
      periodo: '2026-01',
      side: 'VENTA',
      totalFilas: 1,
      avisoSii: 'Descarga vigente.',
    });
    expect(res.filas[0]).toMatchObject({ folio: 99, montoTotal: 119 });
    expect(res.archivo.contentType).toBe('application/gzip');
    expect((rt.files as InMemoryFileSink).files.size).toBe(1);
  });
});