import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { parseRcvBoletasCsvGzip, parseRcvBoletasCsvText } from './rcv-boletas-csv-parse.js';

describe('parseRcvBoletasCsvText', () => {
  it('parses the observed boletas header and rows', () => {
    const csv = [
      'Tipo Doc;RUT Receptor;Fecha Docto;Fecha Venc.;Indicador Servicio;Folio;Monto Neto;Monto IVA; Monto Exento;Monto Total',
      '39;66666666-6;02/01/2026; ;3;144207;4832;918;0;5750',
    ].join('\n');
    const rows = parseRcvBoletasCsvText(csv);
    expect(rows).toEqual([
      {
        codigoTipoDoc: '39',
        rutReceptor: '66666666-6',
        fechaEmision: '2026-01-02',
        fechaVencimiento: null,
        indicadorServicio: '3',
        folio: 144207,
        montoNeto: 4832,
        montoIva: 918,
        montoExento: 0,
        montoTotal: 5750,
      },
    ]);
  });
});

describe('parseRcvBoletasCsvGzip', () => {
  it('gunzips and parses', async () => {
    const plain =
      'Tipo Doc;RUT Receptor;Fecha Docto;Fecha Venc.;Indicador Servicio;Folio;Monto Neto;Monto IVA; Monto Exento;Monto Total\n' +
      '39;1-9;01/02/2026;;1;1;100;19;0;119\n';
    const gz = gzipSync(Buffer.from(plain, 'utf8'));
    const rows = await parseRcvBoletasCsvGzip(new Uint8Array(gz));
    expect(rows[0]?.folio).toBe(1);
    expect(rows[0]?.montoTotal).toBe(119);
  });
});