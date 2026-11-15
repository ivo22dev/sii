// Curated DTE XML parser for signed `<SetDTE>` / `<EnvioDTE>` / `<EnvioBOLETA>` bundles (ADR-037).
// Pure projection only: no `raw` bag and no `<TED>` / `<Signature>` blobs (ADR-004 / ADR-006).
// Configured with `processEntities: false` and `parseTagValue: false` so untrusted third-party
// XMLs (`ORIGEN=RCP`) cannot trigger entity expansion or silent numeric coercion.
import { XMLParser } from 'fast-xml-parser';
import { repairMojibake } from '../format/text.js';
import { Rut } from '../rut/index.js';

export type DteXmlSide = 'compra' | 'venta';

export interface DteXmlContraparte {
  readonly rut: string;
  readonly razonSocial: string;
  readonly giro?: string;
  readonly direccion?: string;
  readonly comuna?: string;
  readonly ciudad?: string;
  readonly acteco?: string;
}

/** Entry from `<ImptoReten>`; `tipoImp` classifies whether it is an additional tax or a withholding. */
export interface DteXmlImpuestoRetenido {
  readonly tipoImp: string;
  readonly tasaImp?: number;
  readonly montoImp: number;
}

/** @deprecated Use `DteXmlImpuestoRetenido`; `<ImptoReten>` is not always an additional tax. */
export type DteXmlImpuestoAdicional = DteXmlImpuestoRetenido;

export interface DteXmlAjusteGlobal {
  readonly nroLinDr?: number;
  readonly tipoMovimiento?: string;
  readonly glosa?: string;
  readonly tipoValor?: string;
  readonly valor?: number;
}

export interface DteXmlPago {
  readonly fecha?: string;
  readonly monto?: number;
}

export interface DteXmlTotalAudit {
  readonly status: 'cuadra' | 'diferencia' | 'requiere_revision';
  readonly expectedTotal?: number;
  readonly reportedTotal: number;
  readonly delta?: number;
  readonly components: Readonly<Record<string, number>>;
  readonly unclassifiedTaxCodes: readonly string[];
  readonly note: string;
}

export interface DteXmlLinea {
  readonly nroLinDet: number;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly cantidad: number;
  readonly unidad?: string;
  readonly precioUnitario: number;
  readonly monto: number;
  readonly descuentoMonto?: number;
  readonly descuentoPorcentaje?: number;
  readonly recargoMonto?: number;
  readonly indicacionExento?: number;
  readonly codigoItem?: { readonly tipo: string; readonly valor: string };
  readonly codImpAdic?: string;
}

export interface DteXmlReferencia {
  readonly nroLinRef: number;
  readonly tipoDocRef?: string;
  readonly folioRef?: string;
  readonly rutOtro?: string;
  readonly idAdicionalOtro?: string;
  readonly fechaRef?: string;
  readonly codigoRef?: number;
  readonly razonRef?: string;
}

export interface DteXmlDocumento {
  readonly tipoDte: string;
  readonly folio: string;
  readonly fechaEmision: string;
  readonly fechaVencimiento?: string;
  readonly emisor: DteXmlContraparte;
  readonly receptor: DteXmlContraparte;
  /** Emisor in purchases (`compra` / `RCP`), receptor in sales (`venta` / `ENV`). */
  readonly contraparte: DteXmlContraparte;
  /** SII indicator reporting whether detail line amounts are gross (`MntBruto`). */
  readonly mntBruto?: number;
  readonly totales: {
    readonly neto?: number;
    readonly exento?: number;
    readonly tasaIva?: number;
    readonly iva?: number;
    readonly montoBase?: number;
    readonly montoNoFacturable?: number;
    readonly montoPeriodo?: number;
    readonly valorPorPagar?: number;
    readonly ivaPropio?: number;
    readonly ivaTerceros?: number;
    readonly ivaNoRetenido?: number;
    readonly creditoEmpresasConstructoras?: number;
    readonly garantiaDeposito?: number;
    readonly montoMargenComercializacion?: number;
    readonly comisionesOtrosCargos?: {
      readonly neto?: number;
      readonly exento?: number;
      readonly iva?: number;
    };
    readonly total: number;
    readonly impuestosRetenidos: readonly DteXmlImpuestoRetenido[];
  };
  readonly lineas: readonly DteXmlLinea[];
  readonly ajustesGlobales: readonly DteXmlAjusteGlobal[];
  readonly formaPago?: string;
  readonly medioPago?: string;
  readonly tipoTransaccionCompra?: string;
  readonly tipoTransaccionVenta?: string;
  readonly pagos: readonly DteXmlPago[];
  readonly terminosPago?: {
    readonly codigo?: string;
    readonly dias?: number;
    readonly glosa?: string;
  };
  readonly referencias: readonly DteXmlReferencia[];
}

export interface DteXmlParseResult {
  readonly side: DteXmlSide;
  readonly documentos: readonly DteXmlDocumento[];
  /** Suppliers (`compra`) or customers (`venta`), deduplicated by canonical Mod-11 RUT. */
  readonly contrapartes: readonly DteXmlContraparte[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  processEntities: false,
  isArray: (name) =>
    name === 'DTE' ||
    name === 'Detalle' ||
    name === 'Referencia' ||
    name === 'ImptoReten' ||
    name === 'CdgItem' ||
    name === 'DscRcgGlobal' ||
    name === 'MntPagos',
});

const win1252Decoder = new TextDecoder('windows-1252');

/** Decode raw `ISO-8859-1` / `windows-1252` DTE XML bytes into a string without losing `0x80..0x9F`
 *  characters (ADR-037). */
export function decodeDteXmlBytes(xml: string | Uint8Array): string {
  return typeof xml === 'string' ? xml : win1252Decoder.decode(xml);
}

/** Map `ORIGEN` (`ENV` | `RCP`) from Respaldo MIPYME to `DteXmlSide`. */
export function respaldoOrigenToSide(origen: 'ENV' | 'RCP' | 'env' | 'rcp'): DteXmlSide {
  return origen.toUpperCase() === 'RCP' ? 'compra' : 'venta';
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Unescape only standard XML predefined entities and numeric character references (`processEntities`
 *  is disabled on `XMLParser` to prevent DTD entity-expansion attacks, ADR-037), then repair SII
 *  double-encoding (`repairMojibake`). */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  const raw = String(v)
    .trim()
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _m;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return repairMojibake(raw);
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const s = typeof v === 'string' ? v.trim() : String(v);
  if (!s) return undefined;
  const n = typeof v === 'number' ? v : Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function parseRut(raw: string): string {
  const t = str(raw);
  if (!t) return '';
  return Rut.tryParse(t)?.canonical ?? t.replace(/\s+/g, '');
}

function contraparteFromEmisor(e: Record<string, unknown> | undefined): DteXmlContraparte {
  if (!e) {
    return { rut: '', razonSocial: '' };
  }
  const giro = str(e['GiroEmis']) || str(e['GiroEmisor']);
  const direccion = str(e['DirOrigen']);
  const comuna = str(e['CmnaOrigen']);
  const ciudad = str(e['CiudadOrigen']);
  const acteco = str(e['Acteco']);
  const razonSocial = str(e['RznSoc']) || str(e['RznSocEmisor']) || str(e['RznSocBoleta']);
  return {
    rut: parseRut(str(e['RUTEmisor'])),
    razonSocial,
    ...(giro ? { giro } : {}),
    ...(direccion ? { direccion } : {}),
    ...(comuna ? { comuna } : {}),
    ...(ciudad ? { ciudad } : {}),
    ...(acteco ? { acteco } : {}),
  };
}

function contraparteFromReceptor(r: Record<string, unknown> | undefined): DteXmlContraparte {
  if (!r) {
    return { rut: '', razonSocial: '' };
  }
  const giro = str(r['GiroRecep']);
  const direccion = str(r['DirRecep']);
  const comuna = str(r['CmnaRecep']);
  const ciudad = str(r['CiudadRecep']);
  return {
    rut: parseRut(str(r['RUTRecep'])),
    razonSocial: str(r['RznSocRecep']),
    ...(giro ? { giro } : {}),
    ...(direccion ? { direccion } : {}),
    ...(comuna ? { comuna } : {}),
    ...(ciudad ? { ciudad } : {}),
  };
}

function parseImptoReten(totales: Record<string, unknown> | undefined): DteXmlImpuestoRetenido[] {
  return asArray(totales?.['ImptoReten']).map((raw) => {
    const row = raw as Record<string, unknown>;
    const tasaImp = num(row['TasaImp']);
    return {
      tipoImp: str(row['TipoImp']),
      montoImp: num(row['MontoImp']) ?? 0,
      ...(tasaImp !== undefined ? { tasaImp } : {}),
    };
  });
}

/** Audit `MntTotal` using the fiscal component rules in the SII DTE format. */
export function auditDteXmlTotal(
  totals: DteXmlDocumento['totales'],
  side: DteXmlSide,
): DteXmlTotalAudit {
  const components: Record<string, number> = {};
  const add = (name: string, value: number | undefined) => {
    if (value !== undefined) components[name] = value;
  };
  add('MntNeto', totals.neto);
  add('MntExe', totals.exento);
  add('IVA', totals.iva);
  add(
    'CredEC',
    totals.creditoEmpresasConstructoras === undefined
      ? undefined
      : -totals.creditoEmpresasConstructoras,
  );
  add('Garantia', totals.garantiaDeposito);
  add(
    'ComisionesNeto',
    totals.comisionesOtrosCargos?.neto === undefined
      ? undefined
      : -totals.comisionesOtrosCargos.neto,
  );
  add(
    'ComisionesExento',
    totals.comisionesOtrosCargos?.exento === undefined
      ? undefined
      : -totals.comisionesOtrosCargos.exento,
  );
  add(
    'ComisionesIVA',
    totals.comisionesOtrosCargos?.iva === undefined ? undefined : -totals.comisionesOtrosCargos.iva,
  );

  const unclassifiedTaxCodes: string[] = [];
  for (const tax of totals.impuestosRetenidos) {
    const code = tax.tipoImp;
    const amount = tax.montoImp;
    // SII additional/specific taxes and margin/anticipated VAT increase MntTotal.
    if (
      [
        '14',
        '17',
        '18',
        '19',
        '23',
        '24',
        '25',
        '26',
        '27',
        '28',
        '35',
        '44',
        '45',
        '50',
        '51',
        '52',
      ].includes(code)
    ) {
      components[`ImptoReten_${code}`] = (components[`ImptoReten_${code}`] ?? 0) + amount;
      // Product VAT withheld is deducted only in purchase documents.
    } else if (
      ['15', '30', '31', '32', '33', '34', '36', '37', '38', '39', '41', '46', '47', '48'].includes(
        code,
      )
    ) {
      if (side === 'compra') {
        components[`Retencion_${code}`] = (components[`Retencion_${code}`] ?? 0) - amount;
      } else unclassifiedTaxCodes.push(code);
    } else if (code === '49' && amount === 0) {
      // Code 49 explicitly carries no withholding amount.
    } else unclassifiedTaxCodes.push(code || '(sin TipoImp)');
  }
  if (unclassifiedTaxCodes.length) {
    return {
      status: 'requiere_revision',
      reportedTotal: totals.total,
      components,
      unclassifiedTaxCodes: [...new Set(unclassifiedTaxCodes)],
      note: 'Hay códigos de impuesto sin clasificar para esta cara del DTE; se conserva MntTotal y no se calcula una diferencia.',
    };
  }
  const expectedTotal = Object.values(components).reduce((sum, value) => sum + value, 0);
  const delta = totals.total - expectedTotal;
  return {
    status: delta === 0 ? 'cuadra' : 'diferencia',
    expectedTotal,
    reportedTotal: totals.total,
    delta,
    components,
    unclassifiedTaxCodes: [],
    note: 'Los componentes opcionales ausentes se interpretan como cero para esta ecuación y permanecen ausentes en el modelo. MntBase, MontoNF, MontoPeriodo, VlrPagar, MntPagos, MntBruto y descuentos/recargos no se vuelven a sumar; son bases, auxiliares o ya están incorporados en los montos agregados.',
  };
}

function parseLineas(detalle: unknown): DteXmlLinea[] {
  return asArray(detalle).map((raw) => {
    const row = raw as Record<string, unknown>;
    const cdgRaw = row['CdgItem'];
    const cdg = (Array.isArray(cdgRaw) ? cdgRaw[0] : cdgRaw) as Record<string, unknown> | undefined;
    const descripcion = str(row['DscItem']);
    const unidad = str(row['UnmdItem']);
    const codImpAdic = str(row['CodImpAdic']);
    const tpo = cdg ? str(cdg['TpoCodigo']) : '';
    const descuentoMonto = num(row['DescuentoMonto']);
    const descuentoPorcentaje = num(row['DescuentoPct']);
    const recargoMonto = num(row['RecargoMonto']);
    const indicacionExento = num(row['IndExe']);
    return {
      nroLinDet: num(row['NroLinDet']) ?? 0,
      nombre: str(row['NmbItem']),
      cantidad: num(row['QtyItem']) ?? 0,
      precioUnitario: num(row['PrcItem']) ?? 0,
      monto: num(row['MontoItem']) ?? 0,
      ...(descripcion ? { descripcion } : {}),
      ...(unidad ? { unidad } : {}),
      ...(descuentoMonto !== undefined ? { descuentoMonto } : {}),
      ...(descuentoPorcentaje !== undefined ? { descuentoPorcentaje } : {}),
      ...(recargoMonto !== undefined ? { recargoMonto } : {}),
      ...(indicacionExento !== undefined ? { indicacionExento } : {}),
      ...(tpo ? { codigoItem: { tipo: tpo, valor: str(cdg!['VlrCodigo']) } } : {}),
      ...(codImpAdic ? { codImpAdic } : {}),
    };
  });
}

function parseAjustesGlobales(raw: unknown): DteXmlAjusteGlobal[] {
  return asArray(raw).map((item) => {
    const row = item as Record<string, unknown>;
    const nroLinDr = num(row['NroLinDR']);
    const tipoMovimiento = str(row['TpoMov']);
    const glosa = str(row['GlosaDR']);
    const tipoValor = str(row['TpoValor']);
    const valor = num(row['ValorDR']);
    return {
      ...(nroLinDr !== undefined ? { nroLinDr } : {}),
      ...(tipoMovimiento ? { tipoMovimiento } : {}),
      ...(glosa ? { glosa } : {}),
      ...(tipoValor ? { tipoValor } : {}),
      ...(valor !== undefined ? { valor } : {}),
    };
  });
}

function parsePagos(raw: unknown): DteXmlPago[] {
  return asArray(raw).map((item) => {
    const row = item as Record<string, unknown>;
    const fecha = str(row['FchPago']);
    const monto = num(row['MntPago']);
    return {
      ...(fecha ? { fecha } : {}),
      ...(monto !== undefined ? { monto } : {}),
    };
  });
}

function parseReferencias(ref: unknown): DteXmlReferencia[] {
  return asArray(ref).map((raw) => {
    const row = raw as Record<string, unknown>;
    const tipoDocRef = str(row['TpoDocRef']);
    const folioRef = str(row['FolioRef']);
    const fechaRef = str(row['FchRef']);
    const rutOtro = str(row['RUTOtr']);
    const idAdicionalOtro = str(row['IdAdicOtr']);
    const codigoRef = num(row['CodRef']);
    const razonRef = str(row['RazonRef']);
    return {
      nroLinRef: num(row['NroLinRef']) ?? 0,
      ...(tipoDocRef ? { tipoDocRef } : {}),
      ...(folioRef ? { folioRef } : {}),
      ...(rutOtro ? { rutOtro } : {}),
      ...(idAdicionalOtro ? { idAdicionalOtro } : {}),
      ...(fechaRef ? { fechaRef } : {}),
      ...(codigoRef !== undefined ? { codigoRef } : {}),
      ...(razonRef ? { razonRef } : {}),
    };
  });
}

function parseDocumento(doc: Record<string, unknown>, side: DteXmlSide): DteXmlDocumento | null {
  const enc = doc['Encabezado'] as Record<string, unknown> | undefined;
  if (!enc) return null;
  const idDoc = enc['IdDoc'] as Record<string, unknown> | undefined;
  const tot = enc['Totales'] as Record<string, unknown> | undefined;
  const tipoDte = str(idDoc?.['TipoDTE']);
  const folio = str(idDoc?.['Folio']);
  const fechaEmision = str(idDoc?.['FchEmis']).slice(0, 10);
  if (!tipoDte || !folio || !fechaEmision) return null;

  const emisor = contraparteFromEmisor(enc['Emisor'] as Record<string, unknown>);
  const receptor = contraparteFromReceptor(enc['Receptor'] as Record<string, unknown>);
  const contraparte = side === 'compra' ? emisor : receptor;
  const fechaVenc = str(idDoc?.['FchVenc']).slice(0, 10);
  const neto = num(tot?.['MntNeto']);
  const exento = num(tot?.['MntExe']);
  const tasaIva = num(tot?.['TasaIVA']);
  const iva = num(tot?.['IVA']);
  const mntBruto = num(idDoc?.['MntBruto']);
  const montoBase = num(tot?.['MntBase']);
  const montoNoFacturable = num(tot?.['MontoNF']);
  const montoPeriodo = num(tot?.['MontoPeriodo']);
  const valorPorPagar = num(tot?.['VlrPagar']);
  const ivaPropio = num(tot?.['IVAProp']);
  const ivaTerceros = num(tot?.['IVATerc']);
  const ivaNoRetenido = num(tot?.['IVANoRet']);
  const creditoEmpresasConstructoras = num(tot?.['CredEC']);
  const garantiaDeposito = num(tot?.['GrntDep']);
  const montoMargenComercializacion = num(tot?.['MntMargenCom']);
  const comisionesNeto = num(tot?.['ValComNeto']);
  const comisionesExento = num(tot?.['ValComExe']);
  const comisionesIva = num(tot?.['ValComIVA']);
  const formaPago = str(idDoc?.['FmaPago']);
  const medioPago = str(idDoc?.['MedioPago']);
  const tipoTransaccionCompra = str(idDoc?.['TpoTranCompra']);
  const tipoTransaccionVenta = str(idDoc?.['TpoTranVenta']);
  const codigoTerminoPago = str(idDoc?.['TermPagoCdg']);
  const diasTerminoPago = num(idDoc?.['TermPagoDias']);
  const glosaTerminoPago = str(idDoc?.['TermPagoGlosa']);
  const terminosPago =
    codigoTerminoPago || diasTerminoPago !== undefined || glosaTerminoPago
      ? {
          ...(codigoTerminoPago ? { codigo: codigoTerminoPago } : {}),
          ...(diasTerminoPago !== undefined ? { dias: diasTerminoPago } : {}),
          ...(glosaTerminoPago ? { glosa: glosaTerminoPago } : {}),
        }
      : undefined;

  return {
    tipoDte,
    folio,
    fechaEmision,
    ...(fechaVenc ? { fechaVencimiento: fechaVenc } : {}),
    emisor,
    receptor,
    contraparte,
    ...(mntBruto !== undefined ? { mntBruto } : {}),
    totales: {
      total: num(tot?.['MntTotal']) ?? 0,
      impuestosRetenidos: parseImptoReten(tot),
      ...(neto !== undefined ? { neto } : {}),
      ...(exento !== undefined ? { exento } : {}),
      ...(tasaIva !== undefined ? { tasaIva } : {}),
      ...(iva !== undefined ? { iva } : {}),
      ...(montoBase !== undefined ? { montoBase } : {}),
      ...(montoNoFacturable !== undefined ? { montoNoFacturable } : {}),
      ...(montoPeriodo !== undefined ? { montoPeriodo } : {}),
      ...(valorPorPagar !== undefined ? { valorPorPagar } : {}),
      ...(ivaPropio !== undefined ? { ivaPropio } : {}),
      ...(ivaTerceros !== undefined ? { ivaTerceros } : {}),
      ...(ivaNoRetenido !== undefined ? { ivaNoRetenido } : {}),
      ...(creditoEmpresasConstructoras !== undefined ? { creditoEmpresasConstructoras } : {}),
      ...(garantiaDeposito !== undefined ? { garantiaDeposito } : {}),
      ...(montoMargenComercializacion !== undefined ? { montoMargenComercializacion } : {}),
      ...(comisionesNeto !== undefined ||
      comisionesExento !== undefined ||
      comisionesIva !== undefined
        ? {
            comisionesOtrosCargos: {
              ...(comisionesNeto !== undefined ? { neto: comisionesNeto } : {}),
              ...(comisionesExento !== undefined ? { exento: comisionesExento } : {}),
              ...(comisionesIva !== undefined ? { iva: comisionesIva } : {}),
            },
          }
        : {}),
    },
    lineas: parseLineas(doc['Detalle']),
    ajustesGlobales: parseAjustesGlobales(doc['DscRcgGlobal']),
    ...(formaPago ? { formaPago } : {}),
    ...(medioPago ? { medioPago } : {}),
    ...(tipoTransaccionCompra ? { tipoTransaccionCompra } : {}),
    ...(tipoTransaccionVenta ? { tipoTransaccionVenta } : {}),
    pagos: parsePagos(idDoc?.['MntPagos']),
    ...(terminosPago ? { terminosPago } : {}),
    referencias: parseReferencias(doc['Referencia']),
  };
}

/** Deduplicate counterparties by canonical Mod-11 RUT (non-empty). */
export function uniqueContrapartes(docs: readonly DteXmlDocumento[]): DteXmlContraparte[] {
  const byRut = new Map<string, DteXmlContraparte>();
  for (const d of docs) {
    const c = d.contraparte;
    if (!c.rut) continue;
    if (!byRut.has(c.rut)) byRut.set(c.rut, c);
  }
  return [...byRut.values()].sort((a, b) => a.rut.localeCompare(b.rut));
}

/** Locate `<DTE>` wrappers across `<SetDTE>`, `<EnvioDTE>`, `<EnvioBOLETA>`, or standalone `<DTE>`. */
function collectDteWrappers(root: Record<string, unknown>): Record<string, unknown>[] {
  const envio = (root['EnvioDTE'] ?? root['EnvioBOLETA']) as Record<string, unknown> | undefined;
  if (envio?.['SetDTE']) {
    return asArray((envio['SetDTE'] as Record<string, unknown>)['DTE']) as Record<
      string,
      unknown
    >[];
  }
  const setDte = root['SetDTE'] as Record<string, unknown> | undefined;
  if (setDte) {
    return asArray(setDte['DTE']) as Record<string, unknown>[];
  }
  const dte = root['DTE'];
  if (dte !== undefined && dte !== null) {
    const one = dte as Record<string, unknown>;
    if (one['Documento']) return [one];
    return asArray(dte) as Record<string, unknown>[];
  }
  if (root['Documento']) return [root];
  return [];
}

/** Parse one or more DTE documents from a Respaldo MIPYME XML string or raw `ISO-8859-1` /
 *  `windows-1252` `Uint8Array` (ADR-037). */
export function parseDteRespaldoXml(xml: string | Uint8Array, side: DteXmlSide): DteXmlParseResult {
  const decoded = decodeDteXmlBytes(xml);
  const root = xmlParser.parse(decoded) as Record<string, unknown>;
  const dtes = collectDteWrappers(root);
  const documentos: DteXmlDocumento[] = [];
  for (const dte of dtes) {
    const doc = dte['Documento'] as Record<string, unknown> | undefined;
    if (!doc) continue;
    const parsed = parseDocumento(doc, side);
    if (parsed) documentos.push(parsed);
  }
  return {
    side,
    documentos,
    contrapartes: uniqueContrapartes(documentos),
  };
}

/** Parse multiple tramo bundles (e.g. after `dteXml`). */
export function parseDteRespaldoXmlFiles(
  files: readonly { readonly xml: string | Uint8Array; readonly side: DteXmlSide }[],
): DteXmlParseResult {
  const documentos: DteXmlDocumento[] = [];
  for (const f of files) {
    documentos.push(...parseDteRespaldoXml(f.xml, f.side).documentos);
  }
  const side = files[0]?.side ?? 'compra';
  return { side, documentos, contrapartes: uniqueContrapartes(documentos) };
}
