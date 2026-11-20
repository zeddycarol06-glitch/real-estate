(() => {
    'use strict';

    const form = document.querySelector('#rent-payment-form');

    if (!form) {
        return;
    }

    const query = new URLSearchParams(window.location.search);
    const requestedPropertyId = query.get('property') || '';
    const fallbackProperties = [
        { id: 'sunrise-residences', name: 'Sunrise Residences', location: 'Nairobi, Kenya', monthlyRent: 40000 },
        { id: 'royal-homes-apartment', name: 'Royal Homes Apartment', location: 'Nairobi, Kenya', monthlyRent: 35000 },
        { id: 'molo-bedsitter', name: 'Molo Bedsitter', location: 'Nairobi, Kenya', monthlyRent: 18000 },
        { id: 'eldoret-single-room', name: 'Eldoret Single Room', location: 'Eldoret, Kenya', monthlyRent: 9000 },
        { id: 'kasarani-one-bedroom', name: 'Kasarani One Bedroom', location: 'Nairobi, Kenya', monthlyRent: 30000 },
        { id: 'lakeside-family-residence', name: 'Lakeside Family Residence', location: 'Kisumu, Kenya', monthlyRent: 65000 }
    ];

    const elements = {
        property: document.querySelector('#payment-property'),
        tenantName: document.querySelector('#tenant-name'),
        tenantEmail: document.querySelector('#tenant-email'),
        tenantPhone: document.querySelector('#tenant-phone'),
        paymentPhone: document.querySelector('#payment-phone'),
        unit: document.querySelector('#payment-unit'),
        period: document.querySelector('#payment-period'),
        amount: document.querySelector('#payment-amount'),
        method: document.querySelector('#payment-method'),
        pochiReferenceField: document.querySelector('#pochi-reference-field'),
        pochiReference: document.querySelector('#pochi-reference'),
        formIntro: document.querySelector('#payment-form-intro'),
        phoneHelp: document.querySelector('#payment-phone-help'),
        footerNote: document.querySelector('#payment-footer-note'),
        submit: document.querySelector('#submit-payment'),
        error: document.querySelector('#payment-error'),
        status: document.querySelector('#payment-status'),
        formShell: document.querySelector('#payment-form-shell'),
        pendingShell: document.querySelector('#payment-pending-shell'),
        pendingBusinessNumber: document.querySelector('#pending-business-number'),
        pendingPayerNumber: document.querySelector('#pending-payer-number'),
        pendingPaidTo: document.querySelector('#pending-paid-to'),
        pendingRequestId: document.querySelector('#pending-request-id'),
        pendingAmount: document.querySelector('#pending-request-amount'),
        pendingReceipt: document.querySelector('#pending-receipt-number'),
        pendingTitle: document.querySelector('#pending-payment-title'),
        pendingHeading: document.querySelector('#pending-payment-heading'),
        pendingMessage: document.querySelector('#pending-payment-message'),
        pendingState: document.querySelector('#pending-payment-state'),
        pendingBanner: document.querySelector('#pending-banner'),
        pendingBannerIcon: document.querySelector('#pending-banner-icon'),
        pendingReceiptActions: document.querySelector('#pending-receipt-actions'),
        newPaymentRequest: document.querySelector('#new-payment-request'),
        paytoNumber: document.querySelector('#payment-payto-number'),
        printReceipt: document.querySelector('#print-receipt'),
        downloadReceipt: document.querySelector('#download-receipt'),
        receiptPrintArea: document.querySelector('#receipt-print-area'),
        confirmationDialog: document.querySelector('#payment-confirmation-dialog'),
        confirmationAmount: document.querySelector('#confirmation-amount'),
        confirmationPayerNumber: document.querySelector('#confirmation-payer-number'),
        confirmationPaidTo: document.querySelector('#confirmation-paid-to'),
        confirmationReceiptNumber: document.querySelector('#confirmation-receipt-number'),
        confirmationPeriod: document.querySelector('#confirmation-period'),
        confirmationPrintReceipt: document.querySelector('#confirmation-print-receipt'),
        confirmationClose: document.querySelector('#confirmation-close'),
        closePaymentConfirmation: document.querySelector('#close-payment-confirmation'),
        billEmpty: document.querySelector('#rent-bill-empty'),
        billEmptyNote: document.querySelector('#rent-bill-empty-note'),
        billCard: document.querySelector('#rent-bill-card'),
        billNumber: document.querySelector('#bill-number'),
        billStatus: document.querySelector('#bill-status'),
        billTenantName: document.querySelector('#bill-tenant-name'),
        billTenantEmail: document.querySelector('#bill-tenant-email'),
        billProperty: document.querySelector('#bill-property'),
        billLocation: document.querySelector('#bill-location'),
        billUnit: document.querySelector('#bill-unit'),
        billPeriod: document.querySelector('#bill-period'),
        billIssued: document.querySelector('#bill-issued'),
        billDue: document.querySelector('#bill-due'),
        billItemsBody: document.querySelector('#bill-items-body'),
        billBalance: document.querySelector('#bill-balance'),
        billBalanceNote: document.querySelector('#bill-balance-note'),
        billPayButton: document.querySelector('#bill-pay-button'),
        billPrintButton: document.querySelector('#bill-print-button'),
        billMessage: document.querySelector('#bill-message'),
        pochiShell: document.querySelector('#pochi-claim-shell'),
        pochiClaimTitle: document.querySelector('#pochi-claim-title'),
        pochiClaimMessage: document.querySelector('#pochi-claim-message'),
        pochiClaimAmount: document.querySelector('#pochi-claim-amount'),
        pochiClaimReference: document.querySelector('#pochi-claim-reference'),
        pochiClaimPaidTo: document.querySelector('#pochi-claim-paid-to'),
        pochiClaimPayer: document.querySelector('#pochi-claim-payer'),
        pochiClaimPeriod: document.querySelector('#pochi-claim-period'),
        pochiClaimState: document.querySelector('#pochi-claim-state'),
        pochiClaimBalance: document.querySelector('#pochi-claim-balance'),
        pochiPayAnother: document.querySelector('#pochi-pay-another')
    };

    const state = {
        properties: [],
        lastPropertyId: requestedPropertyId,
        pendingRequestId: '',
        pendingPollTimer: 0,
        receivingNumber: '',
        lastPaid: null,
        bill: null,
        billSequence: 0,
        billTimer: 0,
        amountTouched: false
    };

    const numberFormatter = new Intl.NumberFormat('en-KE', {
        maximumFractionDigits: 0
    });

    const formatCurrency = (value) => `KSh ${numberFormatter.format(Math.max(0, Number(value) || 0))}`;
    const setText = (element, value) => {
        if (element) {
            element.textContent = value ?? '—';
        }
    };

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const shortMonthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

    const formatBillDate = (value) => {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!match) {
            return value || '—';
        }

        return `${Number(match[3])} ${shortMonthNames[Number(match[2]) - 1] || ''} ${match[1]}`.trim();
    };

    const periodDetails = (periodKey) => {
        const match = String(periodKey || '').match(/^(\d{4})-(\d{2})$/);
        const now = new Date();
        const year = match ? Number(match[1]) : now.getFullYear();
        const month = match ? Number(match[2]) : now.getMonth() + 1;
        const safeKey = `${year}-${String(month).padStart(2, '0')}`;

        return { periodKey: safeKey, period: `${monthNames[month - 1] || 'Current'} ${year}` };
    };

    const statusClass = (status) => String(status || 'unpaid')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const getCurrentPeriodKey = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    };

    const getSession = () => {
        try {
            const rawSession = window.localStorage.getItem('estateproSession')
                || window.sessionStorage.getItem('estateproSession');
            return rawSession ? JSON.parse(rawSession) : null;
        } catch (error) {
            return null;
        }
    };

    const clearMessages = () => {
        elements.error.hidden = true;
        elements.status.hidden = true;
        elements.error.textContent = '';
        elements.status.textContent = '';
    };

    const showError = (message) => {
        elements.error.textContent = message;
        elements.error.hidden = false;
        elements.status.hidden = true;
    };

    const showStatus = (message) => {
        elements.status.textContent = message;
        elements.status.hidden = false;
        elements.error.hidden = true;
    };

    const getProperty = (propertyId) => state.properties.find((property) => property.id === propertyId);

    const updateAmountForProperty = () => {
        const property = getProperty(elements.property.value);

        if (!property) {
            elements.amount.value = '';
            elements.amount.removeAttribute('max');
            return;
        }

        elements.amount.max = String(property.monthlyRent);
        elements.amount.value = String(property.monthlyRent);
        elements.amount.placeholder = numberFormatter.format(property.monthlyRent);
    };

    const renderPropertyOptions = () => {
        const previousValue = elements.property.value || state.lastPropertyId;
        elements.property.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose a home or house';
        elements.property.appendChild(placeholder);

        state.properties.forEach((property) => {
            const option = document.createElement('option');
            option.value = property.id;
            option.textContent = `${property.name} · ${property.location}`;
            elements.property.appendChild(option);
        });

        const selectedProperty = getProperty(previousValue) || state.properties[0];
        elements.property.value = selectedProperty?.id || '';
        elements.property.disabled = state.properties.length === 0;
        state.lastPropertyId = elements.property.value;
        state.amountTouched = false;
        updateAmountForProperty();
        scheduleBill();
    };

    const prefillTenantDetails = () => {
        const session = getSession();

        if (session?.fullName && !elements.tenantName.value) {
            elements.tenantName.value = session.fullName;
        }

        if (session?.email && !elements.tenantEmail.value) {
            elements.tenantEmail.value = session.email;
        }

        if (session?.phone && !elements.paymentPhone.value) {
            elements.paymentPhone.value = session.phone;
        }
    };

    const loadProperties = async () => {
        if (window.location.protocol === 'file:') {
            state.properties = fallbackProperties;
            renderPropertyOptions();
            return;
        }

        try {
            const response = await fetch('/api/properties', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error('Property request failed');
            }

            const data = await response.json();

            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('No properties available');
            }

            state.properties = data;
        } catch (error) {
            state.properties = fallbackProperties;
        }

        renderPropertyOptions();
    };

    /* The pay-to number is public configuration: it is the Pochi la Biashara
       number rent is received on, shown to tenants before they pay. */
    const loadMpesaConfig = async () => {
        if (window.location.protocol === 'file:') {
            return;
        }

        try {
            const response = await fetch('/api/mpesa/config', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!response.ok) {
                return;
            }

            const data = await response.json();

            if (data.receivingNumber) {
                state.receivingNumber = data.receivingNumber;
                setText(elements.paytoNumber, data.receivingNumber);
            }

            /* Without Daraja there is no STK Push to send. Make the Pochi
               route the default so bit-by-bit payments just work. */
            if (data.stkConfigured === false && elements.method) {
                const stkOption = elements.method.querySelector('option[value="M-Pesa STK Push"]');

                if (stkOption) {
                    stkOption.disabled = true;
                    stkOption.textContent = 'M-Pesa STK Push (not configured)';
                }

                elements.method.value = 'Pochi la Biashara';
                updateMethodFields();
            }
        } catch (error) {
            /* The number already in the markup is the fallback. */
        }
    };

    /* ---- rent bill ---------------------------------------------------- */

    const defaultBillNote = elements.billEmptyNote
        ? elements.billEmptyNote.textContent.trim()
        : '';

    const billInputs = () => ({
        propertyId: elements.property.value,
        unit: elements.unit.value.trim(),
        email: elements.tenantEmail.value.trim(),
        periodKey: elements.period.value,
        tenantName: elements.tenantName.value.trim()
    });

    const billReady = (input) => Boolean(
        input.propertyId && input.unit && isValidEmail(input.email) && input.periodKey
    );

    const isPochiMethod = () => elements.method?.value === 'Pochi la Biashara';

    const setSubmitBusy = (busy) => {
        if (busy) {
            elements.submit.disabled = true;
            elements.submit.textContent = isPochiMethod() ? 'Submitting payment…' : 'Sending STK Push…';
            return;
        }

        const paidInFull = Boolean(state.bill && state.bill.balance <= 0);
        const label = isPochiMethod()
            ? 'Submit Pochi payment <span aria-hidden="true">→</span>'
            : 'Send STK Push <span aria-hidden="true">→</span>';

        elements.submit.disabled = paidInFull;
        elements.submit.innerHTML = paidInFull ? 'Paid in full' : label;
    };

    /* The same form serves both routes. Switching method changes only the
       wording and which details the payer has to supply; the bill and the
       balance check stay exactly the same. */
    const updateMethodFields = () => {
        const pochi = isPochiMethod();

        if (elements.pochiReferenceField) {
            elements.pochiReferenceField.hidden = !pochi;
        }
        if (elements.pochiReference) {
            elements.pochiReference.required = pochi;
            if (!pochi) {
                elements.pochiReference.value = '';
            }
        }

        setText(elements.formIntro, pochi
            ? 'Enter the Safaricom number you sent the money from, the amount, and the M-Pesa confirmation code. Your landlord will verify the code before the rent is recorded.'
            : 'Enter the Safaricom number that should receive the STK Push prompt. The amount is sent to the configured Safaricom business shortcode.');
        setText(elements.phoneHelp, pochi
            ? 'Enter the Safaricom number you sent the money from.'
            : 'Enter the Safaricom number that should receive the STK Push.');

        if (elements.footerNote) {
            elements.footerNote.innerHTML = pochi
                ? '<span aria-hidden="true">🔒</span> Your landlord verifies the M-Pesa code before rent is recorded. You can send the balance in several parts.'
                : '<span aria-hidden="true">🔒</span> Approve the Safaricom STK prompt with your M-Pesa PIN. Rent is recorded only after the provider confirms success.';
        }

        setSubmitBusy(false);
    };

    const resetBill = (message) => {
        state.billSequence += 1;
        state.bill = null;
        window.clearTimeout(state.billTimer);

        if (elements.billCard) {
            elements.billCard.hidden = true;
        }

        if (elements.billEmpty) {
            elements.billEmpty.hidden = false;
        }

        if (elements.billEmptyNote) {
            elements.billEmptyNote.textContent = message || defaultBillNote;
        }

        setSubmitBusy(false);
    };

    /* When the page is opened straight from disk there is no API to consult,
       so the bill still shows the advertised rent and a zero-balance view. */
    const localBill = (input) => {
        const property = getProperty(input.propertyId);
        const rent = Math.max(0, Number(property?.monthlyRent) || 0);
        const { periodKey, period } = periodDetails(input.periodKey);
        const unitCode = input.unit.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'UNIT';
        const propertyCode = String(property?.id || 'PROP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PROP';

        return {
            billNumber: `BILL-${periodKey.replace('-', '')}-${unitCode}-${propertyCode}`,
            status: 'Unpaid',
            propertyName: property?.name || '—',
            location: property?.location || '',
            unit: input.unit,
            period,
            periodKey,
            dueDate: `${periodKey}-05`,
            issuedOn: `${periodKey}-01`,
            email: input.email,
            rent,
            received: 0,
            reserved: 0,
            balance: rent,
            hasTenantRecord: false,
            items: rent > 0
                ? [{ label: `Monthly rent — ${property?.name || 'property'} (${input.unit})`, amount: rent }]
                : []
        };
    };

    const renderBill = (bill, input) => {
        state.bill = bill;

        elements.billCard.hidden = false;
        elements.billEmpty.hidden = true;

        setText(elements.billNumber, bill.billNumber);
        setText(elements.billStatus, bill.status);
        if (elements.billStatus) {
            elements.billStatus.className = `bill-status ${statusClass(bill.status)}`;
        }

        setText(elements.billTenantName, input.tenantName || 'Not provided');
        setText(elements.billTenantEmail, bill.email || input.email);
        setText(elements.billProperty, bill.propertyName);
        setText(elements.billLocation, bill.location || '—');
        setText(elements.billUnit, `Unit ${bill.unit}`);
        setText(elements.billPeriod, bill.period);
        setText(elements.billIssued, `Issued ${formatBillDate(bill.issuedOn)}`);
        setText(elements.billDue, `Due ${formatBillDate(bill.dueDate)}`);

        elements.billItemsBody.replaceChildren();

        if (!bill.items?.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 2;
            cell.className = 'bill-items-empty';
            cell.textContent = 'No rent has been billed for this property yet.';
            row.appendChild(cell);
            elements.billItemsBody.appendChild(row);
        } else {
            bill.items.forEach((item) => {
                const row = document.createElement('tr');
                const label = document.createElement('td');
                const amount = document.createElement('td');

                label.textContent = item.label;
                amount.className = item.credit ? 'bill-credit' : 'bill-debit';
                amount.textContent = `${item.credit ? '−' : ''}${formatCurrency(item.amount)}`;

                row.append(label, amount);
                elements.billItemsBody.appendChild(row);
            });
        }

        setText(elements.billBalance, formatCurrency(bill.balance));

        const balanceNotes = {
            'Paid in full': 'Nothing to pay for this rent period.',
            'Awaiting confirmation': 'A payment is being confirmed or verified. Do not pay twice.',
            'Partially paid': 'Pay the remaining balance below.',
            Unpaid: 'Full rent for this period is due.'
        };

        setText(elements.billBalanceNote, balanceNotes[bill.status] || 'Amount still owed for this period.');

        const payable = Math.max(0, Number(bill.balance) || 0);

        elements.billPayButton.disabled = payable <= 0;
        setText(elements.billPayButton, payable > 0 ? `Pay ${formatCurrency(payable)} →` : 'Paid in full');
        setText(elements.billMessage, bill.hasTenantRecord
            ? 'We found your tenant record, so the agreed rent is shown.'
            : 'No tenant record matched this email yet, so the property rent is shown.');

        elements.amount.max = String(payable || bill.rent || '');

        if (!state.amountTouched) {
            elements.amount.value = payable > 0 ? String(payable) : '';
        }

        setSubmitBusy(false);
    };

    const loadBill = async () => {
        const input = billInputs();

        if (!billReady(input)) {
            const needsEmail = input.propertyId && input.unit && input.periodKey && !isValidEmail(input.email);
            resetBill(needsEmail ? 'Enter a valid email address to see your bill.' : '');
            return;
        }

        const sequence = ++state.billSequence;

        elements.billCard.hidden = false;
        elements.billEmpty.hidden = true;
        elements.billPayButton.disabled = true;
        setText(elements.billMessage, 'Working out your bill…');

        if (window.location.protocol === 'file:') {
            renderBill(localBill(input), input);
            return;
        }

        try {
            const params = new URLSearchParams({
                property: input.propertyId,
                unit: input.unit,
                email: input.email,
                period: input.periodKey
            });
            const response = await fetch(`/api/rent-bill?${params.toString()}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));

            if (sequence !== state.billSequence) {
                return;
            }

            if (!response.ok) {
                throw new Error(data.error || 'The bill could not be worked out right now.');
            }

            renderBill(data, input);
        } catch (error) {
            if (sequence !== state.billSequence) {
                return;
            }

            resetBill(error.message || 'The bill could not be worked out right now.');
        }
    };

    const scheduleBill = () => {
        window.clearTimeout(state.billTimer);
        state.billTimer = window.setTimeout(loadBill, 250);
    };

    /* The receipt is built by the shared module (js/rent-receipt.js) from the
       confirmed payment Safaricom returned. Nothing is built until a payment
       has actually been received. */
    const paidReceiptPayment = (paid) => ({
        id: paid.reference || paid.receiptNumber,
        receiptNumber: paid.receiptNumber,
        reference: paid.reference,
        paidAmount: paid.paidAmount,
        paidOn: paid.paidOn,
        period: paid.period,
        amount: paid.amount,
        periodPaid: paid.periodPaid,
        periodOutstanding: paid.periodOutstanding,
        method: paid.method,
        payerPhone: paid.payerPhone,
        unit: paid.unit
    });

    const receiptContext = () => {
        const paid = state.lastPaid;

        if (!paid) {
            return null;
        }

        return {
            payment: paidReceiptPayment(paid),
            tenant: { fullName: paid.tenantName, unit: paid.unit },
            property: { name: paid.propertyName },
            monthlyRent: paid.amount,
            paidTo: paid.paidTo || paid.receivingNumber || state.receivingNumber
        };
    };

    const printReceipt = () => {
        const context = receiptContext();

        if (context && window.EstateProRentReceipt) {
            window.EstateProRentReceipt.print(context, elements.receiptPrintArea);
        }
    };

    const downloadReceipt = () => {
        const context = receiptContext();

        if (context && window.EstateProRentReceipt) {
            window.EstateProRentReceipt.download(context);
            showStatus('Receipt downloaded. Open it and use Print → Save as PDF for a PDF copy.');
        }
    };

    const openConfirmation = (paid) => {
        state.lastPaid = paid;
        setText(elements.confirmationAmount, formatCurrency(paid.paidAmount));
        setText(elements.confirmationPayerNumber, paid.payerPhone || 'Not recorded');
        setText(elements.confirmationPaidTo, paid.paidTo || paid.receivingNumber || state.receivingNumber || 'Not recorded');
        setText(elements.confirmationReceiptNumber, paid.receiptNumber || paid.reference || '—');
        setText(elements.confirmationPeriod, paid.period || '—');

        if (!elements.confirmationDialog) {
            return;
        }

        if (typeof elements.confirmationDialog.showModal === 'function') {
            if (!elements.confirmationDialog.open) {
                elements.confirmationDialog.showModal();
            }
        } else {
            elements.confirmationDialog.setAttribute('open', '');
        }
    };

    const closeConfirmation = () => {
        if (!elements.confirmationDialog) {
            return;
        }

        if (elements.confirmationDialog.open && typeof elements.confirmationDialog.close === 'function') {
            elements.confirmationDialog.close();
        } else {
            elements.confirmationDialog.removeAttribute('open');
        }
    };

    const pollPaymentStatus = async (requestId) => {
        if (state.pendingRequestId !== requestId || elements.pendingShell.hidden) {
            return;
        }

        try {
            const response = await fetch(`/api/payment-requests/${encodeURIComponent(requestId)}/status`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Payment status is not available yet.');
            }

            if (data.state === 'paid') {
                state.lastPaid = data;
                setText(elements.pendingTitle, 'M-Pesa payment confirmed');
                setText(elements.pendingHeading, 'Rent payment complete');
                setText(elements.pendingMessage, 'Safaricom confirmed this transaction. The payment is now recorded in your rent history and your receipt is ready.');
                setText(elements.pendingState, 'Paid');
                setText(elements.pendingReceipt, data.receiptNumber || data.reference || 'Confirmed');
                setText(elements.pendingPayerNumber, data.payerPhone || '—');
                setText(elements.pendingPaidTo, data.paidTo || data.receivingNumber || state.receivingNumber || '—');

                if (elements.pendingBanner) {
                    elements.pendingBanner.classList.remove('payment-pending-banner');
                }
                if (elements.pendingBannerIcon) {
                    elements.pendingBannerIcon.textContent = '✓';
                }
                if (elements.pendingReceiptActions) {
                    elements.pendingReceiptActions.hidden = false;
                }

                /* The printable receipt is only offered now that Safaricom has
                   confirmed the money was received. The bill is refreshed so
                   it no longer shows a balance that has just been settled. */
                openConfirmation(data);
                loadBill();
                return;
            }

            if (data.state === 'failed') {
                setText(elements.pendingTitle, 'M-Pesa payment not completed');
                setText(elements.pendingHeading, 'STK Push failed');
                setText(elements.pendingMessage, data.message || 'The STK payment was not completed. Start a new payment if you still owe rent.');
                setText(elements.pendingState, 'Not paid');
                return;
            }

            if (data.state === 'review') {
                setText(elements.pendingTitle, 'Payment needs reconciliation');
                setText(elements.pendingHeading, 'Contact your landlord');
                setText(elements.pendingMessage, data.message || 'Do not retry the payment until this transaction has been checked.');
                setText(elements.pendingState, 'Under review');
                return;
            }

            setText(elements.pendingMessage, data.message || 'Check your phone and enter your M-Pesa PIN. Rent is not marked paid until Safaricom confirms the transaction.');
            setText(elements.pendingState, 'Waiting for M-Pesa approval');
        } catch (error) {
            setText(elements.pendingMessage, 'The payment status could not be checked just now. Keep this page open while we retry; do not pay again.');
        }

        if (state.pendingRequestId === requestId && !elements.pendingShell.hidden) {
            state.pendingPollTimer = window.setTimeout(() => pollPaymentStatus(requestId), 3000);
        }
    };

    const showPendingRequest = (paymentRequest, businessShortCode, receivingNumber) => {
        elements.formShell.hidden = true;
        elements.pendingShell.hidden = false;
        document.body.classList.add('receipt-mode');
        state.lastPaid = null;
        setText(elements.pendingBusinessNumber, businessShortCode || '174379');
        setText(elements.pendingPayerNumber, paymentRequest.phoneNumber || '—');
        setText(elements.pendingPaidTo, receivingNumber || state.receivingNumber || '—');
        setText(elements.pendingRequestId, paymentRequest.id);
        setText(elements.pendingAmount, formatCurrency(paymentRequest.requestedAmount));
        setText(elements.pendingReceipt, 'Not received yet');
        setText(elements.pendingTitle, 'STK Push sent');
        setText(elements.pendingHeading, 'Waiting for payment confirmation');
        setText(elements.pendingMessage, `Check ${paymentRequest.phoneNumber} and enter your M-Pesa PIN. Rent is not marked paid until Safaricom confirms the transaction.`);
        setText(elements.pendingState, 'Waiting for M-Pesa approval');
        if (elements.pendingBanner) {
            elements.pendingBanner.classList.add('payment-pending-banner');
        }
        if (elements.pendingBannerIcon) {
            elements.pendingBannerIcon.textContent = '…';
        }
        if (elements.pendingReceiptActions) {
            elements.pendingReceiptActions.hidden = true;
        }
        state.pendingRequestId = paymentRequest.id;
        elements.pendingShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => elements.newPaymentRequest.focus(), 0);
        state.pendingPollTimer = window.setTimeout(() => pollPaymentStatus(paymentRequest.id), 1500);
    };

    const showPochiClaim = (claim, bill, receivingNumber) => {
        elements.formShell.hidden = true;
        if (elements.pendingShell) {
            elements.pendingShell.hidden = true;
        }
        elements.pochiShell.hidden = false;
        document.body.classList.add('receipt-mode');
        state.lastPaid = null;
        window.clearTimeout(state.pendingPollTimer);
        state.pendingRequestId = '';

        setText(elements.pochiClaimAmount, formatCurrency(claim.amount));
        setText(elements.pochiClaimReference, claim.reference || '—');
        setText(elements.pochiClaimPaidTo, receivingNumber || state.receivingNumber || '—');
        setText(elements.pochiClaimPayer, elements.paymentPhone.value.trim() || '—');
        setText(elements.pochiClaimPeriod, claim.period || '—');
        setText(elements.pochiClaimState, 'Awaiting landlord verification');
        setText(elements.pochiClaimBalance, formatCurrency(bill?.balance ?? state.bill?.balance ?? 0));

        if (bill) {
            renderBill(bill, billInputs());
        }

        elements.pochiShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => elements.pochiPayAnother?.focus(), 0);
    };

    const submitPochiClaim = async (payload) => {
        const reference = String(elements.pochiReference?.value || '').trim().toUpperCase();

        if (!/^[A-Z0-9]{4,20}$/.test(reference)) {
            showError('Enter the M-Pesa confirmation code, such as SJL4K9ZQ2M.');
            elements.pochiReference?.focus();
            return;
        }

        payload.reference = reference;
        setSubmitBusy(true);
        showStatus('Submitting your Pochi payment reference…');
        let serverResponded = false;

        try {
            if (window.location.protocol === 'file:') {
                throw new Error('Start the EstatePro server to submit a Pochi payment.');
            }

            const response = await fetch('/api/pochi-claim', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            serverResponded = true;
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'The Pochi payment could not be submitted.');
            }

            if (!data.claim?.id) {
                throw new Error('The payment reference could not be saved.');
            }

            clearMessages();
            showPochiClaim(data.claim, data.bill, data.receivingNumber);
        } catch (error) {
            showError(!serverResponded && window.location.protocol !== 'file:'
                ? 'The server response was lost. Check your M-Pesa message and contact your landlord before sending again.'
                : (error.message || 'The Pochi payment could not be submitted. Please try again.'));
        } finally {
            setSubmitBusy(false);
        }
    };

    const payAnotherPart = () => {
        elements.pochiShell.hidden = true;
        elements.formShell.hidden = false;
        document.body.classList.remove('receipt-mode');
        if (elements.pochiReference) {
            elements.pochiReference.value = '';
        }
        state.amountTouched = false;
        clearMessages();
        scheduleBill();
        elements.pochiReference?.focus();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        clearMessages();

        if (!form.reportValidity()) {
            return;
        }

        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        payload.amount = Number(payload.amount);

        if (state.bill && payload.amount > state.bill.balance) {
            showError(`The balance on this bill is ${formatCurrency(state.bill.balance)}. Enter an amount up to that figure.`);
            return;
        }

        if (isPochiMethod()) {
            await submitPochiClaim(payload);
            return;
        }

        setSubmitBusy(true);
        showStatus(`Sending an M-Pesa prompt to ${elements.paymentPhone.value.trim()}…`);
        let serverResponded = false;

        try {
            if (window.location.protocol === 'file:') {
                throw new Error('Start the EstatePro server to request an M-Pesa STK Push.');
            }

            const response = await fetch('/api/payments', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            serverResponded = true;
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'The payment request could not be submitted.');
            }

            if (!data.request?.id) {
                throw new Error('Safaricom did not return an STK payment request.');
            }

            showPendingRequest(data.request, data.businessShortCode, data.receivingNumber);
        } catch (error) {
            showError(!serverResponded && window.location.protocol !== 'file:'
                ? 'The server response was lost, so we cannot confirm whether Safaricom received the STK request. Check your phone and contact your landlord before trying again.'
                : (error.message || 'The STK Push could not be started. Please try again.'));
        } finally {
            setSubmitBusy(false);
        }
    };

    const startAnotherPayment = () => {
        window.clearTimeout(state.pendingPollTimer);
        state.pendingRequestId = '';
        state.lastPaid = null;
        closeConfirmation();
        form.reset();
        document.body.classList.remove('receipt-mode');
        elements.pendingShell.hidden = true;
        if (elements.pochiShell) {
            elements.pochiShell.hidden = true;
        }
        elements.formShell.hidden = false;
        updateMethodFields();
        if (elements.pendingReceiptActions) {
            elements.pendingReceiptActions.hidden = true;
        }
        if (elements.receiptPrintArea) {
            elements.receiptPrintArea.replaceChildren();
        }
        state.lastPropertyId = requestedPropertyId || state.lastPropertyId;
        elements.property.value = getProperty(state.lastPropertyId)?.id || elements.property.value;
        elements.period.value = getCurrentPeriodKey();
        state.amountTouched = false;
        updateAmountForProperty();
        prefillTenantDetails();
        resetBill();
        scheduleBill();
        clearMessages();
        elements.tenantName.focus();
    };

    const payBill = () => {
        if (!state.bill || state.bill.balance <= 0) {
            return;
        }

        state.amountTouched = true;
        elements.amount.value = String(state.bill.balance);
        clearMessages();
        showStatus(isPochiMethod()
            ? `Bill ${state.bill.billNumber}: ${formatCurrency(state.bill.balance)} added. Send that amount to the Pochi number and enter the M-Pesa code below.`
            : `Bill ${state.bill.billNumber}: ${formatCurrency(state.bill.balance)} added. Approve the M-Pesa prompt on your phone.`);
        const focusTarget = isPochiMethod() ? elements.pochiReference : elements.paymentPhone;
        focusTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        focusTarget?.focus({ preventScroll: true });
    };

    const printBill = () => {
        if (!state.bill || elements.billCard.hidden) {
            return;
        }

        document.body.classList.add('printing-bill');
        window.print();
    };

    elements.property.addEventListener('change', () => {
        state.lastPropertyId = elements.property.value;
        state.amountTouched = false;
        updateAmountForProperty();
        scheduleBill();
    });

    [elements.unit, elements.tenantEmail, elements.period, elements.tenantName]
        .forEach((field) => field?.addEventListener('input', scheduleBill));

    [elements.unit, elements.tenantEmail, elements.period]
        .forEach((field) => field?.addEventListener('change', scheduleBill));

    elements.amount.addEventListener('input', () => {
        state.amountTouched = true;
    });

    elements.method?.addEventListener('change', () => {
        clearMessages();
        updateMethodFields();
    });

    elements.billPayButton?.addEventListener('click', payBill);
    elements.billPrintButton?.addEventListener('click', printBill);
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-bill'));

    form.addEventListener('submit', handleSubmit);
    elements.newPaymentRequest.addEventListener('click', startAnotherPayment);
    elements.pochiPayAnother?.addEventListener('click', payAnotherPart);
    elements.printReceipt?.addEventListener('click', printReceipt);
    elements.downloadReceipt?.addEventListener('click', downloadReceipt);
    elements.confirmationPrintReceipt?.addEventListener('click', printReceipt);
    elements.confirmationClose?.addEventListener('click', closeConfirmation);
    elements.closePaymentConfirmation?.addEventListener('click', closeConfirmation);

    document.querySelectorAll('[data-year]').forEach((element) => {
        element.textContent = String(new Date().getFullYear());
    });

    elements.period.value = getCurrentPeriodKey();
    prefillTenantDetails();
    updateMethodFields();
    resetBill();
    loadProperties();
    loadMpesaConfig();
    scheduleBill();
})();
