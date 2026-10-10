import 'server-only';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Messages } from '@/i18n/messages/fr';
import { formatEuro, formatMinutes, priceForRecipient } from '@/modules/interventions/pricing';
import type { Q } from './db';
import { readStored } from './storage';

/** Rapport d'intervention en PDF, à partir d'une version validée (montants figés, jamais recalculés ici). */
export async function renderReportPdf(q: Q, versionId: string, t: Messages): Promise<Uint8Array | null> {
  const r = (
    await q<{
      version: number; done_text: string | null; todo_text: string | null; remarks: string | null; pricing_mode: string;
      billable_minutes: number | null; presence_minutes: number | null; amount_excl_cents: number | null; amount_incl_cents: number | null;
      signature_path: string | null; no_signature_reason: string | null; validated_at: string; language: string;
      visit_id: string; scheduled_at: string | null; case_id: string; client_name: string; site_address: string | null; payer: 'principal' | 'client' | 'other';
      type_name: string; principal_name: string | null; tickets: string | null;
      company_name: string | null; org_name: string; address: string | null; phone: string | null; email: string | null; vat_number: string | null;
      iban: string | null; payment_terms: string | null; timezone: string; logo_path: string | null;
    }>(
      `select rv.*, v.scheduled_at, v.case_id, c.name as client_name, sc.site_address, sc.payer, it.name as type_name, p.name as principal_name,
              (select string_agg(number, ', ') from case_references where case_id = sc.id) as tickets,
              o.company_name, o.name as org_name, o.address, o.phone, o.email, o.vat_number, o.iban, o.payment_terms, o.timezone, o.logo_path
       from report_versions rv join service_visits v on v.id = rv.visit_id join service_cases sc on sc.id = v.case_id
       join clients c on c.id = sc.client_id join intervention_types it on it.id = sc.type_id left join principals p on p.id = sc.principal_id
       join organizations o on o.id = rv.organization_id
       where rv.id = $1 and rv.status = 'validated'`,
      [versionId],
    )
  ).rows[0];
  if (!r) return null;
  const workers = (
    await q<{ name: string | null; arrived_at: string | null; left_at: string | null; break_minutes: number }>(
      `select coalesce(pr.full_name, pr.email) as name, w.arrived_at, w.left_at, w.break_minutes from visit_workers w left join profiles pr on pr.id = w.user_id where w.visit_id = $1`,
      [r.visit_id],
    )
  ).rows;
  const needs = (
    await q<{ designation: string; reference: string | null; quantity: number }>(
      `select designation, reference, quantity from part_needs where case_id = $1 and cancelled_at is null order by created_at`,
      [r.case_id],
    )
  ).rows;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const locale = r.language === 'nl' ? 'nl-BE' : 'fr-BE';
  const dt = (d: string | null, withTime = true) =>
    d ? new Intl.DateTimeFormat(locale, { timeZone: r.timezone, day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(d)) : '—';

  let page = doc.addPage([595, 842]);
  let y = 800;
  const M = 50;
  const W = 495;
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.28, 0.33, 0.4);
  const accent = rgb(0.09, 0.29, 0.66);

  // pdf-lib (polices standard) ne connaît que WinAnsi : on remplace les caractères hors jeu.
  const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/—|–/g, '-').replace(/[^\x00-\xFF€]/g, '?');
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    for (const para of safe(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  };
  const ensure = (h: number) => {
    if (y - h < 60) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
  };
  const text = (s: string, opts: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 10;
    for (const line of wrap(s, f, size, opts.width ?? W)) {
      ensure(size + 4);
      page.drawText(line, { x: opts.x ?? M, y, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
  };
  const section = (title: string, color = accent) => {
    y -= 8;
    ensure(30);
    page.drawText(safe(title.toUpperCase()), { x: M, y, size: 9, font: bold, color });
    y -= 14;
  };
  const drawRule = (p: PDFPage) => p.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: rgb(0.89, 0.91, 0.93) });

  // En-tête : logo et identité de l'entreprise.
  if (r.logo_path) {
    try {
      const bytes = await readStored(r.logo_path);
      const img = r.logo_path.endsWith('.png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const h = 40;
      const w = Math.min((img.width / img.height) * h, 160);
      page.drawImage(img, { x: M + W - w, y: y - h + 14, width: w, height: h });
    } catch {
      // Logo illisible : on continue sans.
    }
  }
  text(r.company_name || r.org_name, { f: bold, size: 14 });
  text([r.address, r.phone, r.email].filter(Boolean).join(' · '), { size: 9, color: muted });
  text([r.vat_number && `${t.pdf.vatNumber} ${r.vat_number}`, r.iban && `IBAN ${r.iban}`].filter(Boolean).join(' · '), { size: 9, color: muted });
  y -= 4;
  drawRule(page);
  y -= 22;
  text(t.pdf.title, { f: bold, size: 18 });
  text(
    [`${t.pdf.case} ${r.case_id.slice(0, 8).toUpperCase()}`, r.tickets && `Ticket ${r.tickets}`, `${t.pdf.version} ${r.version}`, r.type_name, r.principal_name].filter(Boolean).join(' · '),
    { size: 10, color: muted },
  );
  y -= 6;
  text(`${t.pdf.client} : ${r.client_name}`);
  if (r.site_address) text(`${t.pdf.site} : ${r.site_address}`);
  text(`${t.pdf.visitOn} ${dt(r.scheduled_at)}`);

  section(t.pdf.arrival + ' / ' + t.pdf.departure);
  for (const w of workers) text(`${w.name ?? '—'} : ${dt(w.arrived_at)} - ${dt(w.left_at)}${w.break_minutes ? ` (-${w.break_minutes} min)` : ''}`);
  if (r.billable_minutes !== null && r.pricing_mode === 'hourly') text(`${t.pdf.billable} : ${formatMinutes(r.billable_minutes)}`);

  if (r.done_text) {
    section(t.visit.done, rgb(0.02, 0.46, 0.28));
    text(r.done_text);
  }
  if (needs.length) {
    section(t.visit.toOrder, rgb(0.71, 0.28, 0.03));
    for (const n of needs) text(`- ${n.designation}${n.reference ? ` (${n.reference})` : ''} x ${n.quantity}`);
  }
  if (r.todo_text) {
    section(t.visit.todo);
    text(r.todo_text);
  }
  if (r.remarks) {
    section(t.visit.remarks);
    text(r.remarks);
  }

  // Prix : le document générique montre le montant adapté au payeur (R02).
  const shown = priceForRecipient(
    { presenceMinutes: r.presence_minutes ?? 0, billableMinutes: r.billable_minutes ?? 0, amountExclCents: r.amount_excl_cents, amountInclCents: r.amount_incl_cents },
    r.payer === 'client' ? 'client' : 'principal',
    r.payer,
  );
  if (shown) {
    section(t.visit.pricing);
    text(`${shown.label === 'excl' ? t.pdf.amountExcl : t.pdf.amountIncl} : ${formatEuro(shown.cents, locale)}`, { f: bold, size: 12 });
    if (r.payment_terms) text(r.payment_terms, { size: 9, color: muted });
  }

  section(t.pdf.signature);
  if (r.signature_path) {
    try {
      const png = await doc.embedPng(await readStored(r.signature_path));
      const h = 70;
      const w = (png.width / png.height) * h;
      ensure(h + 10);
      page.drawImage(png, { x: M, y: y - h + 10, width: Math.min(w, 250), height: h });
      y -= h + 4;
    } catch {
      text('—');
    }
  } else {
    text(`${t.pdf.noSignature} : ${r.no_signature_reason ?? '—'}`);
  }
  text(dt(r.validated_at), { size: 9, color: muted });

  y -= 10;
  text(t.pdf.notInvoice, { size: 8, color: muted });
  return doc.save();
}
