// `sii rcv …` — Registro de Compras y Ventas. Thin calls into @albertomarturelo/sii-core tasks
// (ADR-003). Each domain module owns a `commands/<mod>.ts` exporting a
// `register<Mod>(program, runtime)`; `program.ts` just calls it, so the shared
// command tree stays append-only across parallel modules (RCV sets this pattern).
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  formatMoney as money,
  formatRut as fmtRut,
  rcvBoletasVentaCsv,
  rcvList,
  rcvListAll,
  rcvSummary,
  type RcvSide,
  type Runtime,
} from '@albertomarturelo/sii-core';
import { documentosDir } from '@albertomarturelo/sii-core/node';
import { emit, out } from '../io.js';

const sideOf = (opts: { venta?: boolean }): RcvSide => (opts.venta ? 'VENTA' : 'COMPRA');
// exactOptionalPropertyTypes: only carry `rut` when the override was passed.
const rutOpt = (rut?: string): { rut?: string } => (rut ? { rut } : {});

export function registerRcv(program: Command, runtime: Runtime): void {
  const rcv = program.command('rcv').description('Registro de Compras y Ventas (RCV).');

  rcv
    .command('summary')
    .description('Resumen por tipo de documento para un período (COMPRAS por defecto).')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option('--venta', 'Consulta el registro de VENTAS (por defecto: COMPRAS).')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .action(async (periodo: string, opts: { venta?: boolean; rut?: string }) => {
      const res = await rcvSummary(runtime, { periodo, side: sideOf(opts), ...rutOpt(opts.rut) });
      emit(res, () => {
        out(`RCV ${res.side} ${res.periodo} — ${fmtRut(res.rut)}`);
        if (res.rows.length === 0) {
          out('Sin documentos en el período.');
          return;
        }
        for (const r of res.rows) {
          out(
            `  ${r.codigoTipoDoc ?? '—'}  ${r.descripcion ?? ''}  docs=${r.totalDocumentos ?? '—'}  total=${money(r.montoTotal)}`,
          );
        }
        if (res.totalDocumentos !== null) out(`Total documentos: ${res.totalDocumentos}`);
      });
    });

  rcv
    .command('list')
    .description(
      'Detalle de documentos de un tipo para un período. Es el REGISTRO del SII: todo lo ' +
        'emitido/recibido por cualquier software; para lo emitido vía el Portal MIPYME con su ' +
        'PDF, usa `dte emitidos`.',
    )
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .requiredOption('--tipo <codigo>', 'Código de tipo de documento DTE (ej. 33, 34, 39).')
    .option('--venta', 'Consulta el registro de VENTAS (por defecto: COMPRAS).')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .action(async (periodo: string, opts: { tipo: string; venta?: boolean; rut?: string }) => {
      const res = await rcvList(runtime, {
        periodo,
        side: sideOf(opts),
        codigoTipoDoc: opts.tipo,
        ...rutOpt(opts.rut),
      });
      emit(res, () => {
        out(`RCV ${res.side} ${res.periodo} tipo ${res.codigoTipoDoc} — ${fmtRut(res.rut)}`);
        if (res.docs.length === 0) {
          out('Sin documentos de este tipo en el período.');
          return;
        }
        for (const d of res.docs) {
          const contraparte = d.rutEmisor ? fmtRut(d.rutEmisor) : '—';
          out(
            `  folio=${d.folio ?? '—'}  ${contraparte}  ${d.fechaEmision ?? '—'}  total=${money(d.montoTotal)}`,
          );
        }
        out(`${res.docs.length} documento(s).`);
      });
    });

  rcv
    .command('all')
    .description('Detalle de TODOS los tipos de documento de un período (una sola sesión).')
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option('--venta', 'Consulta el registro de VENTAS (por defecto: COMPRAS).')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .action(async (periodo: string, opts: { venta?: boolean; rut?: string }) => {
      const res = await rcvListAll(runtime, { periodo, side: sideOf(opts), ...rutOpt(opts.rut) });
      emit(res, () => {
        out(`RCV ${res.side} ${res.periodo} — todos los tipos — ${fmtRut(res.rut)}`);
        if (res.docs.length === 0) {
          out('Sin documentos en el período.');
        } else {
          for (const d of res.docs) {
            const contraparte = d.rutEmisor ? fmtRut(d.rutEmisor) : '—';
            out(
              `  tipo=${d.codigoTipoDoc}  folio=${d.folio ?? '—'}  ${contraparte}  ${d.fechaEmision ?? '—'}  total=${money(d.montoTotal)}`,
            );
          }
          out(`${res.docs.length} documento(s).`);
        }
        // A per-type SII rejection doesn't fail the read — surface which types are missing
        // (ADR-004: never hidden), mirroring `f22 historial`'s `⚠ folio …` line.
        if (res.incomplete) {
          out(`⚠ Resultado incompleto — tipos rechazados por SII: ${res.rejectedTypes.join(', ')}`);
        }
      });
    });

  rcv
    .command('boletas-csv')
    .description(
      'Descarga el CSV.gz de boletas electrónicas de VENTA (RCV tipo UI 3941). ' +
        'Cuando getDetalleVenta no entrega filas, esta es la vía oficial del portal.',
    )
    .argument('<periodo>', 'Período tributario (YYYYMM o YYYY-MM).')
    .option('--rut <rut>', 'Operar como una empresa representada (del conjunto operable).')
    .option('--directorio <path>', 'Carpeta destino (default: documentos/rcv bajo $SII_HOME).')
    .option('--sin-solicitar', 'No pedir generación; solo consultar/descargar un job existente.')
    .option('--sin-parsear', 'No parsear filas del CSV (solo descriptor de archivo).')
    .option(
      '--timeout <segundos>',
      'Tiempo máximo de espera al job asíncrono (default 600).',
      (v) => Number(v),
      600,
    )
    .action(
      async (
        periodo: string,
        opts: {
          rut?: string;
          directorio?: string;
          sinSolicitar?: boolean;
          sinParsear?: boolean;
          timeout: number;
        },
      ) => {
        const res = await rcvBoletasVentaCsv(runtime, {
          periodo,
          directorio: opts.directorio ?? join(documentosDir(), 'rcv'),
          ...(opts.rut ? { rut: opts.rut } : {}),
          solicitar: !opts.sinSolicitar,
          parsear: !opts.sinParsear,
          timeoutMs: opts.timeout * 1000,
        });
        emit(res, () => {
          out(`RCV VENTA boletas ${res.periodo} — ${fmtRut(res.rut)}`);
          out(`Archivo: ${res.archivo.path} (${res.archivo.bytes} bytes)`);
          if (res.avisoSii) out(`Aviso SII: ${res.avisoSii}`);
          if (res.totalFilas > 0) {
            for (const d of res.filas.slice(0, 20)) {
              out(
                `  folio=${d.folio ?? '—'}  ${d.rutReceptor ?? '—'}  ${d.fechaEmision ?? '—'}  total=${money(d.montoTotal)}`,
              );
            }
            if (res.filas.length > 20) out(`  … y ${res.filas.length - 20} más (ver JSON).`);
          } else if (!opts.sinParsear) {
            out('Sin filas parseadas en el CSV.');
          }
        });
      },
    );
}
