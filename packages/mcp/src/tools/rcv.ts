// `rcv_*` MCP tools — Registro de Compras y Ventas. Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003), read-only. Body-RUT (ADR-005): `rut` selects a represented empresa.
// zod input schemas (ADR-011) — the SDK derives the protocol JSON Schema.
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  rcvBoletasVentaCsv,
  rcvList,
  rcvListAll,
  rcvSummary,
  type RcvSide,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { documentosDir } from '@albertomarturelo/sii-core/node';
import { toolText } from '../tool-helpers.js';

const sideOf = (venta?: boolean): RcvSide => (venta ? 'VENTA' : 'COMPRA');
// exactOptionalPropertyTypes: only carry `rut` when the override was passed.
const rutOpt = (rut?: string): { rut?: string } => (rut ? { rut } : {});

export function registerRcvTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    'rcv_summary',
    {
      title: 'RCV resumen',
      description:
        'Resumen del Registro de Compras y Ventas por tipo de documento, para un período (YYYYMM/YYYY-MM). ' +
        'COMPRAS por defecto; venta=true para VENTAS. Body-RUT: usa rut para una empresa representada.',
      inputSchema: {
        periodo: z.string(),
        venta: z.boolean().optional(),
        rut: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, venta, rut }) =>
      toolText(async () =>
        JSON.stringify(
          await rcvSummary(runtime, { periodo, side: sideOf(venta), ...rutOpt(rut) }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'rcv_list',
    {
      title: 'RCV detalle',
      description:
        'Detalle de documentos de un tipo (codigoTipoDoc, ej. "33") del RCV para un período. ' +
        'Es el REGISTRO del SII (todo lo emitido/recibido por cualquier software); para lo ' +
        'emitido vía el Portal MIPYME con su PDF, usa dte_emitidos. ' +
        'COMPRAS por defecto; venta=true para VENTAS. Body-RUT: usa rut para una empresa representada.',
      inputSchema: {
        periodo: z.string(),
        codigoTipoDoc: z.string(),
        venta: z.boolean().optional(),
        rut: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, codigoTipoDoc, venta, rut }) =>
      toolText(async () =>
        JSON.stringify(
          await rcvList(runtime, { periodo, side: sideOf(venta), codigoTipoDoc, ...rutOpt(rut) }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'rcv_all',
    {
      title: 'RCV detalle — todos los tipos',
      description:
        'Detalle de TODOS los documentos de un período (YYYYMM/YYYY-MM) en una sola consulta: ' +
        'aplana el detalle de cada tipo que reporta el resumen, cada fila con su codigoTipoDoc. ' +
        'COMPRAS por defecto; venta=true para VENTAS. Body-RUT: usa rut para una empresa representada. ' +
        'Si SII rechaza un tipo puntual, incomplete=true y rejectedTypes lista los códigos omitidos (el resto igual vuelve).',
      inputSchema: {
        periodo: z.string(),
        venta: z.boolean().optional(),
        rut: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, venta, rut }) =>
      toolText(async () =>
        JSON.stringify(
          await rcvListAll(runtime, { periodo, side: sideOf(venta), ...rutOpt(rut) }),
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'rcv_boletas_csv',
    {
      title: 'RCV boletas venta (CSV gzip)',
      description:
        'Descarga el detalle de boletas electrónicas de VENTA como CSV comprimido (.csv.gz), ' +
        'vía el job asíncrono del portal (tipo UI 3941). Devuelve descriptor de archivo, filas ' +
        'tipadas parseadas y avisos de SII. Body-RUT: usa rut para una empresa representada. ' +
        'Usa parsear=false para omitir filas (menos PII en el transcript).',
      inputSchema: {
        periodo: z.string(),
        rut: z.string().optional(),
        directorio: z.string().optional(),
        solicitar: z.boolean().optional(),
        parsear: z.boolean().optional(),
        timeoutSegundos: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo, rut, directorio, solicitar, parsear, timeoutSegundos }) =>
      toolText(async () =>
        JSON.stringify(
          await rcvBoletasVentaCsv(runtime, {
            periodo,
            directorio: directorio ?? join(documentosDir(), 'rcv'),
            ...(rut ? { rut } : {}),
            ...(solicitar !== undefined ? { solicitar } : {}),
            ...(parsear !== undefined ? { parsear } : {}),
            ...(timeoutSegundos !== undefined ? { timeoutMs: timeoutSegundos * 1000 } : {}),
          }),
          null,
          2,
        ),
      ),
  );
}
