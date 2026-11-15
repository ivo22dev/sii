import { describe, expect, it } from 'vitest';
import {
  auditDteXmlTotal,
  decodeDteXmlBytes,
  parseDteRespaldoXml,
  parseDteRespaldoXmlFiles,
  respaldoOrigenToSide,
  uniqueContrapartes,
} from './dte-xml-parse.js';

// Synthetic RUTs only (ADR-006):
//   76192083-9 (emisor / proveedor)
//   64000001-5 (receptor / cliente)
//   77111222-6 (segundo proveedor)
//   11111111-1 (tercer emisor)

const SET_DTE_COMPRA_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<SetDTE ID="SetDoc">
  <DTE version="1.0">
    <Documento ID="F101T33">
      <Encabezado>
        <IdDoc>
          <TipoDTE>33</TipoDTE>
          <Folio>101</Folio>
          <FchEmis>2026-10-05</FchEmis>
          <MntBruto>0</MntBruto>
          <FmaPago>1</FmaPago>
          <MedioPago>OT</MedioPago>
          <TermPagoCdg>FRF</TermPagoCdg>
          <TermPagoDias>30</TermPagoDias>
          <TermPagoGlosa>Contado</TermPagoGlosa>
          <MntPagos>
            <FchPago>2026-11-04</FchPago>
            <MntPago>84230</MntPago>
          </MntPagos>
        </IdDoc>
        <Emisor>
          <RUTEmisor>76192083-9</RUTEmisor>
          <RznSoc>PROVEEDOR SINTETICO UNO SPA</RznSoc>
          <GiroEmis>DISTRIBUCION DE INSUMOS</GiroEmis>
          <DirOrigen>AV SINTETICA 100</DirOrigen>
          <CmnaOrigen>SANTIAGO</CmnaOrigen>
          <CiudadOrigen>SANTIAGO</CiudadOrigen>
        </Emisor>
        <Receptor>
          <RUTRecep>64000001-5</RUTRecep>
          <RznSocRecep>COMPRADOR DEMO LTDA</RznSocRecep>
          <GiroRecep>COMERCIO MINORISTA</GiroRecep>
          <DirRecep>CALLE DEMO 200</DirRecep>
          <CmnaRecep>PROVIDENCIA</CmnaRecep>
          <CiudadRecep>SANTIAGO</CiudadRecep>
        </Receptor>
        <Totales>
          <MntNeto>70782</MntNeto>
          <MntExe>0</MntExe>
          <TasaIVA>19</TasaIVA>
          <IVA>13448</IVA>
          <ImptoReten>
            <TipoImp>18</TipoImp>
            <TasaImp>5</TasaImp>
            <MontoImp>100</MontoImp>
          </ImptoReten>
          <MntBase>1000</MntBase>
          <MontoNF>0</MontoNF>
          <MontoPeriodo>84330</MontoPeriodo>
          <VlrPagar>84330</VlrPagar>
          <MntTotal>84330</MntTotal>
        </Totales>
      </Encabezado>
      <Detalle>
        <NroLinDet>1</NroLinDet>
        <CdgItem>
          <TpoCodigo>SKUIN</TpoCodigo>
          <VlrCodigo>00110008</VlrCodigo>
        </CdgItem>
        <NmbItem>HARINA &amp; AZUCAR ESPECIAL</NmbItem>
        <DscItem>Saco 25 kg</DscItem>
        <QtyItem>2</QtyItem>
        <UnmdItem>UN</UnmdItem>
        <PrcItem>35931</PrcItem>
        <DescuentoPct>1.5</DescuentoPct>
        <DescuentoMonto>500</DescuentoMonto>
        <RecargoMonto>0</RecargoMonto>
        <IndExe>0</IndExe>
        <CodImpAdic>18</CodImpAdic>
        <MontoItem>71362</MontoItem>
      </Detalle>
      <DscRcgGlobal>
        <NroLinDR>1</NroLinDR>
        <TpoMov>D</TpoMov>
        <GlosaDR>Descuento pronto pago</GlosaDR>
        <TpoValor>$</TpoValor>
        <ValorDR>580</ValorDR>
      </DscRcgGlobal>
      <Referencia>
        <NroLinRef>1</NroLinRef>
        <TpoDocRef>801</TpoDocRef>
        <FolioRef>OC-990</FolioRef>
        <FchRef>2026-10-01</FchRef>
        <CodRef>1</CodRef>
        <RazonRef>Orden de compra</RazonRef>
      </Referencia>
      <TED version="1.0"><DD><CAF version="1.0"><DA><RE>76192083-9</RE></DA></CAF></DD><FRMT algoritmo="SHA1withRSA">SGVsbG8=</FRMT></TED>
    </Documento>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
      <SignatureValue>U2lnbmF0dXJl</SignatureValue>
    </Signature>
  </DTE>
  <DTE version="1.0">
    <Documento ID="F202T33">
      <Encabezado>
        <IdDoc>
          <TipoDTE>33</TipoDTE>
          <Folio>202</Folio>
          <FchEmis>2026-10-06</FchEmis>
        </IdDoc>
        <Emisor>
          <RUTEmisor>77111222-6</RUTEmisor>
          <RznSoc>PROVEEDOR SINTETICO DOS LTDA</RznSoc>
        </Emisor>
        <Receptor>
          <RUTRecep>64000001-5</RUTRecep>
          <RznSocRecep>COMPRADOR DEMO LTDA</RznSocRecep>
        </Receptor>
        <Totales>
          <MntNeto>10000</MntNeto>
          <MntExe>0</MntExe>
          <TasaIVA>19</TasaIVA>
          <IVA>1900</IVA>
          <MntTotal>11900</MntTotal>
        </Totales>
      </Encabezado>
      <Detalle>
        <NroLinDet>1</NroLinDet>
        <NmbItem>SERVICIO MENSUAL</NmbItem>
        <QtyItem>1</QtyItem>
        <PrcItem>10000</PrcItem>
        <MontoItem>10000</MontoItem>
      </Detalle>
    </Documento>
  </DTE>
</SetDTE>`;

describe('parseDteRespaldoXml — wrappers, curación y seguridad (ADR-037)', () => {
  it('parsea SetDTE de compras, preserva ceros a la izquierda en SKU y no expone raw/TED/Signature', () => {
    const res = parseDteRespaldoXml(SET_DTE_COMPRA_XML, 'compra');

    expect(res.side).toBe('compra');
    expect(res.documentos).toHaveLength(2);
    expect(res.contrapartes).toHaveLength(2);

    const doc = res.documentos[0]!;
    expect(doc.tipoDte).toBe('33');
    expect(doc.folio).toBe('101');
    expect(doc.fechaEmision).toBe('2026-10-05');
    expect(doc.mntBruto).toBe(0);
    expect(doc.formaPago).toBe('1');
    expect(doc.medioPago).toBe('OT');
    expect(doc.pagos).toEqual([{ fecha: '2026-11-04', monto: 84230 }]);
    expect(doc.terminosPago).toEqual({ codigo: 'FRF', dias: 30, glosa: 'Contado' });

    // En compras, la contraparte es el emisor (proveedor).
    expect(doc.contraparte.rut).toBe('76192083-9');
    expect(doc.contraparte.razonSocial).toBe('PROVEEDOR SINTETICO UNO SPA');
    expect(doc.receptor.rut).toBe('64000001-5');

    // Línea con código SKU que conserva ceros iniciales y decodifica &amp;.
    expect(doc.lineas).toHaveLength(1);
    expect(doc.lineas[0]).toEqual({
      nroLinDet: 1,
      nombre: 'HARINA & AZUCAR ESPECIAL',
      descripcion: 'Saco 25 kg',
      cantidad: 2,
      unidad: 'UN',
      precioUnitario: 35931,
      descuentoMonto: 500,
      descuentoPorcentaje: 1.5,
      recargoMonto: 0,
      monto: 71362,
      indicacionExento: 0,
      codigoItem: { tipo: 'SKUIN', valor: '00110008' },
      codImpAdic: '18',
    });

    expect(doc.ajustesGlobales).toEqual([
      {
        nroLinDr: 1,
        tipoMovimiento: 'D',
        glosa: 'Descuento pronto pago',
        tipoValor: '$',
        valor: 580,
      },
    ]);
    expect(doc.referencias).toEqual([
      {
        nroLinRef: 1,
        tipoDocRef: '801',
        folioRef: 'OC-990',
        fechaRef: '2026-10-01',
        codigoRef: 1,
        razonRef: 'Orden de compra',
      },
    ]);

    // Sin raw ni bloques criptográficos en la proyección (ADR-004 / ADR-037).
    expect('raw' in (doc as unknown as Record<string, unknown>)).toBe(false);
    expect('TED' in (doc as unknown as Record<string, unknown>)).toBe(false);
    expect('Signature' in (doc as unknown as Record<string, unknown>)).toBe(false);
  });

  it('soporta EnvioDTE y EnvioBOLETA en ventas y asigna al receptor como contraparte', () => {
    const envioDteXml = `<EnvioDTE version="1.0"><SetDTE ID="SetDoc"><DTE version="1.0"><Documento ID="F145T33">
      <Encabezado>
        <IdDoc><TipoDTE>33</TipoDTE><Folio>145</Folio><FchEmis>2026-10-10</FchEmis></IdDoc>
        <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>EMISOR PROPIO SPA</RznSoc></Emisor>
        <Receptor><RUTRecep>64000001-5</RUTRecep><RznSocRecep>CLIENTE FINAL LTDA</RznSocRecep></Receptor>
        <Totales><MntNeto>20000</MntNeto><IVA>3800</IVA><MntTotal>23800</MntTotal></Totales>
      </Encabezado>
      <Detalle><NroLinDet>1</NroLinDet><NmbItem>TORTA</NmbItem><MontoItem>20000</MontoItem></Detalle>
    </Documento></DTE></SetDTE></EnvioDTE>`;

    const envioBoletaXml = `<EnvioBOLETA version="1.0"><SetDTE ID="SetDoc"><DTE version="1.0"><Documento ID="F990T39">
      <Encabezado>
        <IdDoc><TipoDTE>39</TipoDTE><Folio>990</Folio><FchEmis>2026-10-11</FchEmis><MntBruto>1</MntBruto></IdDoc>
        <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSocBoleta>PANADERIA SINTETICA</RznSocBoleta></Emisor>
        <Receptor><RUTRecep>66666666-6</RUTRecep><RznSocRecep>CONSUMIDOR FINAL</RznSocRecep></Receptor>
        <Totales><MntNeto>1000</MntNeto><IVA>190</IVA><MntTotal>1190</MntTotal></Totales>
      </Encabezado>
      <Detalle><NroLinDet>1</NroLinDet><NmbItem>PAN</NmbItem><MontoItem>1190</MontoItem></Detalle>
    </Documento></DTE></SetDTE></EnvioBOLETA>`;

    const rVenta = parseDteRespaldoXml(envioDteXml, 'venta');
    expect(rVenta.documentos).toHaveLength(1);
    expect(rVenta.documentos[0]!.contraparte.rut).toBe('64000001-5');
    expect(rVenta.documentos[0]!.contraparte.razonSocial).toBe('CLIENTE FINAL LTDA');

    const rBoleta = parseDteRespaldoXml(envioBoletaXml, 'venta');
    expect(rBoleta.documentos).toHaveLength(1);
    expect(rBoleta.documentos[0]!.tipoDte).toBe('39');
    expect(rBoleta.documentos[0]!.emisor.razonSocial).toBe('PANADERIA SINTETICA');
  });

  it('no inventa cero cuando los campos opcionales están ausentes', () => {
    const xml = `<DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>2</Folio>
      <FchEmis>2026-07-26</FchEmis></IdDoc><Totales><MntTotal>100</MntTotal></Totales></Encabezado>
      </Documento></DTE>`;
    const doc = parseDteRespaldoXml(xml, 'compra').documentos[0]!;

    expect(doc.mntBruto).toBeUndefined();
    expect(doc.totales.montoNoFacturable).toBeUndefined();
    expect(doc.totales.valorPorPagar).toBeUndefined();
    expect(doc.ajustesGlobales).toEqual([]);
    expect(doc.pagos).toEqual([]);
  });

  it('decodifica Uint8Array en ISO-8859-1 / windows-1252 y repara mojibake en strings', () => {
    // 'PANADERÍA NIÑO' en ISO-8859-1: Í = 0xCD, Ñ = 0xD1
    const latin1Xml =
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<DTE><Documento><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>7</Folio><FchEmis>2026-10-01</FchEmis></IdDoc>' +
      '<Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>PANADER\xCDA NI\xD1O SPA</RznSoc></Emisor>' +
      '<Receptor><RUTRecep>64000001-5</RUTRecep><RznSocRecep>RECEPTOR</RznSocRecep></Receptor>' +
      '<Totales><MntTotal>1000</MntTotal></Totales></Encabezado></Documento></DTE>';
    const bytes = new Uint8Array(Array.from(latin1Xml, (ch) => ch.charCodeAt(0)));

    expect(decodeDteXmlBytes(bytes)).toContain('PANADERÍA NIÑO SPA');
    const fromBytes = parseDteRespaldoXml(bytes, 'compra');
    expect(fromBytes.documentos[0]!.emisor.razonSocial).toBe('PANADERÍA NIÑO SPA');

    // Si alguien decodificó UTF-8 como Latin-1 produciendo mojibake ('PANADERÃ\x8DA'), repairMojibake lo corrige.
    const mojibakeXml = latin1Xml.replace('PANADER\xCDA NI\xD1O SPA', 'PANADERÃ\x8DA NIÃ\x91O SPA');
    const fromMojibake = parseDteRespaldoXml(mojibakeXml, 'compra');
    expect(fromMojibake.documentos[0]!.emisor.razonSocial).toBe('PANADERÍA NIÑO SPA');
  });

  it('bloquea la expansión de entidades DTD (processEntities: false)', () => {
    const xmlWithDtd = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE SetDTE [
  <!ENTITY boom "EXPANDED_SECRET">
]>
<DTE><Documento><Encabezado>
  <IdDoc><TipoDTE>33</TipoDTE><Folio>9</Folio><FchEmis>2026-10-01</FchEmis></IdDoc>
  <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>&boom;</RznSoc></Emisor>
  <Receptor><RUTRecep>64000001-5</RUTRecep><RznSocRecep>CLIENTE</RznSocRecep></Receptor>
  <Totales><MntTotal>100</MntTotal></Totales>
</Encabezado></Documento></DTE>`;

    const doc = parseDteRespaldoXml(xmlWithDtd, 'compra').documentos[0]!;
    expect(doc.emisor.razonSocial).not.toContain('EXPANDED_SECRET');
    expect(doc.emisor.razonSocial).toBe('&boom;');
  });

  it('combina múltiples archivos y deduplica contrapartes por RUT', () => {
    const merged = parseDteRespaldoXmlFiles([
      { xml: SET_DTE_COMPRA_XML, side: 'compra' },
      { xml: SET_DTE_COMPRA_XML, side: 'compra' },
    ]);
    expect(merged.documentos).toHaveLength(4);
    expect(merged.contrapartes).toHaveLength(2);
    expect(uniqueContrapartes(merged.documentos).map((c) => c.rut)).toEqual([
      '76192083-9',
      '77111222-6',
    ]);
  });

  it('audita la cuadratura del total XML y marca impuestos sin clasificar en ventas para revisión', () => {
    const parsed = parseDteRespaldoXml(SET_DTE_COMPRA_XML, 'compra');
    const auditOk = auditDteXmlTotal(parsed.documentos[0]!.totales, 'compra');
    expect(auditOk.status).toBe('cuadra');
    expect(auditOk.delta).toBe(0);

    const dte46Xml = `<DTE><Documento><Encabezado>
      <IdDoc><TipoDTE>46</TipoDTE><Folio>55</Folio><FchEmis>2026-10-12</FchEmis></IdDoc>
      <Emisor><RUTEmisor>76192083-9</RUTEmisor><RznSoc>EMISOR</RznSoc></Emisor>
      <Receptor><RUTRecep>64000001-5</RUTRecep><RznSocRecep>RECEPTOR</RznSocRecep></Receptor>
      <Totales>
        <MntNeto>100000</MntNeto><IVA>19000</IVA>
        <ImptoReten><TipoImp>15</TipoImp><TasaImp>19</TasaImp><MontoImp>19000</MontoImp></ImptoReten>
        <MntTotal>100000</MntTotal>
      </Totales>
    </Encabezado><Detalle><NroLinDet>1</NroLinDet><NmbItem>COMPRA</NmbItem><MontoItem>100000</MontoItem></Detalle></Documento></DTE>`;
    const doc46 = parseDteRespaldoXml(dte46Xml, 'compra').documentos[0]!;
    const auditCompra = auditDteXmlTotal(doc46.totales, 'compra');
    expect(auditCompra.status).toBe('cuadra');
    expect(auditCompra.delta).toBe(0);

    const auditVenta = auditDteXmlTotal(doc46.totales, 'venta');
    expect(auditVenta.status).toBe('requiere_revision');
    expect(auditVenta.unclassifiedTaxCodes).toContain('15');
  });
});

describe('respaldoOrigenToSide', () => {
  it('mapea RCP/ENV (mayúsculas o minúsculas) a compra/venta', () => {
    expect(respaldoOrigenToSide('RCP')).toBe('compra');
    expect(respaldoOrigenToSide('rcp')).toBe('compra');
    expect(respaldoOrigenToSide('ENV')).toBe('venta');
    expect(respaldoOrigenToSide('env')).toBe('venta');
  });
});
