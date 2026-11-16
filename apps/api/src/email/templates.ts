import type { Money } from '@ota/suppliers';
import { EMAIL_STRINGS as S } from './email-strings.js';

// Pure renderers: data in, { subject, html, text } out. Inline styles only (email clients strip
// <style>). Names are the only personal data in an email — never DOB or document numbers.

export interface EmailSegment {
  flight: string;
  from: string;
  to: string;
  /** Airport-local "YYYY-MM-DDTHH:mm:ss" (formatted here without any timezone shift). */
  departureAt: string;
  arrivalAt: string;
}

export interface EmailBookingData {
  brand: string;
  reference: string;
  pnr: string | null;
  demo: boolean;
  /** Contact given name (greeting). */
  contactName: string;
  segments: EmailSegment[];
  /** "Mr Jane Doe". */
  passengers: string[];
  /** "1 × 23kg checked bag", "Seat 14C", "Travel Protection (Demo)". */
  extras: string[];
  /** Charge currency (what the customer paid). */
  total: Money;
}

export type RefundReasonCode = keyof typeof S.refundInitiated.intro;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderBookingConfirmed(d: EmailBookingData): RenderedEmail {
  const rows: Array<[string, string]> = [[S.reference, d.reference], ...(d.pnr ? [[S.pnr, d.pnr] as [string, string]] : [])];
  const sections = [
    keyValues(rows),
    list(S.flights, d.segments.map(segmentLine)),
    list(S.passengers, d.passengers),
    ...(d.extras.length ? [list(S.extras, d.extras)] : []),
    keyValues([[S.totalPaid, formatMoney(d.total)]]),
  ];
  return compose(d, S.confirmed.subject(d.brand, d.reference), S.confirmed.heading, S.confirmed.intro, sections);
}

export function renderRefundInitiated(d: EmailBookingData, refund: { amount: Money; reason: RefundReasonCode }): RenderedEmail {
  const sections = [
    keyValues([[S.reference, d.reference], [S.refundAmount, formatMoney(refund.amount)]]),
    { html: p(S.refundInitiated.timing), text: S.refundInitiated.timing },
    list(S.flights, d.segments.map(segmentLine)),
  ];
  return compose(d, S.refundInitiated.subject(d.brand, d.reference), S.refundInitiated.heading, S.refundInitiated.intro[refund.reason], sections);
}

export function renderRefundCompleted(d: EmailBookingData, refund: { amount: Money }): RenderedEmail {
  const sections = [keyValues([[S.reference, d.reference], [S.refundAmount, formatMoney(refund.amount)]])];
  return compose(d, S.refundCompleted.subject(d.brand, d.reference), S.refundCompleted.heading, S.refundCompleted.intro, sections);
}

// ---------------------------------------------------------------------------------------------

interface Section {
  html: string;
  text: string;
}

function compose(d: EmailBookingData, subject: string, heading: string, intro: string, sections: Section[]): RenderedEmail {
  const demo = d.demo ? { html: `<p style="margin:0 0 16px;padding:12px;background:#fff4e5;border:1px solid #f0b46b;border-radius:6px;color:#663c00;font-size:14px">${esc(S.demoNote)}</p>`, text: `*** ${S.demoNote} ***` } : null;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f8">
<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.5">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#0b5cad">${esc(d.brand)}</p>
<div style="background:#ffffff;border-radius:8px;padding:24px">
${demo?.html ?? ''}<h1 style="margin:0 0 12px;font-size:22px">${esc(heading)}</h1>
${p(S.greeting(d.contactName))}${p(intro)}
${sections.map((s) => s.html).join('\n')}
${p(S.signOff(d.brand))}
</div>
<p style="margin:16px 0 0;font-size:12px;color:#6b7785">${esc(S.footer(d.brand))}</p>
</div></body></html>`;
  const text = [
    ...(demo ? [demo.text, ''] : []),
    heading,
    '',
    S.greeting(d.contactName),
    intro,
    '',
    ...sections.flatMap((s) => [s.text, '']),
    S.signOff(d.brand),
    '',
    S.footer(d.brand),
  ].join('\n');
  return { subject, html, text };
}

function keyValues(rows: Array<[string, string]>): Section {
  return {
    html: `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">${rows
      .map(([k, v]) => `<tr><td style="padding:4px 0;color:#6b7785">${esc(k)}</td><td style="padding:4px 0;text-align:right;font-weight:bold">${esc(v)}</td></tr>`)
      .join('')}</table>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

function list(title: string, items: string[]): Section {
  return {
    html: `<h2 style="margin:16px 0 8px;font-size:16px">${esc(title)}</h2><ul style="margin:0 0 16px;padding-left:20px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`,
    text: [title, ...items.map((i) => `- ${i}`)].join('\n'),
  };
}

function p(text: string): string {
  return `<p style="margin:0 0 12px">${esc(text)}</p>`;
}

function segmentLine(s: EmailSegment): string {
  return `${s.flight}  ${s.from} ${localDateTime(s.departureAt)} → ${s.to} ${localTime(s.arrivalAt)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-12-16T09:05:00" → "16 Dec 2026 09:05" — string parts only, never Date (no timezone shift). */
export function localDateTime(local: string): string {
  const [date, time = ''] = local.split('T');
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y} ${time.slice(0, 5)}`;
}

function localTime(local: string): string {
  return local.split('T')[1]?.slice(0, 5) ?? '';
}

/** { amount: "12767.60", currency: "INR" } → "₹12,767.60" (Intl formats the decimal string exactly). */
export function formatMoney(m: Money): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: m.currency }).format(m.amount as Intl.StringNumericLiteral);
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
