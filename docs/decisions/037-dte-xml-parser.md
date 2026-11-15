# ADR-037: Curated DTE XML parser in `@albertomarturelo/sii-core` (`fast-xml-parser`, hardened, ISO-8859-1/cp1252-aware)

## Status

Accepted — 2026-11-15. Builds on ADR-004 (curated projections, no `raw` for PII-dense artifacts),
ADR-006 (privacy and secret/PII boundaries), ADR-016 (pure main barrel), ADR-022 (binary document
download seam).

## Context

`dteXml` (#169) downloads signed `<SetDTE>` / `<EnvioDTE>` XML bundles from the Portal MIPYME
Respaldo de archivos flow (`lista_documentos.cgi` -> `download.cgi?DOWNLOAD=XML`) and writes the
undecoded `ISO-8859-1` bytes to disk via `FileSink`. Downstream consumers (reconciling RCV totals
against line-level detail, extracting supplier/customer counterparties, or auditing additional and
withheld taxes per line) need a pure, deterministic parser in `@albertomarturelo/sii-core` that
turns those XML bundles into a curated TypeScript structure without weakening the privacy or
runtime-purity guarantees of the core package:

1. **Pure main barrel (ADR-016).** Any parser dependency in `@albertomarturelo/sii-core` must be
   pure JavaScript with zero Node-only or native addons, so the main barrel stays embeddable in
   non-Node runtimes.
2. **Untrusted third-party XML.** Received DTEs (`ORIGEN=RCP`) originate from external issuers.
   Entity expansion (`<!ENTITY ...>`, Billion Laughs) or external DTD processing must be disabled
   unconditionally.
3. **Wire encoding (`ISO-8859-1` / Windows-1252) and mojibake.** `download.cgi` serves raw
   `ISO-8859-1` / Windows-1252 bytes (`<?xml version="1.0" encoding="ISO-8859-1"?>`), and some
   issuers double-encode UTF-8 strings before signing. The parser must accept both `Uint8Array`
   (raw bytes from disk or `fetchDteXml`) and `string`, decode `Uint8Array` with
   `TextDecoder('windows-1252')` (which covers `ISO-8859-1` plus `0x80..0x9F`), and apply
   `repairMojibake` to extracted text fields.
4. **Future `xmldsig` / C14N verification.** XML canonicalization (C14N) and RSA-SHA1 signature
   verification over `<Documento>` and `<TED>` require the original byte stream and whitespace. A
   non-validating tree parser cannot re-serialize a signed node for C14N.
5. **PII boundary (ADR-004 / ADR-006).** A DTE XML contains both parties' RUTs, legal names,
   addresses, line items, and cryptographic signatures (`<TED>` / `<Signature>`). The parsed
   model must be a curated projection with no `raw` bag and no `<TED>` / `<Signature>` blobs.

## Decision

- **Adopt `fast-xml-parser` (`^5.11.2`) in `@albertomarturelo/sii-core`, hardened.**
  - Pure JavaScript, zero native dependencies, compatible with the pure main barrel (ADR-016).
  - Configured with `processEntities: false` so DTD and entity expansion are disabled on all
    inputs, `parseTagValue: false` so numeric codes, RUTs, and leading-zero folios/SKUs are never
    silently coerced by the XML tokenizer, and explicit `isArray` for repeatable DTE tags (`DTE`,
    `Detalle`, `Referencia`, `ImptoReten`, `CdgItem`, `DscRcgGlobal`, `MntPagos`).
- **Accept `string | Uint8Array` and repair double-encoded text.**
  - `decodeDteXmlBytes(input: string | Uint8Array)` decodes `Uint8Array` with
    `new TextDecoder('windows-1252')` and passes every extracted human-readable string (`razonSocial`,
    `giro`, `direccion`, `comuna`, `ciudad`, `nombre`, `descripcion`, `glosa`, `razonRef`,
    `terminosPago.glosa`) through `repairMojibake`.
- **Keep C14N / `xmldsig` separate from the projection parser.**
  - `dteXml` writes the undecoded `ISO-8859-1` bytes to disk via `FileSink`. `fast-xml-parser` is
    used exclusively to build the curated read projection (`DteXmlParseResult`); any future
    `xmldsig` / `<TED>` verifier will read the raw `Uint8Array` directly rather than re-serializing
    the parsed object tree.
- **Curated projection only — no `raw`, no `<TED>` / `<Signature>`.**
  - `parseDteRespaldoXml` and `parseDteRespaldoXmlFiles` return `DteXmlParseResult` (`side`,
    `documentos`, and `contrapartes` deduplicated by canonical Mod-11 RUT), with optional fields
    omitted when absent in the XML (never synthesized as `0`) and `auditDteXmlTotal` to check
    `MntTotal` against its fiscal components (`MntNeto`, `MntExe`, `IVA`, `ImptoReten`, withheld
    IVA in purchases, `CredEC`, `GrntDep`, and commissions).

## Alternatives Considered

1. **Regex / bespoke state-machine parser.** Rejected: DTE XMLs nest repeatable blocks (`Detalle`,
   `ImptoReten`, `DscRcgGlobal`, `Referencia`, `MntPagos`) across multiple wrapper envelopes
   (`<SetDTE>`, `<EnvioDTE>`, `<EnvioBOLETA>`, standalone `<DTE>`); regex extraction is brittle on
   nested optional tags.
2. **DOMParser / `@xmldom/xmldom` or `libxmljs`.** Rejected: native bindings violate ADR-016, and a
   full W3C DOM is unnecessary until C14N signature verification is in scope.
3. **Include `raw` or `<TED>` / `<Signature>` in `DteXmlDocumento`.** Rejected: violates ADR-004
   and ADR-006 by leaking dense PII and cryptographic payloads into downstream JSON outputs.
