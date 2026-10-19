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
        submit: document.querySelector('#submit-payment'),
        error: document.querySelector('#payment-error'),
        status: document.querySelector('#payment-status'),
        formShell: document.querySelector('#payment-form-shell'),
        pendingShell: document.querySelector('#payment-pending-shell'),
        pendingBusinessNumber: document.querySelector('#pending-business-number'),
        pendingRequestId: document.querySelector('#pending-request-id'),
        pendingAmount: document.querySelector('#pending-request-amount'),
        pendingReceipt: document.querySelector('#pending-receipt-number'),
        pendingTitle: document.querySelector('#pending-payment-title'),
        pendingHeading: document.querySelector('#pending-payment-heading'),
        pendingMessage: document.querySelector('#pending-payment-message'),
        pendingState: document.querySelector('#pending-payment-state'),
        newPaymentRequest: document.querySelector('#new-payment-request'),
    };

    const state = {
        properties: [],
        lastPropertyId: requestedPropertyId,
        pendingRequestId: '',
        pendingPollTimer: 0
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
        updateAmountForProperty();
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
                setText(elements.pendingTitle, 'M-Pesa payment confirmed');
                setText(elements.pendingHeading, 'Rent payment complete');
                setText(elements.pendingMessage, 'Safaricom confirmed this transaction. The payment is now recorded in your rent history.');
                setText(elements.pendingState, 'Paid');
                setText(elements.pendingReceipt, data.reference || data.receiptNumber || 'Confirmed');
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

    const showPendingRequest = (paymentRequest, businessShortCode) => {
        elements.formShell.hidden = true;
        elements.pendingShell.hidden = false;
        document.body.classList.add('receipt-mode');
        setText(elements.pendingBusinessNumber, businessShortCode || '174379');
        setText(elements.pendingRequestId, paymentRequest.id);
        setText(elements.pendingAmount, formatCurrency(paymentRequest.requestedAmount));
        setText(elements.pendingReceipt, 'Not received yet');
        setText(elements.pendingTitle, 'STK Push sent');
        setText(elements.pendingHeading, 'Waiting for payment confirmation');
        setText(elements.pendingMessage, `Check ${paymentRequest.phoneNumber} and enter your M-Pesa PIN. Rent is not marked paid until Safaricom confirms the transaction.`);
        setText(elements.pendingState, 'Waiting for M-Pesa approval');
        state.pendingRequestId = paymentRequest.id;
        elements.pendingShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => elements.newPaymentRequest.focus(), 0);
        state.pendingPollTimer = window.setTimeout(() => pollPaymentStatus(paymentRequest.id), 1500);
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

        elements.submit.disabled = true;
        elements.submit.textContent = 'Sending STK Push…';
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

            showPendingRequest(data.request, data.businessShortCode);
        } catch (error) {
            showError(!serverResponded && window.location.protocol !== 'file:'
                ? 'The server response was lost, so we cannot confirm whether Safaricom received the STK request. Check your phone and contact your landlord before trying again.'
                : (error.message || 'The STK Push could not be started. Please try again.'));
        } finally {
            elements.submit.disabled = false;
            elements.submit.innerHTML = 'Send STK Push <span aria-hidden="true">→</span>';
        }
    };

    const startAnotherPayment = () => {
        window.clearTimeout(state.pendingPollTimer);
        state.pendingRequestId = '';
        form.reset();
        document.body.classList.remove('receipt-mode');
        elements.pendingShell.hidden = true;
        elements.formShell.hidden = false;
        state.lastPropertyId = requestedPropertyId || state.lastPropertyId;
        elements.property.value = getProperty(state.lastPropertyId)?.id || elements.property.value;
        elements.period.value = getCurrentPeriodKey();
        updateAmountForProperty();
        prefillTenantDetails();
        clearMessages();
        elements.tenantName.focus();
    };

    elements.property.addEventListener('change', () => {
        state.lastPropertyId = elements.property.value;
        updateAmountForProperty();
    });
    form.addEventListener('submit', handleSubmit);
    elements.newPaymentRequest.addEventListener('click', startAnotherPayment);

    document.querySelectorAll('[data-year]').forEach((element) => {
        element.textContent = String(new Date().getFullYear());
    });

    elements.period.value = getCurrentPeriodKey();
    prefillTenantDetails();
    loadProperties();
})();
