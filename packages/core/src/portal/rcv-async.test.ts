import { describe, it, expect } from 'vitest';
import { FakePortalSession } from '../adapters/fake/index.js';
import { Rut } from '../rut/index.js';
import { Periodo } from '../periodo/index.js';
import {
  fetchRcvCtrlAsync,
  fetchRcvArchivoBlob,
  pickVentaJobTerminado,
  pendingVentaJobs,
} from './rcv-async.js';

const RUT = Rut.parse('20000042-0');
const PERIODO = Periodo.parse('2026-01');

describe('RCV async facade (fake session)', () => {
  it('getCtrlAsync sends generaCtrl and operacion VENTA', async () => {
    const s = new FakePortalSession({
      requestJson: () => ({
        respEstado: { codRespuesta: 0 },
        data: [
          {
            caEstado: 'TERMINADO',
            caIdBLOB: 'blob1',
            caId: '42',
            caPeriodo: '202601',
            compraOVenta: 'V',
          },
        ],
      }),
      cookies: { TOKEN: 'x' },
    });

    const res = await fetchRcvCtrlAsync(s, { rut: RUT, periodo: PERIODO, genera: true });
    expect(res.filas[0]).toMatchObject({ caEstado: 'TERMINADO', caIdBLOB: 'blob1' });
    const body = (s.lastRequest?.options?.body as { data: Record<string, unknown> }).data;
    expect(body).toMatchObject({
      rutEmisor: '20000042',
      ptributario: '202601',
      generaCtrl: true,
      operacion: 'VENTA',
      codTipoDoc: '3941',
      accionRecaptcha: 'RCV_DBEA',
    });
  });

  it('pickVentaJobTerminado ignores compra jobs', () => {
    const filas = [
      {
        caEstado: 'TERMINADO',
        caIdBLOB: 'b',
        caId: '1',
        caPeriodo: '202601',
        caTipoDoc: '3941',
        compraOVenta: 'C',
        seccionCompra: null,
        raw: {},
      },
      {
        caEstado: 'TERMINADO',
        caIdBLOB: 'b2',
        caId: '2',
        caPeriodo: '202601',
        caTipoDoc: '3941',
        compraOVenta: 'V',
        seccionCompra: null,
        raw: {},
      },
    ];
    expect(pickVentaJobTerminado(filas, '202601')?.caId).toBe('2');
    expect(pendingVentaJobs(filas, '202601')).toBe(false);
  });

  it('fetchRcvArchivoBlob builds the observed URL', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const s = new FakePortalSession({
      requestBinary: (url) => {
        expect(url).toContain('/obtenerArchivoBLOB/blob9/20000042/20000042/7');
        return { status: 200, contentType: 'application/gzip', bytes };
      },
    });
    const res = await fetchRcvArchivoBlob(s, {
      caIdBLOB: 'blob9',
      usuarioSesionBody: '20000042',
      rutEmisor: RUT,
      caId: '7',
    });
    expect(res.bytes).toEqual(bytes);
  });
});