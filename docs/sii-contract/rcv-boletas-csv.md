# Wire contract — RCV boletas electrónicas venta (CSV gzip, async)

Surface: `fetchRcvCtrlAsync`, `fetchRcvArchivoBlob` in `packages/core/src/portal/rcv-async.ts`;
task `rcvBoletasVentaCsv`. First observed from the `consdcvinternetui` Angular bundle
(www4.sii.cl, 2026-11) and a live recorder session (tipo UI **3941**, filas CSV tipo **39**).

## Context

Para varias empresas, `getDetalleVenta` con `codTipoDoc` **39** no entrega filas (código **99** en
export síncrono), pero el portal ofrece **«Descargar Boletas electrónicas»**, que genera un job
asíncrono y entrega un **`.csv.gz`**.

## Endpoints

| op | método | path (bajo `https://www4.sii.cl`) |
| --- | --- | --- |
| control async | POST | `…/consdcvinternetui/services/data/facadeService/getCtrlAsync` |
| archivo | GET | `…/consdcvinternetui/services/data/facadeService/obtenerArchivoBLOB/{caIdBLOB}/{usuarioSesion}/{rutEmisorBody}/{caId}` |

Namespace `getCtrlAsync`: `cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getCtrlAsync`.

Headers POST: mismos que [rcv.md](./rcv.md). GET binario: `Referer` + cookies de sesión.

### Body `getCtrlAsync`

```json
{
  "metaData": { "namespace": "…/getCtrlAsync", "conversationId": "<TOKEN>", "transactionId": "<uuid>", "page": null },
  "data": {
    "rutEmisor": "<body>",
    "dvEmisor": "<dv>",
    "ptributario": "<YYYYMM>",
    "codTipoDoc": "3941",
    "generaCtrl": true,
    "operacion": "VENTA",
    "estadoContab": "REGISTRO",
    "totDoc": 0,
    "accionRecaptcha": "RCV_DBEA",
    "tokenRecaptcha": "t-o-k-e-n-web"
  }
}
```

`generaCtrl: false` consulta el estado sin solicitar uno nuevo. Body-RUT (ADR-005) como el resto del RCV.

### Respuesta job

Filas en `data[]` con al menos: `caEstado` (`CREADO` | `EN PROCESO` | `TERMINADO`), `caIdBLOB`,
`caId`, `caPeriodo`, `compraOVenta` (`C` compra, otro venta). `respEstado.codRespuesta`:
`0` ok; `1` ok con mensaje informativo; `99` sin documentos; `98` reCAPTCHA.

### CSV

Separador `;`, gzip. Cabecera observada:

`Tipo Doc;RUT Receptor;Fecha Docto;…;Folio;Monto Neto;Monto IVA;Monto Exento;Monto Total`

## Task output (typed)

`RcvBoletasCsvResult`: `DocumentoRcvCsv` + `filas: RcvBoletaCsvRow[]` + `avisoSii` + `job`.