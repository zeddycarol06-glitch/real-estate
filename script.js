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
        unit: document.querySelector('#payment-unit'),
        period: document.querySelector('#payment-period'),
        amount: document.querySelector('#payment-amount'),
        method: document.querySelector('#payment-method'),
        submit: document.querySelector('#submit-payment'),
        error: document.querySelector('#payment-error'),
        status: document.querySelector('#payment-status'),
        formShell: document.querySelector('#payment-form-shell'),
        receiptShell: document.querySelector('#receipt-shell'),
        receiptCard: document.querySelector('#receipt-card'),
        receiptStatus: document.querySelector('#receipt-status'),
        receiptDate: document.querySelector('#receipt-date'),
        receiptMessage: document.querySelector('#receipt-message'),
        receiptNumber: document.querySelector('#receipt-number'),
        receiptTenant: document.querySelector('#receipt-tenant'),
        receiptContact: document.querySelector('#receipt-contact'),
        receiptProperty: document.querySelector('#receipt-property'),
        receiptLocation: document.querySelector('#receipt-location'),
        receiptUnit: document.querySelector('#receipt-unit'),
        receiptPeriod: document.querySelector('#receipt-period'),
        receiptMethod: document.querySelector('#receipt-method'),
        receiptReference: document.querySelector('#receipt-reference'),
        receiptAmount: document.querySelector('#receipt-amount'),
        printReceipt: document.querySelector('#print-receipt'),
        payAnother: document.querySelector('#pay-another')
    };

    const state = {
        properties: [],
        lastPropertyId: requestedPropertyId
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

    const formatDate = (dateString) => {
        if (!dateString) {
            return '—';
        }

        const date = new Date(`${dateString}T00:00:00`);

        if (Number.isNaN(date.getTime())) {
            return dateString;
        }

        return new Intl.DateTimeFormat('en-KE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }).format(date);
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

    const showReceipt = (payment, periodOutstanding) => {
        const property = getProperty(payment.propertyId);
        const paidAmount = Number(payment.paidAmount) || 0;
        /* The balance belongs to the whole rent period, which several part
           payments can share, so the server's figure is preferred. */
        const outstanding = Math.max(0, periodOutstanding ?? ((Number(payment.amount) || 0) - paidAmount));
        const status = String(payment.status || 'Paid').toLowerCase();

        elements.formShell.hidden = true;
        elements.receiptShell.hidden = false;
        document.body.classList.add('receipt-mode');
        setText(elements.receiptStatus, payment.status || 'Paid');
        elements.receiptStatus.className = `status ${status}`;
        setText(elements.receiptDate, formatDate(payment.paidOn));
        setText(elements.receiptMessage, outstanding > 0
            ? `Partial payment received. ${formatCurrency(outstanding)} remains outstanding for this period.`
            : 'Thank you. Your rent payment has been received in full.');
        setText(elements.receiptNumber, payment.receiptNumber || payment.reference || payment.id);
        setText(elements.receiptTenant, payment.tenantName);
        setText(elements.receiptContact, [payment.tenantEmail, payment.tenantPhone].filter(Boolean).join(' · ') || '—');
        setText(elements.receiptProperty, payment.propertyName || property?.name);
        setText(elements.receiptLocation, payment.location || property?.location);
        setText(elements.receiptUnit, payment.unit);
        setText(elements.receiptPeriod, payment.period);
        setText(elements.receiptMethod, payment.method);
        setText(elements.receiptReference, payment.reference || '—');
        setText(elements.receiptAmount, formatCurrency(paidAmount));
        document.title = `Receipt ${payment.receiptNumber || payment.id} | EstatePro`;
        elements.receiptShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => elements.printReceipt.focus(), 0);
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
        elements.submit.textContent = 'Recording payment…';
        showStatus('Recording your payment and creating a receipt…');

        try {
            if (window.location.protocol === 'file:') {
                throw new Error('Start the EstatePro server to record a payment. You can still print this page after the payment is recorded.');
            }

            const response = await fetch('/api/payments', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'The payment could not be recorded.');
            }

            showReceipt(data.payment, data.periodOutstanding);
        } catch (error) {
            showError(error.message || 'The payment could not be recorded. Please try again.');
        } finally {
            elements.submit.disabled = false;
            elements.submit.innerHTML = 'Record payment <span aria-hidden="true">→</span>';
        }
    };

    elements.property.addEventListener('change', () => {
        state.lastPropertyId = elements.property.value;
        updateAmountForProperty();
    });
    form.addEventListener('submit', handleSubmit);
    elements.printReceipt.addEventListener('click', () => window.print());
    elements.payAnother.addEventListener('click', () => {
        form.reset();
        document.body.classList.remove('receipt-mode');
        elements.receiptShell.hidden = true;
        elements.formShell.hidden = false;
        state.lastPropertyId = requestedPropertyId || state.lastPropertyId;
        elements.property.value = getProperty(state.lastPropertyId)?.id || elements.property.value;
        elements.period.value = getCurrentPeriodKey();
        updateAmountForProperty();
        prefillTenantDetails();
        clearMessages();
        elements.tenantName.focus();
    });

    document.querySelectorAll('[data-year]').forEach((element) => {
        element.textContent = String(new Date().getFullYear());
    });

    elements.period.value = getCurrentPeriodKey();
    prefillTenantDetails();
    loadProperties();
})();
