import { describe, it, expect } from 'vitest';
import { testing, type Runtime } from '@albertomarturelo/sii-core';
import { run, runJson } from '../test-helpers.js';

describe('sii dte command (fake runtime, no SII)', () => {
  // Public consulta: no login. The driver scripts requestPublic (no session/cookies).
  const AUTHORIZED_HTML = `
    <table>
      <tr><td>Rut</td><td>20.000.042-0</td></tr>
      <tr><td>Razon Social/Nombres</td><td>EMPRESA SINTETICA SPA</td></tr>
      <tr><td>N Resolucion</td><td>80</td></tr>
    </table>
    <table>
      <tr><td>33</td><td>FACTURA ELECTRONICA</td><td>01-08-2014</td><td></td></tr>
      <tr><td>61</td><td>NOTA CREDITO ELECTRONICA</td><td>01-08-2014</td><td>15-01-2020</td></tr>
    </table>`;
  const NOT_AUTHORIZED_HTML =
    '<table><tr><td>El rut que ha ingresado, no corresponde a una empresa autorizada a emitir Facturas Electronicas.</td></tr></table>';

  const makeDteRuntime = (requestPublic: () => string): Runtime => ({
    clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
    audit: new testing.RecordingAuditSink(),
    store: new testing.InMemoryKeyValueStore(),
    portal: new testing.FakePortalDriver({ requestPublic }),
  });

  it('dte authorized <rut> prints the authorized documents WITHOUT any login', async () => {
    const out = await run(
      makeDteRuntime(() => AUTHORIZED_HTML),
      'dte',
      'authorized',
      '20000042-0',
    );
    expect(out).toContain('DTE autorizados — 20.000.042-0');
    expect(out).toContain('EMPRESA SINTETICA SPA');
    expect(out).toContain('33');
    expect(out).toContain('desautorizado 15-01-2020'); // 61's desautorización surfaced
    expect(out).toContain('2 tipo(s) de documento.');
  });

  it('dte authorized for a non-emisor RUT prints the verbatim SII message', async () => {
    const out = await run(
      makeDteRuntime(() => NOT_AUTHORIZED_HTML),
      'dte',
      'authorized',
      '20000042-0',
    );
    expect(out).toContain('no corresponde a una empresa autorizada');
  });

  it('JSON default: dte authorized emits the curated report object', async () => {
    const json = (await runJson(
      makeDteRuntime(() => AUTHORIZED_HTML),
      'dte',
      'authorized',
      '20000042-0',
    )) as { rut: string; autorizado: boolean; documentos: { codigo: number }[] };
    expect(json).toMatchObject({ rut: '20000042-0', autorizado: true });
    expect(json.documentos.map((d) => d.codigo)).toEqual([33, 61]);
  });

  it('dte authorized requires the rut argument', async () => {
    await expect(
      run(
        makeDteRuntime(() => AUTHORIZED_HTML),
        'dte',
        'authorized',
      ),
    ).rejects.toThrow();
  });

  it('dte xml downloads signed XML sets and prints descriptor paths', async () => {
    const driver = new testing.FakePortalDriver({
      restoreSession: {
        requestForm: (url: string) => {
          if (url.includes('mipeSelEmpresa.cgi?')) {
            return '<form name="fPrmEmpPOP"><select name="RUT_EMP"><option value="76192083-9">ACME SPA 76192083-9</select></form>';
          }
          if (url.includes('mipeSelEmpresa.cgi')) return '<html>formulario</html>';
          return '';
        },
        requestText: (url: string) => {
          if (url.includes('lista_documentos.cgi')) return '<div id="cant_reg" value="3"></div>';
          return '';
        },
        requestBinary: () =>
          new TextEncoder().encode(
            '<?xml version="1.0" encoding="ISO-8859-1"?>\n<SetDTE version="1.0"></SetDTE>',
          ),
      },
    });
    const rt: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: driver,
      browser: driver,
      files: { write: async (dir, name) => `${dir}/${name}` },
    };
    await testing.seedSession(rt);

    const out = await run(
      rt,
      'dte',
      'xml',
      '--empresa',
      '76192083-9',
      '--origen',
      'env',
      '--desde',
      '2026-03-01',
      '--hasta',
      '2026-03-31',
      '--out',
      '/tmp/dte',
    );
    expect(out).toContain('Respaldo XML (emitidos) — 76192083-9 ACME SPA');
    expect(out).toContain('/tmp/dte/dte-xml-env-76192083-9-2026-03-01_2026-03-31-3.xml');
    expect(out).toContain('3 documento(s) en 1 archivo(s).');
  });
});
