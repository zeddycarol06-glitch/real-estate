(() => {
    'use strict';

    const section = document.querySelector('#tenants');

    if (!section) {
        return;
    }

    const IMPORT_FLAG = 'estateproTenantImportDone';
    const monthFormatter = new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric' });
    const dayFormatter = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
    const numberFormatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

    const elements = {
        addTenant: document.querySelector('#add-tenant'),
        exportTenants: document.querySelector('#export-tenants'),
        tenantTotal: document.querySelector('#tenant-total'),
        tenantPaidCount: document.querySelector('#tenant-paid-count'),
        tenantUnpaidCount: document.querySelector('#tenant-unpaid-count'),
        tenantRentValue: document.querySelector('#tenant-rent-value'),
        search: document.querySelector('#tenant-search'),
        propertyFilter: document.querySelector('#tenant-property-filter'),
        paymentFilter: document.querySelector('#tenant-payment-filter'),
        resetFilters: document.querySelector('#reset-tenant-filters'),
        count: document.querySelector('#tenant-count'),
        body: document.querySelector('#tenants-body'),
        empty: document.querySelector('#tenants-empty'),
        emptyTitle: document.querySelector('#tenants-empty-title'),
        emptyText: document.querySelector('#tenants-empty-text'),
        dialog: document.querySelector('#tenant-dialog'),
        dialogTitle: document.querySelector('#tenant-dialog-title'),
        form: document.querySelector('#tenant-form'),
        formError: document.querySelector('#tenant-form-error'),
        id: document.querySelector('#tenant-id'),
        fullName: document.querySelector('#tenant-full-name'),
        email: document.querySelector('#tenant-email'),
        phone: document.querySelector('#tenant-phone'),
        property: document.querySelector('#tenant-property'),
        unit: document.querySelector('#tenant-unit'),
        rent: document.querySelector('#tenant-rent'),
        status: document.querySelector('#tenant-status'),
        notes: document.querySelector('#tenant-notes'),
        save: document.querySelector('#save-tenant'),
        cancel: document.querySelector('#cancel-tenant'),
        close: document.querySelector('#close-tenant-dialog'),
        profileDialog: document.querySelector('#tenant-profile-dialog'),
        profileTitle: document.querySelector('#tenant-profile-title'),
        profileContent: document.querySelector('#tenant-profile-content'),
        closeProfile: document.querySelector('#close-tenant-profile'),
        profileRecordPayment: document.querySelector('#profile-record-payment'),
        profileEdit: document.querySelector('#profile-edit-tenant'),
        paymentDialog: document.querySelector('#tenant-payment-dialog'),
        paymentTitle: document.querySelector('#tenant-payment-title'),
        paymentForm: document.querySelector('#tenant-payment-form'),
        paymentError: document.querySelector('#tenant-payment-error'),
        paymentSummary: document.querySelector('#tenant-payment-summary'),
        paymentProperty: document.querySelector('#tenant-payment-property'),
        paymentUnit: document.querySelector('#tenant-payment-unit'),
        paymentPeriod: document.querySelector('#tenant-payment-period'),
        paymentMethod: document.querySelector('#tenant-payment-method'),
        paymentPayerPhone: document.querySelector('#tenant-payment-payer-phone'),
        paymentAmount: document.querySelector('#tenant-payment-amount'),
        closePayment: document.querySelector('#close-tenant-payment'),
        cancelPayment: document.querySelector('#cancel-tenant-payment'),
        deleteDialog: document.querySelector('#tenant-delete-dialog'),
        deleteTitle: document.querySelector('#tenant-delete-title'),
        deleteMessage: document.querySelector('#tenant-delete-message'),
        closeDelete: document.querySelector('#close-tenant-delete'),
        cancelDelete: document.querySelector('#cancel-tenant-delete'),
        confirmDelete: document.querySelector('#confirm-tenant-delete')
    };

    const state = {
        tenants: [],
        properties: [],
        filters: { search: '', property: '', payment: 'all' },
        editingId: '',
        payingId: '',
        profileId: '',
        deletingId: ''
    };

    const createElement = (tag, className, text) => {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined) {
            element.textContent = text;
        }

        return element;
    };

    const formatCurrency = (value) => `KSh ${numberFormatter.format(Math.max(0, Number(value) || 0))}`;

    const formatDate = (dateString) => {
        if (!dateString) {
            return '—';
        }

        const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);

        return Number.isNaN(date.getTime()) ? String(dateString) : dayFormatter.format(date);
    };

    const getInitials = (name) => String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

    /* Tenant management talks to the dashboard shell through events so neither
       file has to reach into the other's internals. */
    const notify = (message) => {
        document.dispatchEvent(new CustomEvent('estatepro:notify', { detail: { message } }));
    };

    const announceChange = () => {
        document.dispatchEvent(new CustomEvent('estatepro:tenants-changed'));
    };

    const redirectToSignIn = () => {
        window.location.replace(`admin-login.html?next=${encodeURIComponent('/dashboard.html#tenants')}&reason=expired`);
    };

    const api = async (path, options = {}) => {
        const hasBody = options.body !== undefined;
        const response = await fetch(path, {
            method: options.method || 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                ...(hasBody ? { 'Content-Type': 'application/json' } : {})
            },
            body: hasBody ? JSON.stringify(options.body) : undefined
        });

        let data = null;

        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }

        if (response.status === 401) {
            redirectToSignIn();
            throw new Error('Your admin session has ended.');
        }

        if (!response.ok) {
            if (data === null) {
                throw new Error(`The EstatePro server did not answer properly (error ${response.status}). Start it with "npm start", then try again.`);
            }

            throw new Error(data?.error || 'Something went wrong. Please try again.');
        }

        return data;
    };

    const showFormError = (element, message) => {
        element.textContent = message;
        element.hidden = !message;
    };

    /* Replaces the loading state with a reason when the list cannot be shown,
       so the table is never left claiming to still be loading. */
    const showUnavailable = (message) => {
        state.tenants = [];
        renderTenants();
        elements.count.textContent = message;
        elements.emptyTitle.textContent = 'Tenant list unavailable';
        elements.emptyText.textContent = message;
        elements.empty.hidden = false;
    };

    const openDialog = (dialog) => {
        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    };

    const closeDialog = (dialog) => {
        if (typeof dialog.close === 'function') {
            dialog.close();
        } else {
            dialog.removeAttribute('open');
        }
    };

    const getPropertyById = (propertyId) => state.properties.find((item) => item.id === propertyId) || null;

    const buildPeriodOptions = () => {
        const now = new Date();
        const options = [];

        for (let offset = 0; offset >= -12; offset -= 1) {
            const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            options.push({
                monthKey,
                label: offset === 0 ? `${monthFormatter.format(date)} (current)` : monthFormatter.format(date)
            });
        }

        return options;
    };

    const populatePropertySelect = (select, selectedId) => {
        select.replaceChildren();

        if (!select.id.includes('payment')) {
            const placeholder = createElement('option', '', 'Choose a property');
            placeholder.value = '';
            select.appendChild(placeholder);
        }

        state.properties.forEach((property) => {
            const option = createElement('option', '', `${property.name} · ${property.location}`);
            option.value = property.id;
            select.appendChild(option);
        });

        select.value = selectedId && getPropertyById(selectedId) ? selectedId : '';
    };

    const getPaymentState = (tenant) => {
        if (!tenant.hasPaid) {
            return { key: 'unpaid', label: 'Not paid yet' };
        }

        if (Number(tenant.outstanding) > 0) {
            return { key: 'partial', label: 'Part paid' };
        }

        return { key: 'paid', label: 'Paid' };
    };

    const createActionButton = (label, action, tenantId, className) => {
        const button = createElement('button', className, label);
        button.type = 'button';
        button.dataset.tenantAction = action;
        button.dataset.tenantId = tenantId;
        button.setAttribute('aria-label', `${label}: ${tenantId}`);
        return button;
    };

    const createRow = (tenant) => {
        const row = document.createElement('tr');
        const paymentState = getPaymentState(tenant);

        const identityCell = document.createElement('td');
        const identity = createElement('div', 'tenant-cell');
        const avatar = createElement('span', 'tenant-avatar', getInitials(tenant.fullName));
        const identityText = createElement('div');
        identityText.append(
            createElement('strong', '', tenant.fullName),
            createElement('small', '', tenant.email)
        );
        identity.append(avatar, identityText);
        identityCell.appendChild(identity);

        const contactCell = document.createElement('td');
        const contact = createElement('div', 'property-cell');
        const contactText = createElement('div');
        contactText.append(
            createElement('strong', '', tenant.phone || 'No phone'),
            createElement('small', '', tenant.status === 'Inactive' ? 'Inactive tenant' : `Added ${formatDate(String(tenant.createdAt || '').slice(0, 10))}`)
        );
        contact.appendChild(contactText);
        contactCell.appendChild(contact);

        const propertyCell = document.createElement('td');
        const property = createElement('div', 'property-cell');
        const propertyText = createElement('div');
        propertyText.append(
            createElement('strong', '', tenant.propertyName || 'Unknown property'),
            createElement('small', '', tenant.unit ? `Unit ${tenant.unit} · ${tenant.location}` : `No unit recorded · ${tenant.location}`)
        );
        property.appendChild(propertyText);
        propertyCell.appendChild(property);

        const rentCell = document.createElement('td');
        rentCell.appendChild(createElement('span', 'amount-cell', formatCurrency(tenant.monthlyRent)));

        const paidCell = document.createElement('td');
        const paid = createElement('span', 'amount-cell', formatCurrency(tenant.totalPaid));
        const paidDetail = createElement('small', 'amount-detail', tenant.paymentCount
            ? `${tenant.paymentCount} payment${tenant.paymentCount === 1 ? '' : 's'}`
            : 'No payments yet');
        paidCell.className = 'amount-cell';
        paidCell.append(paid, paidDetail);

        const lastPaymentCell = document.createElement('td');
        lastPaymentCell.appendChild(createElement('span', 'method-cell', tenant.lastPaymentOn ? formatDate(tenant.lastPaymentOn) : 'Never'));

        const statusCell = document.createElement('td');
        statusCell.appendChild(createElement('span', `status tenant-status-${paymentState.key}`, paymentState.label));

        const actionCell = document.createElement('td');
        const actions = createElement('div', 'tenant-row-actions');
        actions.append(
            createActionButton('View', 'view', tenant.id, 'table-action'),
            createActionButton('Pay', 'pay', tenant.id, 'table-action table-action-primary'),
            createActionButton('Edit', 'edit', tenant.id, 'table-action'),
            createActionButton('Delete', 'delete', tenant.id, 'table-action table-action-danger')
        );
        actionCell.appendChild(actions);

        row.append(identityCell, contactCell, propertyCell, rentCell, paidCell, lastPaymentCell, statusCell, actionCell);
        return row;
    };

    const getFilteredTenants = () => {
        const searchTerm = state.filters.search.trim().toLowerCase();

        return state.tenants.filter((tenant) => {
            const propertyMatches = !state.filters.property || tenant.propertyId === state.filters.property;
            const paymentMatches = state.filters.payment === 'all'
                || (state.filters.payment === 'paid' && tenant.hasPaid)
                || (state.filters.payment === 'unpaid' && !tenant.hasPaid);
            const searchMatches = !searchTerm || [
                tenant.fullName,
                tenant.email,
                tenant.phone,
                tenant.propertyName,
                tenant.location,
                tenant.unit
            ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

            return propertyMatches && paymentMatches && searchMatches;
        });
    };

    const renderSummary = () => {
        const paid = state.tenants.filter((tenant) => tenant.hasPaid).length;
        const rentValue = state.tenants
            .filter((tenant) => tenant.status !== 'Inactive')
            .reduce((total, tenant) => total + (Number(tenant.monthlyRent) || 0), 0);

        elements.tenantTotal.textContent = String(state.tenants.length);
        elements.tenantPaidCount.textContent = String(paid);
        elements.tenantUnpaidCount.textContent = String(state.tenants.length - paid);
        elements.tenantRentValue.textContent = formatCurrency(rentValue);
    };

    const renderTenants = () => {
        const visible = getFilteredTenants();

        elements.body.replaceChildren(...visible.map(createRow));

        const isFiltered = Boolean(state.filters.search.trim())
            || Boolean(state.filters.property)
            || state.filters.payment !== 'all';

        elements.count.textContent = isFiltered
            ? `Showing ${visible.length} of ${state.tenants.length} tenants`
            : `${state.tenants.length} tenant${state.tenants.length === 1 ? '' : 's'} on file`;

        elements.empty.hidden = visible.length !== 0;
        elements.emptyTitle.textContent = isFiltered ? 'No tenants match these filters' : 'No tenants on file yet';
        elements.emptyText.textContent = isFiltered
            ? 'Try a different search term, or reset the filters to see everyone.'
            : 'Add your first tenant to start keeping track of who lives where and what they owe.';

        renderSummary();
    };

    const populatePropertyFilter = () => {
        const selected = state.filters.property;
        elements.propertyFilter.replaceChildren();

        const allOption = createElement('option', '', 'All properties');
        allOption.value = '';
        elements.propertyFilter.appendChild(allOption);

        state.properties.forEach((property) => {
            const option = createElement('option', '', `${property.name} · ${property.location}`);
            option.value = property.id;
            elements.propertyFilter.appendChild(option);
        });

        elements.propertyFilter.value = getPropertyById(selected) ? selected : '';
    };

    const loadProperties = async () => {
        state.properties = await api('/api/properties');
        populatePropertyFilter();
    };

    const loadTenants = async () => {
        state.tenants = await api('/api/tenants');
        renderTenants();
    };

    const reload = async () => {
        try {
            await loadTenants();
        } catch (error) {
            if (!String(error.message).includes('admin session')) {
                showUnavailable('Your tenants could not be refreshed. Check that the EstatePro server is running, then try again.');
                notify(error.message);
            }
        }
    };

    /* ---- add and edit ---- */

    const openTenantForm = (tenant = null) => {
        state.editingId = tenant?.id || '';
        showFormError(elements.formError, '');

        elements.id.value = tenant?.id || '';
        elements.fullName.value = tenant?.fullName || '';
        elements.email.value = tenant?.email || '';
        elements.phone.value = tenant?.phone || '';
        elements.unit.value = tenant?.unit || '';
        elements.rent.value = tenant ? tenant.monthlyRent : '';
        elements.status.value = tenant?.status || 'Active';
        elements.notes.value = tenant?.notes || '';
        populatePropertySelect(elements.property, tenant?.propertyId || '');

        elements.dialogTitle.textContent = tenant ? `Edit ${tenant.fullName}` : 'Add a tenant';
        elements.save.textContent = tenant ? 'Save changes' : 'Save tenant';
        openDialog(elements.dialog);
        elements.fullName.focus();
    };

    const handleTenantSubmit = async (event) => {
        event.preventDefault();
        showFormError(elements.formError, '');

        const body = {
            fullName: elements.fullName.value.trim(),
            email: elements.email.value.trim(),
            phone: elements.phone.value.trim(),
            propertyId: elements.property.value,
            unit: elements.unit.value.trim(),
            monthlyRent: elements.rent.value,
            status: elements.status.value,
            notes: elements.notes.value.trim()
        };

        if (body.fullName.length < 2) {
            showFormError(elements.formError, 'Enter the tenant\'s full name.');
            return;
        }

        if (!elements.property.value) {
            showFormError(elements.formError, 'Choose the property this tenant is in.');
            return;
        }

        elements.save.disabled = true;

        try {
            const isEditing = Boolean(state.editingId);
            const result = await api(isEditing ? `/api/tenants/${encodeURIComponent(state.editingId)}` : '/api/tenants', {
                method: isEditing ? 'PUT' : 'POST',
                body
            });

            closeDialog(elements.dialog);
            notify(result.message);
            await reload();
            announceChange();
        } catch (error) {
            showFormError(elements.formError, error.message);
        } finally {
            elements.save.disabled = false;
        }
    };

    /* ---- profile ---- */

    const renderProfile = (tenant, payments) => {
        const rows = [
            ['Email', tenant.email],
            ['Phone', tenant.phone || 'Not provided'],
            ['Property', `${tenant.propertyName} · Unit ${tenant.unit || 'not recorded'}`],
            ['Location', tenant.location || 'Not recorded'],
            ['Monthly rent', formatCurrency(tenant.monthlyRent)],
            ['Status', tenant.status],
            ['Payments made', String(tenant.paymentCount)],
            ['Total paid', formatCurrency(tenant.totalPaid)],
            ['Outstanding', formatCurrency(tenant.outstanding)],
            ['Last payment', tenant.lastPaymentOn ? formatDate(tenant.lastPaymentOn) : 'Never'],
            ['On file since', formatDate(String(tenant.createdAt || '').slice(0, 10))],
            ['Added from', tenant.source || 'admin'],
            ['Notes', tenant.notes || 'None']
        ];

        const details = createElement('dl', 'dialog-detail-list');
        rows.forEach(([label, value]) => {
            const group = createElement('div');
            group.append(createElement('dt', '', label), createElement('dd', '', value));
            details.appendChild(group);
        });

        const history = createElement('div', 'tenant-history');
        history.appendChild(createElement('h3', 'tenant-history-title', 'Payment history'));

        if (!payments.length) {
            history.appendChild(createElement('p', 'tenant-history-empty', 'This tenant has not paid any rent yet, so there is nothing in the payment ledger.'));
        } else {
            const list = createElement('ul', 'tenant-history-list');

            payments.forEach((payment) => {
                const item = createElement('li', 'tenant-history-item');
                const left = createElement('div', 'tenant-history-left');
                left.append(
                    createElement('strong', '', payment.period),
                    createElement('small', '', `Paid ${formatDate(payment.paidOn)} · ${payment.method || 'method not recorded'}`),
                    createElement('small', '', `Payer number: ${payment.payerPhone || payment.tenantPhone || 'Not recorded'}`)
                );
                const right = createElement('div', 'tenant-history-right');
                right.append(
                    createElement('strong', '', formatCurrency(payment.paidAmount)),
                    createElement('small', '', payment.status)
                );
                item.append(left, right);
                list.appendChild(item);
            });

            history.appendChild(list);
        }

        elements.profileContent.replaceChildren(details, history);
        elements.profileTitle.textContent = tenant.fullName;
    };

    const openProfile = async (tenantId) => {
        const tenant = state.tenants.find((item) => item.id === tenantId);

        if (!tenant) {
            return;
        }

        state.profileId = tenantId;
        elements.profileContent.replaceChildren(createElement('p', 'tenant-history-empty', 'Loading tenant details…'));
        openDialog(elements.profileDialog);

        try {
            const data = await api(`/api/tenants/${encodeURIComponent(tenantId)}`);
            renderProfile(data.tenant, data.payments);
        } catch (error) {
            closeDialog(elements.profileDialog);
            notify(error.message);
        }
    };

    /* ---- record a payment ---- */

    const openPaymentForm = (tenant) => {
        if (!tenant) {
            return;
        }

        state.payingId = tenant.id;
        showFormError(elements.paymentError, '');

        populatePropertySelect(elements.paymentProperty, tenant.propertyId);
        elements.paymentProperty.value = tenant.propertyId || '';

        const property = getPropertyById(tenant.propertyId);
        const rent = Number(tenant.monthlyRent) || Number(property?.monthlyRent) || 0;

        elements.paymentUnit.value = tenant.unit || '';
        elements.paymentMethod.value = 'Mobile Money';
        elements.paymentPayerPhone.value = tenant.phone || '';
        elements.paymentPeriod.replaceChildren();

        buildPeriodOptions().forEach((option) => {
            const node = createElement('option', '', option.label);
            node.value = option.monthKey;
            elements.paymentPeriod.appendChild(node);
        });

        elements.paymentAmount.value = rent || '';
        elements.paymentAmount.max = String(rent || 0);
        elements.paymentSummary.textContent = `${tenant.fullName} · full rent is ${formatCurrency(rent)}`;
        elements.paymentTitle.textContent = `Record a payment from ${tenant.fullName}`;

        closeDialog(elements.profileDialog);
        openDialog(elements.paymentDialog);
        elements.paymentAmount.focus();
    };

    const handlePaymentSubmit = async (event) => {
        event.preventDefault();
        showFormError(elements.paymentError, '');

        const property = getPropertyById(elements.paymentProperty.value);
        const rent = Number(property?.monthlyRent) || 0;
        const amount = Number(elements.paymentAmount.value);

        if (!rent) {
            showFormError(elements.paymentError, 'Choose a property to see the rent for this unit.');
            return;
        }

        if (!elements.paymentUnit.value.trim()) {
            showFormError(elements.paymentError, 'Enter the unit or house number the rent was paid for.');
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            showFormError(elements.paymentError, 'Enter the amount of money you received.');
            return;
        }

        if (amount > rent) {
            showFormError(elements.paymentError, `The full rent is ${formatCurrency(rent)}.`);
            return;
        }

        const tenant = state.tenants.find((item) => item.id === state.payingId);

        try {
            const result = await api(`/api/tenants/${encodeURIComponent(state.payingId)}/payments`, {
                method: 'POST',
                body: {
                    propertyId: elements.paymentProperty.value,
                    unit: elements.paymentUnit.value.trim(),
                    periodKey: elements.paymentPeriod.value,
                    method: elements.paymentMethod.value,
                    payerPhone: elements.paymentPayerPhone.value.trim(),
                    amount
                }
            });

            closeDialog(elements.paymentDialog);
            notify(`${result.message} ${formatCurrency(amount)} recorded${tenant ? ` for ${tenant.fullName}` : ''}.`);
            await reload();
            announceChange();
        } catch (error) {
            showFormError(elements.paymentError, error.message);
        }
    };

    /* ---- delete ---- */

    const openDeleteConfirm = (tenant) => {
        state.deletingId = tenant.id;
        elements.deleteMessage.textContent = `Remove ${tenant.fullName} from your tenant list?`;
        elements.deleteTitle.textContent = `Remove ${tenant.fullName}`;
        openDialog(elements.deleteDialog);
    };

    const handleDelete = async () => {
        elements.confirmDelete.disabled = true;

        try {
            const result = await api(`/api/tenants/${encodeURIComponent(state.deletingId)}`, { method: 'DELETE' });
            closeDialog(elements.deleteDialog);
            notify(result.keptPayments
                ? `${result.message} ${result.keptPayments} payment record${result.keptPayments === 1 ? '' : 's'} kept.`
                : result.message);
            await reload();
            announceChange();
        } catch (error) {
            closeDialog(elements.deleteDialog);
            notify(error.message);
        } finally {
            elements.confirmDelete.disabled = false;
        }
    };

    /* ---- export ---- */

    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    const exportTenants = () => {
        const visible = getFilteredTenants();

        if (!visible.length) {
            notify('There are no tenants to export with these filters.');
            return;
        }

        const headers = ['Tenant', 'Email', 'Phone', 'Property', 'Location', 'Unit', 'Monthly rent', 'Status', 'Payments made', 'Total paid', 'Outstanding', 'Last payment', 'Payment status', 'Added from'];
        const rows = visible.map((tenant) => [
            tenant.fullName,
            tenant.email,
            tenant.phone,
            tenant.propertyName,
            tenant.location,
            tenant.unit,
            tenant.monthlyRent,
            tenant.status,
            tenant.paymentCount,
            tenant.totalPaid,
            tenant.outstanding,
            tenant.lastPaymentOn || '',
            getPaymentState(tenant).label,
            tenant.source || 'admin'
        ]);

        const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = `estatepro-tenants-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify(`${visible.length} tenant${visible.length === 1 ? '' : 's'} exported.`);
    };

    /* ---- one-time move of accounts made in the older browser-only build ---- */

    const readBrowserTenantAccounts = () => {
        try {
            const stored = window.localStorage.getItem('estateproAccounts');
            const legacy = window.localStorage.getItem('estateproUser');
            const parsed = stored ? JSON.parse(stored) : null;
            const accounts = Array.isArray(parsed) ? parsed : legacy ? [JSON.parse(legacy)] : [];

            return accounts.filter((account) => account && account.accountType === 'tenant' && (account.fullName || account.email));
        } catch (error) {
            return [];
        }
    };

    const importBrowserAccounts = async () => {
        let alreadyImported = false;

        try {
            alreadyImported = window.localStorage.getItem(IMPORT_FLAG) === 'done';
        } catch (error) {
            alreadyImported = false;
        }

        if (alreadyImported) {
            return;
        }

        try {
            window.localStorage.setItem(IMPORT_FLAG, 'done');
        } catch (error) {
            // A blocked storage area just means the import may run again.
        }

        const accounts = readBrowserTenantAccounts();

        if (!accounts.length) {
            return;
        }

        try {
            const result = await api('/api/tenants/import', { method: 'POST', body: { accounts } });

            if (result.imported) {
                notify(`Moved ${result.imported} browser account${result.imported === 1 ? '' : 's'} into your tenant list. Check the property and unit on each one.`);
                await reload();
            }
        } catch (error) {
            // An import problem must never stop the dashboard from loading.
        }
    };

    /* ---- wiring ---- */

    const updateFilters = () => {
        state.filters.search = elements.search.value;
        state.filters.property = elements.propertyFilter.value;
        state.filters.payment = elements.paymentFilter.value;
        renderTenants();
    };

    const resetFilters = () => {
        elements.search.value = '';
        elements.propertyFilter.value = '';
        elements.paymentFilter.value = 'all';
        updateFilters();
    };

    elements.body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-tenant-action]');

        if (!button) {
            return;
        }

        const tenant = state.tenants.find((item) => item.id === button.dataset.tenantId);

        if (!tenant) {
            return;
        }

        if (button.dataset.tenantAction === 'view') {
            openProfile(tenant.id);
            return;
        }

        if (button.dataset.tenantAction === 'pay') {
            openPaymentForm(tenant);
            return;
        }

        if (button.dataset.tenantAction === 'edit') {
            closeDialog(elements.profileDialog);
            openTenantForm(tenant);
            return;
        }

        openDeleteConfirm(tenant);
    });

    elements.addTenant.addEventListener('click', () => openTenantForm());
    elements.exportTenants.addEventListener('click', exportTenants);
    elements.search.addEventListener('input', updateFilters);
    elements.propertyFilter.addEventListener('change', updateFilters);
    elements.paymentFilter.addEventListener('change', updateFilters);
    elements.resetFilters.addEventListener('click', resetFilters);
    elements.form.addEventListener('submit', handleTenantSubmit);
    elements.cancel.addEventListener('click', () => closeDialog(elements.dialog));
    elements.close.addEventListener('click', () => closeDialog(elements.dialog));
    elements.property.addEventListener('change', () => {
        const property = getPropertyById(elements.property.value);

        if (property) {
            elements.rent.value = property.monthlyRent;
        }
    });
    elements.closeProfile.addEventListener('click', () => closeDialog(elements.profileDialog));
    elements.profileEdit.addEventListener('click', () => {
        const tenant = state.tenants.find((item) => item.id === state.profileId);

        closeDialog(elements.profileDialog);

        if (tenant) {
            openTenantForm(tenant);
        }
    });
    elements.profileRecordPayment.addEventListener('click', () => {
        openPaymentForm(state.tenants.find((item) => item.id === state.profileId));
    });
    elements.closePayment.addEventListener('click', () => closeDialog(elements.paymentDialog));
    elements.cancelPayment.addEventListener('click', () => closeDialog(elements.paymentDialog));
    elements.paymentForm.addEventListener('submit', handlePaymentSubmit);
    elements.closeDelete.addEventListener('click', () => closeDialog(elements.deleteDialog));
    elements.cancelDelete.addEventListener('click', () => closeDialog(elements.deleteDialog));
    elements.confirmDelete.addEventListener('click', handleDelete);

    [elements.dialog, elements.profileDialog, elements.paymentDialog, elements.deleteDialog].forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                closeDialog(dialog);
            }
        });
    });

    document.addEventListener('estatepro:refresh-tenants', reload);

    const start = async () => {
        if (window.location.protocol === 'file:') {
            showUnavailable('Tenant records are only available through the EstatePro server. Open http://localhost:3000/dashboard.html and sign in as the landlord.');
            return;
        }

        try {
            await loadProperties();
            await loadTenants();
        } catch (error) {
            if (!String(error.message).includes('admin session')) {
                showUnavailable('Your tenants could not be loaded. Check that the EstatePro server is running, then refresh this page.');
                notify(error.message);
            }

            return;
        }

        await importBrowserAccounts();
    };

    start();
})();
