(() => {
    'use strict';

    const section = document.querySelector('#expenses');

    if (!section) {
        return;
    }

    const dayFormatter = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
    const numberFormatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    /* Shown until the server answers with its own list, so the dialog is never
       empty. The server list is the source of truth once it arrives. */
    const DEFAULT_CATEGORIES = [
        'Repairs & maintenance',
        'Utilities',
        'Management fees',
        'Insurance',
        'Property tax',
        'Security',
        'Cleaning',
        'Supplies',
        'Marketing',
        'Other'
    ];
    const DEFAULT_METHODS = ['Cash', 'M-Pesa', 'Bank Transfer', 'Card', 'Cheque', 'Other'];

    const elements = {
        monthTotal: document.querySelector('#expense-month-total'),
        monthNote: document.querySelector('#expense-month-note'),
        collected: document.querySelector('#expense-collected'),
        collectedNote: document.querySelector('#expense-collected-note'),
        net: document.querySelector('#expense-net'),
        netNote: document.querySelector('#expense-net-note'),
        yearTotal: document.querySelector('#expense-year-total'),
        yearNote: document.querySelector('#expense-year-note'),
        search: document.querySelector('#expense-search'),
        propertyFilter: document.querySelector('#expense-property-filter'),
        categoryFilter: document.querySelector('#expense-category-filter'),
        monthFilter: document.querySelector('#expense-month-filter'),
        resetFilters: document.querySelector('#reset-expense-filters'),
        count: document.querySelector('#expense-count'),
        body: document.querySelector('#expenses-body'),
        empty: document.querySelector('#expenses-empty'),
        emptyTitle: document.querySelector('#expenses-empty-title'),
        emptyText: document.querySelector('#expenses-empty-text'),
        breakdown: document.querySelector('#expense-breakdown'),
        breakdownScope: document.querySelector('#expense-breakdown-scope'),
        trendBody: document.querySelector('#expense-trend-body'),
        addButton: document.querySelector('#add-expense'),
        exportButton: document.querySelector('#export-expenses'),
        dialog: document.querySelector('#expense-dialog'),
        dialogTitle: document.querySelector('#expense-dialog-title'),
        form: document.querySelector('#expense-form'),
        formError: document.querySelector('#expense-form-error'),
        id: document.querySelector('#expense-id'),
        formProperty: document.querySelector('#expense-property'),
        formCategory: document.querySelector('#expense-category'),
        formDescription: document.querySelector('#expense-description'),
        formVendor: document.querySelector('#expense-vendor'),
        formAmount: document.querySelector('#expense-amount'),
        formDate: document.querySelector('#expense-date'),
        formMethod: document.querySelector('#expense-method'),
        formNotes: document.querySelector('#expense-notes'),
        save: document.querySelector('#save-expense'),
        cancel: document.querySelector('#cancel-expense'),
        close: document.querySelector('#close-expense-dialog'),
        deleteDialog: document.querySelector('#expense-delete-dialog'),
        deleteMessage: document.querySelector('#expense-delete-message'),
        confirmDelete: document.querySelector('#confirm-expense-delete'),
        cancelDelete: document.querySelector('#cancel-expense-delete'),
        closeDelete: document.querySelector('#close-expense-delete')
    };

    const state = {
        expenses: [],
        totals: {},
        byCategory: [],
        months: [],
        properties: [],
        categories: DEFAULT_CATEGORIES.slice(),
        methods: DEFAULT_METHODS.slice(),
        filters: { search: '', property: '', category: '', month: '' },
        editingId: '',
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

    const numberOr = (value, fallback) => {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const formatCurrency = (value) => `KSh ${numberFormatter.format(Math.max(0, Number(value) || 0))}`;

    /* Net income can be negative, so it needs its own formatter rather than the
       clamp-to-zero one the collection figures use. */
    const formatSignedCurrency = (value) => {
        const amount = Math.round(Number(value) || 0);
        const sign = amount < 0 ? '−' : '';

        return `${sign}KSh ${numberFormatter.format(Math.abs(amount))}`;
    };

    const formatDate = (dateString) => {
        if (!dateString) {
            return '—';
        }

        const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);

        return Number.isNaN(date.getTime()) ? String(dateString) : dayFormatter.format(date);
    };

    const slugify = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const monthKeyNow = () => {
        const now = new Date();

        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    };

    const labelForMonthKey = (monthKey) => {
        const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);

        if (!match) {
            return String(monthKey || '');
        }

        return `${monthNames[Number(match[2]) - 1] || 'Current'} ${match[1]}`;
    };

    const todayValue = () => {
        const now = new Date();

        return [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')
        ].join('-');
    };

    const notify = (message) => {
        document.dispatchEvent(new CustomEvent('estatepro:notify', { detail: { message } }));
    };

    const redirectToSignIn = () => {
        window.location.replace(`admin-login.html?next=${encodeURIComponent('/dashboard.html#expenses')}&reason=expired`);
    };

    const requestJson = async (url, options = {}) => {
        if (window.location.protocol === 'file:') {
            return { ok: false, status: 0, data: { error: 'Start the EstatePro server and open the dashboard at http://localhost:3000/dashboard.html.' } };
        }

        let response;

        try {
            response = await fetch(url, {
                credentials: 'same-origin',
                ...options,
                headers: { Accept: 'application/json', ...(options.headers || {}) }
            });
        } catch (error) {
            return { ok: false, status: 0, data: { error: 'The EstatePro server could not be reached. Make sure it is still running, then try again.' } };
        }

        if (response.status === 401) {
            redirectToSignIn();
            return { ok: false, status: 401, data: { error: 'Your admin session has ended.' } };
        }

        let data = {};

        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        return { ok: response.ok, status: response.status, data };
    };

    const setFormError = (message) => {
        if (!elements.formError) {
            return;
        }

        elements.formError.textContent = message;
        elements.formError.hidden = !message;
    };

    const buildQuery = () => {
        const params = new URLSearchParams();

        if (state.filters.property) {
            params.set('property', state.filters.property);
        }

        if (state.filters.category) {
            params.set('category', state.filters.category);
        }

        if (state.filters.month) {
            params.set('month', state.filters.month);
        }

        if (state.filters.search) {
            params.set('q', state.filters.search);
        }

        return params.toString();
    };

    const fillSelect = (select, options, { placeholder, value } = {}) => {
        if (!select) {
            return;
        }

        const previous = value !== undefined ? value : select.value;

        select.replaceChildren();

        if (placeholder) {
            const option = document.createElement('option');

            option.value = '';
            option.textContent = placeholder;
            select.appendChild(option);
        }

        options.forEach((entry) => {
            const option = document.createElement('option');
            const optionValue = typeof entry === 'string' ? entry : entry.value;
            const optionLabel = typeof entry === 'string' ? entry : entry.label;

            option.value = optionValue;
            option.textContent = optionLabel;
            select.appendChild(option);
        });

        if (previous && [...select.options].some((option) => option.value === previous)) {
            select.value = previous;
        }
    };

    const populateFilters = () => {
        fillSelect(elements.propertyFilter, state.properties.map((property) => ({ value: property.id, label: property.name })), {
            placeholder: 'All properties'
        });

        fillSelect(elements.categoryFilter, state.categories, { placeholder: 'All categories' });

        const months = [];
        const now = new Date();

        for (let index = 0; index < 12; index += 1) {
            const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            months.push({ value: key, label: `${monthNames[date.getMonth()]} ${date.getFullYear()}` });
        }

        /* A month the landlord has filtered to is kept even if it sits outside
           the last twelve, so a deep link or a stale filter never blanks out. */
        if (state.filters.month && !months.some((month) => month.value === state.filters.month)) {
            months.unshift({ value: state.filters.month, label: labelForMonthKey(state.filters.month) });
        }

        fillSelect(elements.monthFilter, months, { value: state.filters.month });

        fillSelect(elements.formProperty, state.properties.map((property) => ({ value: property.id, label: property.name })), {
            placeholder: 'Choose a property'
        });
        fillSelect(elements.formCategory, state.categories);
        fillSelect(elements.formMethod, [{ value: '', label: 'Not recorded' }, ...state.methods]);
    };

    const renderStats = () => {
        const totals = state.totals || {};
        const net = numberOr(totals.netIncome, 0);

        elements.monthTotal.textContent = formatCurrency(totals.expenseTotal);
        elements.monthNote.textContent = totals.expenseCount
            ? `${totals.expenseCount} expense${totals.expenseCount === 1 ? '' : 's'} in ${totals.monthLabel || 'the month'}`
            : `No expenses in ${totals.monthLabel || 'the month'}`;

        elements.collected.textContent = formatCurrency(totals.collected);
        elements.collectedNote.textContent = `Rent collected in ${totals.monthLabel || 'the month'}`;

        elements.net.textContent = formatSignedCurrency(net);
        elements.net.classList.toggle('is-negative', net < 0);
        elements.netNote.textContent = net < 0 ? 'Spending is ahead of rent collected' : 'Collected less expenses';

        elements.yearTotal.textContent = formatCurrency(totals.yearExpense);
        elements.yearNote.textContent = `Year to date (${(totals.month || '').slice(0, 4) || 'this year'})`;
    };

    const createCategoryBadge = (category) => createElement('span', `status-badge ${slugify(category)}`, category);

    const buildExpenseRow = (item) => {
        const row = document.createElement('tr');
        row.dataset.expenseId = item.id;

        const dateCell = createElement('td', '', formatDate(item.expenseDate));

        const propertyCell = document.createElement('td');
        propertyCell.append(
            createElement('span', 'cell-primary', item.propertyName || 'Unknown property'),
            createElement('small', 'cell-subline', item.method || 'Not recorded')
        );

        const categoryCell = document.createElement('td');
        categoryCell.append(createCategoryBadge(item.category));

        const descriptionCell = document.createElement('td');
        descriptionCell.append(createElement('span', 'cell-primary', item.description));

        const vendorCell = createElement('td', '', item.vendor || '—');
        const amountCell = createElement('td', 'expense-amount', formatCurrency(item.amount));

        const actionsCell = document.createElement('td');
        const editButton = createElement('button', 'table-action-btn', 'Edit');

        editButton.type = 'button';
        editButton.dataset.action = 'edit';
        editButton.dataset.expenseId = item.id;
        editButton.setAttribute('aria-label', `Edit the expense ${item.description}`);

        const deleteButton = createElement('button', 'table-action-link', 'Delete');

        deleteButton.type = 'button';
        deleteButton.dataset.action = 'delete';
        deleteButton.dataset.expenseId = item.id;
        deleteButton.setAttribute('aria-label', `Remove the expense ${item.description}`);

        actionsCell.append(editButton, deleteButton);

        row.append(dateCell, propertyCell, categoryCell, descriptionCell, vendorCell, amountCell, actionsCell);

        return row;
    };

    const renderExpenses = () => {
        const listed = state.expenses;
        const isFiltered = Boolean(state.filters.search || state.filters.property || state.filters.category);

        elements.body.replaceChildren();

        if (!listed.length) {
            elements.empty.hidden = false;
            elements.emptyTitle.textContent = isFiltered
                ? 'No expenses match these filters'
                : 'No expenses recorded yet';
            elements.emptyText.textContent = isFiltered
                ? 'Try a different property, category or search term.'
                : 'Add the money you spend on repairs, utilities and other running costs to see your net income.';
        } else {
            elements.empty.hidden = true;
            listed.forEach((item) => elements.body.appendChild(buildExpenseRow(item)));
        }

        const total = numberOr(state.totals?.expenseCount, listed.length);

        elements.count.textContent = isFiltered
            ? `Showing ${listed.length} of ${numberOr(state.counts?.all, listed.length)} recorded expense${numberOr(state.counts?.all, listed.length) === 1 ? '' : 's'}`
            : `${listed.length} expense${listed.length === 1 ? '' : 's'} in ${state.totals?.monthLabel || 'this view'}`;

        elements.breakdownScope.textContent = state.totals?.monthLabel
            ? `For ${state.totals.monthLabel}.`
            : 'For the selected month.';
    };

    const renderBreakdown = () => {
        elements.breakdown.replaceChildren();

        const rows = state.byCategory || [];

        if (!rows.length) {
            elements.breakdown.appendChild(createElement('p', 'chart-empty', 'No expenses recorded for this month.'));
            return;
        }

        const largest = rows.reduce((max, row) => Math.max(max, row.total), 0) || 1;

        rows.forEach((row) => {
            const item = createElement('article', 'property-performance-item');
            const head = createElement('div', 'property-performance-head');
            const nameGroup = createElement('div');
            const progress = createElement('div', 'property-progress');
            const progressBar = createElement('span');
            const meta = createElement('div', 'property-performance-meta');

            nameGroup.append(
                createElement('strong', '', row.category),
                createElement('small', '', `${row.count} expense${row.count === 1 ? '' : 's'}`)
            );

            progressBar.style.width = `${Math.round((row.total / largest) * 100)}%`;
            progress.appendChild(progressBar);

            meta.append(
                createElement('span', '', formatCurrency(row.total)),
                createElement('span', '', `${Math.round((row.total / (state.totals?.expenseTotal || largest)) * 100)}% of spend`)
            );

            head.append(nameGroup);
            item.append(head, progress, meta);
            elements.breakdown.appendChild(item);
        });
    };

    const renderTrend = () => {
        elements.trendBody.replaceChildren();

        const rows = state.months || [];

        if (!rows.length) {
            const row = document.createElement('tr');
            const cell = createElement('td', 'chart-empty', 'No monthly figures yet.');

            cell.colSpan = 4;
            row.appendChild(cell);
            elements.trendBody.appendChild(row);
            return;
        }

        rows.forEach((month) => {
            const row = document.createElement('tr');
            const netCell = createElement('td', month.net < 0 ? 'expense-amount is-negative' : 'expense-amount', formatSignedCurrency(month.net));

            row.append(
                createElement('td', '', month.label),
                createElement('td', '', formatCurrency(month.collected)),
                createElement('td', '', formatCurrency(month.expenses)),
                netCell
            );

            elements.trendBody.appendChild(row);
        });
    };

    const loadPropertyOptions = async () => {
        if (state.properties.length) {
            return;
        }

        const { ok, data } = await requestJson('/api/properties').catch(() => ({ ok: false, data: [] }));

        if (ok && Array.isArray(data)) {
            state.properties = data.map((property) => ({ id: property.id, name: property.name }));
            populateFilters();
        }
    };

    const load = async () => {
        elements.count.textContent = 'Loading expenses…';

        const { ok, data } = await requestJson(`/api/expenses?${buildQuery()}`).catch(() => ({
            ok: false,
            status: 0,
            data: { error: 'The expense list could not be loaded.' }
        }));

        if (!ok) {
            elements.count.textContent = data.error || 'The expense list could not be loaded.';
            state.expenses = [];
            state.totals = {};
            state.byCategory = [];
            state.months = [];
            renderStats();
            renderExpenses();
            renderBreakdown();
            renderTrend();
            return;
        }

        state.expenses = Array.isArray(data.expenses) ? data.expenses : [];
        state.totals = data.totals || {};
        state.byCategory = Array.isArray(data.byCategory) ? data.byCategory : [];
        state.months = Array.isArray(data.months) ? data.months : [];

        if (Array.isArray(data.categories) && data.categories.length) {
            state.categories = data.categories;
        }

        if (Array.isArray(data.methods) && data.methods.length) {
            state.methods = data.methods;
        }

        renderStats();
        renderExpenses();
        renderBreakdown();
        renderTrend();
    };

    const openCreateDialog = () => {
        state.editingId = '';
        elements.dialogTitle.textContent = 'Add an expense';
        elements.form.reset();
        elements.id.value = '';
        elements.formProperty.value = state.filters.property || '';
        elements.formCategory.value = state.categories[0] || 'Other';
        elements.formMethod.value = '';
        elements.formDate.value = todayValue();
        setFormError('');
        elements.dialog.showModal();
        elements.formProperty.focus();
    };

    const openEditDialog = (item) => {
        state.editingId = item.id;
        elements.dialogTitle.textContent = 'Edit expense';
        elements.form.reset();
        elements.id.value = item.id;
        elements.formProperty.value = item.propertyId || '';
        elements.formCategory.value = item.category || 'Other';
        elements.formDescription.value = item.description || '';
        elements.formVendor.value = item.vendor || '';
        elements.formAmount.value = item.amount || '';
        elements.formDate.value = String(item.expenseDate || '').slice(0, 10);
        elements.formMethod.value = item.method || '';
        elements.formNotes.value = item.notes || '';
        setFormError('');
        elements.dialog.showModal();
        elements.formDescription.focus();
    };

    const closeDialog = () => {
        state.editingId = '';

        if (elements.dialog.open) {
            elements.dialog.close();
        }
    };

    const openDeleteDialog = (item) => {
        state.deletingId = item.id;
        elements.deleteMessage.textContent = `Remove "${item.description}" (${formatCurrency(item.amount)})?`;
        elements.deleteDialog.showModal();
    };

    const closeDeleteDialog = () => {
        state.deletingId = '';

        if (elements.deleteDialog.open) {
            elements.deleteDialog.close();
        }
    };

    const exportCsv = () => {
        if (!state.expenses.length) {
            notify('There are no expenses in this view to export.');
            return;
        }

        const escapeCell = (value) => `"${String(value === undefined || value === null ? '' : value).replace(/"/g, '""')}"`;
        const rows = [
            ['Date', 'Property', 'Category', 'Description', 'Payee', 'Amount (KSh)', 'Paid with', 'Notes']
        ];

        state.expenses.forEach((item) => {
            rows.push([
                String(item.expenseDate || '').slice(0, 10),
                item.propertyName || '',
                item.category || '',
                item.description || '',
                item.vendor || '',
                item.amount || 0,
                item.method || '',
                item.notes || ''
            ]);
        });

        const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const monthPart = state.filters.month || 'all';

        link.href = url;
        link.download = `estatepro-expenses-${monthPart}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        notify('Expense CSV downloaded.');
    };

    elements.body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action][data-expense-id]');

        if (!button) {
            return;
        }

        const item = state.expenses.find((entry) => entry.id === button.dataset.expenseId);

        if (!item) {
            return;
        }

        if (button.dataset.action === 'edit') {
            openEditDialog(item);
        } else if (button.dataset.action === 'delete') {
            openDeleteDialog(item);
        }
    });

    elements.form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormError('');

        const payload = {
            propertyId: elements.formProperty.value,
            category: elements.formCategory.value,
            description: elements.formDescription.value.trim(),
            vendor: elements.formVendor.value.trim(),
            amount: elements.formAmount.value,
            expenseDate: elements.formDate.value,
            method: elements.formMethod.value,
            notes: elements.formNotes.value.trim()
        };

        if (!payload.propertyId) {
            setFormError('Choose the property this expense belongs to.');
            return;
        }

        if (!payload.description) {
            setFormError('Add a short description of what the expense was for.');
            return;
        }

        if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
            setFormError('Enter the amount you spent, as a number greater than zero.');
            return;
        }

        if (!payload.expenseDate) {
            setFormError('Choose the date the money was spent.');
            return;
        }

        const editing = Boolean(state.editingId);

        elements.save.disabled = true;
        elements.save.textContent = 'Saving…';

        try {
            const url = editing ? `/api/expenses/${encodeURIComponent(state.editingId)}` : '/api/expenses';
            const { ok, data } = await requestJson(url, {
                method: editing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!ok) {
                setFormError(data.error || 'The expense could not be saved.');
                return;
            }

            closeDialog();
            notify(data.message || (editing ? 'Expense updated.' : 'Expense recorded.'));
            await load();
        } catch (error) {
            setFormError('The expense service could not be reached. Try again.');
        } finally {
            elements.save.disabled = false;
            elements.save.textContent = 'Save expense';
        }
    });

    elements.confirmDelete.addEventListener('click', async () => {
        if (!state.deletingId) {
            return;
        }

        elements.confirmDelete.disabled = true;
        elements.confirmDelete.textContent = 'Removing…';

        try {
            const { ok, data } = await requestJson(`/api/expenses/${encodeURIComponent(state.deletingId)}`, {
                method: 'DELETE'
            });

            if (!ok) {
                notify(data.error || 'The expense could not be removed.');
                return;
            }

            closeDeleteDialog();
            notify(data.message || 'Expense removed.');
            await load();
        } catch (error) {
            notify('The expense service could not be reached. Try again.');
        } finally {
            elements.confirmDelete.disabled = false;
            elements.confirmDelete.textContent = 'Remove expense';
        }
    });

    elements.addButton.addEventListener('click', openCreateDialog);
    elements.exportButton.addEventListener('click', exportCsv);
    elements.cancel.addEventListener('click', closeDialog);
    elements.close.addEventListener('click', closeDialog);
    elements.cancelDelete.addEventListener('click', closeDeleteDialog);
    elements.closeDelete.addEventListener('click', closeDeleteDialog);

    let searchTimer = null;

    elements.search.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            state.filters.search = elements.search.value.trim();
            load();
        }, 250);
    });

    elements.propertyFilter.addEventListener('change', () => {
        state.filters.property = elements.propertyFilter.value;
        load();
    });

    elements.categoryFilter.addEventListener('change', () => {
        state.filters.category = elements.categoryFilter.value;
        load();
    });

    elements.monthFilter.addEventListener('change', () => {
        state.filters.month = elements.monthFilter.value;
        load();
    });

    elements.resetFilters.addEventListener('click', () => {
        state.filters = { search: '', property: '', category: '', month: monthKeyNow() };
        elements.search.value = '';
        elements.monthFilter.value = state.filters.month;
        elements.propertyFilter.value = '';
        elements.categoryFilter.value = '';
        load();
    });

    /* The expense panel reads the same properties as the rest of the dashboard,
       so it waits for the shared load to settle before it fills its selects. */
    state.filters.month = monthKeyNow();
    populateFilters();
    (async () => {
        await loadPropertyOptions();
        await load();
    })();
})();
