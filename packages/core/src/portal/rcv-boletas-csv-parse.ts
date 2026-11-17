// Parser del CSV gzip de boletas electrónicas (RCV venta, tipo DTE 39 en filas).
import { Rut } from '../rut/index.js';
import { RcvError } from '../errors/index.js';

export interface RcvBoletaCsvRow {
  readonly codigoTipoDoc: string;
  readonly rutReceptor: string | null;
  readonly fechaEmision: string | null;
  readonly fechaVencimiento: string | null;
  readonly indicadorServicio: string | null;
  readonly folio: number | null;
  readonly montoNeto: number | null;
  readonly montoIva: number | null;
  readonly montoExento: number | null;
  readonly montoTotal: number | null;
}

function normalizeDmy(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length !== 3) return s;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return s;
  return `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

const asInt = (v: string): number | null => {
  const t = v.trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Descomprime gzip vía Web Streams (sin importar `node:zlib` en el barrel). */
export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const out = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Parsea el texto CSV (separador `;`) con la cabecera observada en boletas venta 2026-01. */
export function parseRcvBoletasCsvText(text: string): RcvBoletaCsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0]!.split(';').map((h) => h.trim().toLowerCase());
  const idx = (names: string[]): number => {
    for (const n of names) {
      const i = header.findIndex((h) => h === n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const iTipo = idx(['tipo doc', 'tipodoc']);
  const iRut = idx(['rut receptor', 'rutreceptor']);
  const iFecha = idx(['fecha docto', 'fechadoc']);
  const iVenc = idx(['fecha venc.', 'fecha venc', 'fechavenc']);
  const iInd = idx(['indicador servicio', 'indicadorservicio']);
  const iFolio = idx(['folio']);
  const iNeto = idx(['monto neto', 'montoneto']);
  const iIva = idx(['monto iva', 'montoiva']);
  const iExe = idx(['monto exento', 'montoexento']);
  const iTot = idx(['monto total', 'montototal']);

  if (iTipo < 0 || iFolio < 0) {
    throw new RcvError('El CSV de boletas del RCV no trae las columnas esperadas.');
  }

  const cell = (cols: string[], i: number): string => (i >= 0 && i < cols.length ? (cols[i] ?? '').trim() : '');

  const out: RcvBoletaCsvRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li]!.split(';');
    const rutRaw = cell(cols, iRut);
    const rutRec =
      rutRaw && rutRaw.includes('-')
        ? (Rut.tryParse(rutRaw)?.canonical ?? rutRaw)
        : rutRaw || null;
    out.push({
      codigoTipoDoc: cell(cols, iTipo) || '39',
      rutReceptor: rutRec,
      fechaEmision: normalizeDmy(cell(cols, iFecha)),
      fechaVencimiento: normalizeDmy(cell(cols, iVenc)),
      indicadorServicio: cell(cols, iInd) || null,
      folio: asInt(cell(cols, iFolio)),
      montoNeto: asInt(cell(cols, iNeto)),
      montoIva: asInt(cell(cols, iIva)),
      montoExento: asInt(cell(cols, iExe)),
      montoTotal: asInt(cell(cols, iTot)),
    });
  }
  return out;
}

export async function parseRcvBoletasCsvGzip(bytes: Uint8Array): Promise<RcvBoletaCsvRow[]> {
  const plain = await gunzipBytes(bytes);
  const text = new TextDecoder('iso-8859-1').decode(plain);
  return parseRcvBoletasCsvText(text);
}