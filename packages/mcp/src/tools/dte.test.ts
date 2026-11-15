import { describe, it, expect } from 'vitest';
import { testing, type Runtime } from '@albertomarturelo/sii-core';
import { connect, toolText } from '../test-helpers.js';

describe('@albertomarturelo/sii-mcp dte tools (in-memory client, fake runtime, no SII)', () => {
  it('dte_authorized returns the curated public report as JSON — NO login required', async () => {
    const authorizedHtml = `
      <table>
        <tr><td>Rut</td><td>20.000.042-0</td></tr>
        <tr><td>Razon Social/Nombres</td><td>EMPRESA SINTETICA SPA</td></tr>
      </table>
      <table><tr><td>33</td><td>FACTURA ELECTRONICA</td><td>01-08-2014</td><td></td></tr></table>`;
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: new testing.FakePortalDriver({ requestPublic: () => authorizedHtml }),
    };
    const client = await connect(runtime);

    // Called directly, with no auth_login first (public, session-less — ADR-014).
    const res = await client.callTool({ name: 'dte_authorized', arguments: { rut: '20000042-0' } });
    const parsed = JSON.parse(toolText(res)) as {
      rut: string;
      autorizado: boolean;
      documentos: { codigo: number }[];
    };
    expect(parsed).toMatchObject({ rut: '20000042-0', autorizado: true });
    expect(parsed.documentos.map((d) => d.codigo)).toEqual([33]);

    // dte_authorized is read-only.
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'dte_authorized')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'dte_xml')?.annotations?.readOnlyHint).toBe(false);
  });

  it('dte_xml returns file descriptors only and never the XML bytes', async () => {
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
          if (url.includes('lista_documentos.cgi')) return '<div id="cant_reg" value="2"></div>';
          return '';
        },
        requestBinary: () =>
          new TextEncoder().encode(
            '<?xml version="1.0" encoding="ISO-8859-1"?>\n<SetDTE version="1.0"><DTE></DTE></SetDTE>',
          ),
      },
    });
    const runtime: Runtime = {
      clock: new testing.FixedClock(new Date('2026-06-29T12:00:00Z')),
      audit: new testing.RecordingAuditSink(),
      store: new testing.InMemoryKeyValueStore(),
      portal: driver,
      browser: driver,
      files: { write: async (dir, name) => `${dir}/${name}` },
    };
    await testing.seedSession(runtime);
    const client = await connect(runtime);
    const res = await client.callTool({
      name: 'dte_xml',
      arguments: {
        empresa: '76192083-9',
        origen: 'rcp',
        desde: '2026-03-01',
        hasta: '2026-03-31',
        directorio: '/tmp/dte',
      },
    });
    const text = toolText(res);
    expect(text).not.toContain('SetDTE');
    const parsed = JSON.parse(text) as {
      origen: string;
      total: number;
      archivos: { path: string; documentos: number }[];
    };
    expect(parsed).toMatchObject({
      origen: 'RCP',
      total: 2,
      archivos: [
        {
          path: '/tmp/dte/dte-xml-rcp-76192083-9-2026-03-01_2026-03-31-2.xml',
          documentos: 2,
        },
      ],
    });
  });
});
