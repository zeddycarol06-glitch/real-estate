/* Shared rent-receipt builder, used by the public pay-rent page and the tenant
   portal. A receipt is built as a single self-contained document: the markup
   and its own scoped stylesheet travel together, so the copy shown on screen
   and the copy downloaded or printed render identically.

   A receipt is only ever built for a payment that has actually been received.
   Callers decide when a payment counts as received; this module never invents
   a receipt for a pending STK request. */
(() => {
    'use strict';

    if (window.EstateProRentReceipt) {
        return;
    }

    const numberFormatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
    const dateTimeFormatter = new Intl.DateTimeFormat('en-KE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const formatCurrency = (value) => `KSh ${numberFormatter.format(Math.max(0, Number(value) || 0))}`;

    const formatDateTime = (value) => {
        const date = value instanceof Date ? value : new Date(value);

        return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    /* The receipt number is the system receipt, falling back to the provider
       reference when a record predates receipt numbering. */
    const receiptNumberFor = (payment) => payment?.receiptNumber || payment?.reference || '—';

    const fileNameFor = (payment) => {
        const base = String(receiptNumberFor(payment)).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');

        return `EstatePro-receipt-${base || payment?.id || 'payment'}.html`;
    };

    const style = `
.ep-receipt {
    --ep-ink: #172b27;
    --ep-ink-deep: #0c1c19;
    --ep-muted: #6c7c76;
    --ep-line: #dfe7e0;
    --ep-accent: #b9e66b;
    --ep-soft: #edf2ed;
    --ep-red: #b65c5c;
    --ep-green: #5e9639;
    color: var(--ep-ink);
    font-family: "DM Sans", "Segoe UI", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
}
.ep-receipt * {
    box-sizing: border-box;
}
.ep-receipt-doc {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 30px 32px 34px;
    background: #ffffff;
}
.ep-receipt-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 20px;
    border-bottom: 2px solid var(--ep-ink-deep);
}
.ep-receipt-logo {
    color: var(--ep-ink-deep);
    font-family: "Space Grotesk", "DM Sans", Arial, sans-serif;
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: -0.02em;
}
.ep-receipt-logo span {
    color: var(--ep-green);
}
.ep-receipt-tag {
    margin: 4px 0 0;
    color: var(--ep-muted);
    font-size: 0.74rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.ep-receipt-title {
    text-align: right;
}
.ep-receipt-kicker {
    margin: 0;
    color: var(--ep-green);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
}
.ep-receipt-title h1 {
    margin: 4px 0 6px;
    color: var(--ep-ink-deep);
    font-family: "Space Grotesk", "DM Sans", Arial, sans-serif;
    font-size: 1.35rem;
}
.ep-receipt-number {
    margin: 0;
    color: var(--ep-muted);
    font-size: 0.8rem;
}
.ep-receipt-number strong {
    color: var(--ep-ink-deep);
    font-family: "Space Grotesk", "DM Sans", Arial, sans-serif;
}
.ep-receipt-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px 22px;
    margin: 22px 0;
}
.ep-receipt-grid dt {
    margin: 0 0 2px;
    color: var(--ep-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}
.ep-receipt-grid dd {
    margin: 0;
    color: var(--ep-ink-deep);
    font-weight: 600;
    overflow-wrap: anywhere;
}
.ep-receipt-lines {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6px;
}
.ep-receipt-lines th,
.ep-receipt-lines td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--ep-line);
    text-align: left;
}
.ep-receipt-lines thead th {
    border-bottom: 1px solid var(--ep-ink-deep);
    color: var(--ep-muted);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}
.ep-receipt-lines .ep-receipt-amount {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.ep-receipt-lines tfoot td {
    border-bottom: none;
    padding-top: 14px;
    font-weight: 700;
}
.ep-receipt-lines .ep-receipt-balance td {
    border-top: 2px solid var(--ep-ink-deep);
    color: var(--ep-ink-deep);
    font-size: 1rem;
}
.ep-receipt-lines .ep-receipt-balance.is-due td {
    color: var(--ep-red);
}
.ep-receipt-lines .ep-receipt-balance.is-settled td {
    color: var(--ep-green);
}
.ep-receipt-status {
    display: inline-block;
    margin: 18px 0 0;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.ep-receipt-status.is-settled {
    background: var(--ep-soft);
    color: var(--ep-green);
}
.ep-receipt-status.is-due {
    background: #fdeae8;
    color: var(--ep-red);
}
.ep-receipt-foot {
    margin-top: 26px;
    padding-top: 16px;
    border-top: 1px solid var(--ep-line);
    color: var(--ep-muted);
    font-size: 0.74rem;
}
.ep-receipt-foot p {
    margin: 0 0 6px;
}
.ep-receipt-foot p:last-child {
    margin-bottom: 0;
}
@media print {
    .ep-receipt-doc {
        max-width: none;
        padding: 0;
    }
}
`;

    /* Builds the receipt as a detached element. `payment` is the recorded
       payment; `paidTo` is the M-Pesa number rent was received on and
       `payerPhone` is the number the tenant paid from. */
    const build = ({ payment, tenant = {}, property = {}, monthlyRent = 0, paidTo = '' } = {}) => {
        const safePayment = payment || {};
        const receiptNumber = receiptNumberFor(safePayment);
        const periodRent = Math.max(0, Number(safePayment.amount) || Number(monthlyRent) || 0);
        const periodPaid = Math.max(0, Number(safePayment.periodPaid ?? safePayment.paidAmount) || 0);
        const periodOutstanding = Math.max(0, Number(
            safePayment.periodOutstanding ?? Math.max(0, periodRent - periodPaid)
        ) || 0);
        const settled = periodOutstanding <= 0;
        const balanceLabel = settled ? `Balance for ${safePayment.period}` : `Still owed for ${safePayment.period}`;
        const paidOn = safePayment.paidOn ? formatDateTime(safePayment.paidOn) : '—';
        const issuedAt = formatDateTime(new Date());
        const payerNumber = safePayment.payerPhone || safePayment.tenantPhone || '';

        const row = (label, value) => `
                <tr>
                    <td>${escapeHtml(label)}</td>
                    <td class="ep-receipt-amount">${escapeHtml(value)}</td>
                </tr>`;

        const field = (label, value) => `
            <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
            </div>`;

        const wrapper = document.createElement('div');

        wrapper.className = 'ep-receipt';

        const styleNode = document.createElement('style');

        styleNode.textContent = style;
        wrapper.append(styleNode);

        const doc = document.createElement('div');

        doc.className = 'ep-receipt-doc';
        doc.innerHTML = `
            <header class="ep-receipt-head">
                <div>
                    <span class="ep-receipt-logo">Estate<span>Pro</span></span>
                    <p class="ep-receipt-tag">Property management &amp; rent collection</p>
                </div>
                <div class="ep-receipt-title">
                    <p class="ep-receipt-kicker">Official receipt</p>
                    <h1>Rent payment receipt</h1>
                    <p class="ep-receipt-number">No. <strong>${escapeHtml(receiptNumber)}</strong></p>
                </div>
            </header>

            <section class="ep-receipt-grid">
                ${field('Tenant', tenant.fullName || tenant.email || '—')}
                ${field('Property', property.name || tenant.propertyName || 'Not linked')}
                ${field('Unit', tenant.unit || safePayment.unit || '—')}
                ${field('Rent period', safePayment.period || '—')}
                ${field('Date paid', paidOn)}
                ${field('Payment method', safePayment.method || 'Not recorded')}
                ${field('M-Pesa number used', payerNumber || 'Not recorded')}
                ${field('Rent paid to', paidTo || 'Not recorded')}
            </section>

            <table class="ep-receipt-lines">
                <thead>
                    <tr>
                        <th scope="col">Description</th>
                        <th scope="col" class="ep-receipt-amount">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${row(`${safePayment.period} rent`, formatCurrency(periodRent))}
                    ${row('Amount received in this payment', formatCurrency(safePayment.paidAmount))}
                    ${row(`Paid towards ${safePayment.period} so far`, formatCurrency(periodPaid))}
                </tbody>
                <tfoot>
                    <tr class="ep-receipt-balance ${settled ? 'is-settled' : 'is-due'}">
                        <td>${escapeHtml(balanceLabel)}</td>
                        <td class="ep-receipt-amount">${escapeHtml(formatCurrency(periodOutstanding))}</td>
                    </tr>
                </tfoot>
            </table>

            <p class="ep-receipt-status ${settled ? 'is-settled' : 'is-due'}">
                ${settled ? `${escapeHtml(safePayment.period)} fully settled` : 'Part payment'}
            </p>

            <footer class="ep-receipt-foot">
                <p>Issued by EstatePro on ${escapeHtml(issuedAt)}. Reference ${escapeHtml(safePayment.reference || receiptNumber)}.</p>
                <p>This is a system-generated receipt for a rent payment recorded against the tenancy above. Keep it for your records.</p>
            </footer>
        `;
        wrapper.append(doc);
        return wrapper;
    };

    const toHtmlDocument = (node, title) => [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        `<title>${escapeHtml(title)}</title>`,
        '</head>',
        '<body style="margin:0;background:#edf2ed;">',
        node.outerHTML,
        '</body>',
        '</html>'
    ].join('\n');

    /* Downloads a standalone HTML copy of the receipt that opens and prints
       on its own. */
    const download = (context) => {
        const node = build(context);
        const html = toHtmlDocument(node, `Rent receipt ${receiptNumberFor(context?.payment)} | EstatePro`);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = fileNameFor(context?.payment);
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };

    /* Prints a receipt through a hidden print area, because printing a modal
       dialog directly is unreliable across browsers. */
    const print = (context, printArea) => {
        if (!printArea) {
            return false;
        }

        printArea.replaceChildren(build(context));
        window.print();
        return true;
    };

    window.EstateProRentReceipt = {
        build,
        download,
        print,
        toHtmlDocument,
        fileNameFor,
        receiptNumberFor,
        escapeHtml
    };
})();
