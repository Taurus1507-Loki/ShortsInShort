import PDFDocument from 'pdfkit';
import { env } from '../../config/env.js';
import { Counter, Invoice, type InvoiceDoc, type PaymentDoc } from '../../models/Billing.js';
import { Workspace } from '../../models/Workspace.js';
import { User } from '../../models/User.js';

/** Indian financial year (April–March) for a date, e.g. 2026-27. Exported for tests. */
export function financialYear(d: Date): string {
  // Invoices follow Indian time: a payment at 23:30 UTC on 31 March is already 1 April in IST.
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** e.g. SIS2627-000001 — GST allows at most 16 characters, unique within the financial year. */
export const invoiceNumber = (prefix: string, fy: string, seq: number) => `${prefix}${fy.slice(2, 4)}${fy.slice(5, 7)}-${String(seq).padStart(6, '0')}`;

/**
 * Splits a payment into taxable value and GST. Same state (or no buyer state, i.e. a consumer
 * without an address) → CGST + SGST; another state → IGST. Rounded so the parts add up exactly.
 * Exported for tests.
 */
export function gstBreakdown(amountPaise: number, opts: { includesGst: boolean; ratePercent: number; sellerState: string; buyerState?: string | null }) {
  const r = opts.ratePercent / 100;
  const taxable = opts.includesGst ? Math.round(amountPaise / (1 + r)) : amountPaise;
  const tax = opts.includesGst ? amountPaise - taxable : Math.round(amountPaise * r);
  const interState = Boolean(opts.buyerState) && opts.buyerState !== opts.sellerState;
  const cgst = interState ? 0 : Math.floor(tax / 2);
  const sgst = interState ? 0 : tax - cgst;
  return { taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: interState ? tax : 0, totalPaise: taxable + tax, placeOfSupply: opts.buyerState || opts.sellerState };
}

async function nextSeq(fy: string): Promise<number> {
  const c = await Counter.findOneAndUpdate({ key: `invoice:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
}

/** Issues the invoice for a paid payment (once — a second call returns the same invoice). */
export async function issueInvoice(payment: PaymentDoc, description: string): Promise<InvoiceDoc> {
  const existing = await Invoice.findOne({ paymentId: payment._id });
  if (existing) return existing;
  const ws = await Workspace.findById(payment.workspaceId).lean();
  const user = payment.userId ? await User.findById(payment.userId).select('fullName email').lean() : null;
  const b = env.billing;
  const buyerState = ws?.billing?.stateCode || null;
  const split = gstBreakdown(payment.amountPaise, { includesGst: b.pricesIncludeGst, ratePercent: b.gstRate, sellerState: b.stateCode, buyerState });
  const issuedAt = payment.paidAt ?? new Date();
  const fy = financialYear(issuedAt);
  const seq = await nextSeq(fy);
  try {
    return await Invoice.create({
      number: invoiceNumber(b.invoicePrefix, fy, seq),
      financialYear: fy,
      workspaceId: payment.workspaceId,
      paymentId: payment._id,
      providerPaymentId: payment.paymentId,
      issuedAt,
      seller: { legalName: b.legalName, gstin: b.gstin, address: b.address, stateCode: b.stateCode },
      buyer: { name: ws?.billing?.legalName || user?.fullName || '', email: user?.email ?? '', gstin: ws?.billing?.gstin ?? '', address: ws?.billing?.address ?? '', stateCode: buyerState ?? '' },
      sac: b.sac,
      lines: [{ description, quantity: 1, amountPaise: split.taxablePaise }],
      ...split,
      gstRate: b.gstRate,
    });
  } catch (err) {
    // Two deliveries raced: the other one issued it (the number we took stays unused — logged by the caller).
    if ((err as { code?: number }).code === 11000) {
      const again = await Invoice.findOne({ paymentId: payment._id });
      if (again) return again;
    }
    throw err;
  }
}

const inr = (paise: number) => `INR ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};
export const stateName = (code: string) => (STATE_NAMES[code] ? `${STATE_NAMES[code]} (${code})` : code);

/** Renders the invoice as a PDF (built from the stored record, so it never changes after issue). */
export function invoicePdf(inv: InvoiceDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Tax Invoice ${inv.number}`, Author: inv.seller?.legalName ?? '' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('TAX INVOICE', { align: 'right' });
    doc.font('Helvetica').fontSize(10).text(`Invoice no: ${inv.number}`, { align: 'right' }).text(`Date: ${inv.issuedAt.toISOString().slice(0, 10)}`, { align: 'right' });
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text(inv.seller?.legalName || 'ShortsInShort');
    doc.font('Helvetica').fontSize(9);
    if (inv.seller?.address) doc.text(inv.seller.address);
    if (inv.seller?.gstin) doc.text(`GSTIN: ${inv.seller.gstin}`);
    doc.text(`State: ${stateName(inv.seller?.stateCode ?? '')}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(10).text('Bill to');
    doc.font('Helvetica').fontSize(9).text(inv.buyer?.name || '—');
    if (inv.buyer?.email) doc.text(inv.buyer.email);
    if (inv.buyer?.address) doc.text(inv.buyer.address);
    if (inv.buyer?.gstin) doc.text(`GSTIN: ${inv.buyer.gstin}`);
    doc.text(`Place of supply: ${stateName(inv.placeOfSupply)}`);
    doc.moveDown(1.5);

    const top = doc.y;
    const col = { desc: 50, sac: 330, amt: 430 };
    doc.font('Helvetica-Bold').fontSize(9).text('Description', col.desc, top).text('SAC', col.sac, top).text('Taxable value', col.amt, top, { width: 115, align: 'right' });
    doc.moveTo(50, top + 14).lineTo(545, top + 14).stroke('#cccccc');
    let y = top + 22;
    doc.font('Helvetica');
    for (const l of inv.lines) {
      doc.text(l.description ?? '', col.desc, y, { width: 270 }).text(inv.sac, col.sac, y).text(inr(l.amountPaise ?? 0), col.amt, y, { width: 115, align: 'right' });
      y += 20;
    }
    doc.moveTo(50, y).lineTo(545, y).stroke('#cccccc');
    y += 10;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 300, y, { width: 125 }).text(value, col.amt, y, { width: 115, align: 'right' });
      y += 16;
    };
    row('Taxable value', inr(inv.taxablePaise));
    if (inv.igstPaise) row(`IGST @ ${inv.gstRate}%`, inr(inv.igstPaise));
    else {
      row(`CGST @ ${inv.gstRate / 2}%`, inr(inv.cgstPaise));
      row(`SGST @ ${inv.gstRate / 2}%`, inr(inv.sgstPaise));
    }
    row('Total', inr(inv.totalPaise), true);
    doc.moveDown(3);
    doc.font('Helvetica').fontSize(8).fillColor('#666666').text(`Paid online via Razorpay${inv.providerPaymentId ? ` (payment ${inv.providerPaymentId})` : ''}. This is a computer-generated invoice and needs no signature.`, 50, y + 30, { width: 495 });
    doc.end();
  });
}

