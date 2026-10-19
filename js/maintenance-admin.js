(() => {
    'use strict';

    const section = document.querySelector('#maintenance');

    if (!section) {
        return;
    }

    const dayFormatter = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

    const elements = {
        open: document.querySelector('#maintenance-open'),
        openNote: document.querySelector('#maintenance-open-note'),
        inProgress: document.querySelector('#maintenance-progress'),
        emergency: document.querySelector('#maintenance-emergency'),
        emergencyNote: document.querySelector('#maintenance-emergency-note'),
        resolved: document.querySelector('#maintenance-resolved'),
        search: document.querySelector('#maintenance-search'),
        statusFilter: document.querySelector('#maintenance-status-filter'),
        propertyFilter: document.querySelector('#maintenance-property-filter'),
        resetFilters: document.querySelector('#reset-maintenance-filters'),
        count: document.querySelector('#maintenance-count'),
        body: document.querySelector('#maintenance-body'),
        empty: document.querySelector('#maintenance-empty'),
        emptyTitle: document.querySelector('#maintenance-empty-title'),
        emptyText: document.querySelector('#maintenance-empty-text'),
        dialog: document.querySelector('#maintenance-dialog'),
        dialogTitle: document.querySelector('#maintenance-dialog-title'),
        dialogContent: document.querySelector('#maintenance-dialog-content'),
        form: document.querySelector('#maintenance-form'),
        formError: document.querySelector('#maintenance-form-error'),
        id: document.querySelector('#maintenance-id'),
        formStatus: document.querySelector('#maintenance-form-status'),
        formNotes: document.querySelector('#maintenance-form-notes'),
        save: document.querySelector('#save-maintenance'),
        cancel: document.querySelector('#cancel-maintenance'),
        close: document.querySelector('#close-maintenance-dialog')
    };

    const state = {
        requests: [],
        counts: {},
        properties: [],
        filters: { search: '', status: 'all', property: '' },
        editingId: ''
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

    const formatDate = (dateString) => {
        if (!dateString) {
            return '—';
        }

        const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);

        return Number.isNaN(date.getTime()) ? String(dateString) : dayFormatter.format(date);
    };

    /* Shares the dashboard toast so both admin panels report the same way. */
    const notify = (message) => {
        document.dispatchEvent(new CustomEvent('estatepro:notify', { detail: { message } }));
    };

    const redirectToSignIn = () => {
        window.location.replace(`admin-login.html?next=${encodeURIComponent('/dashboard.html#maintenance')}&reason=expired`);
    };

    const requestJson = async (url, options = {}) => {
        if (window.location.protocol === 'file:') {
            return { ok: false, status: 0, data: { error: 'Start the EstatePro server and open the dashboard at http://localhost:3000/dashboard.html.' } };
        }

        let response;

        try {
            /* options is spread first so the caller's headers merge with ours
               instead of replacing them. */
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

    /* The server does the filtering, so the table always matches the ledger. */
    const buildQuery = () => {
        const params = new URLSearchParams();

        if (state.filters.status && state.filters.status !== 'all') {
            params.set('status', state.filters.status);
        }

        if (state.filters.property) {
            params.set('property', state.filters.property);
        }

        if (state.filters.search) {
            params.set('q', state.filters.search);
        }

        return params.toString();
    };

    const renderStats = () => {
        const counts = state.counts || {};

        elements.open.textContent = numberOr(counts.open, 0);
        elements.inProgress.textContent = numberOr(counts.inProgress, 0);
        elements.resolved.textContent = numberOr(counts.resolved, 0);

        const emergency = numberOr(counts.emergency, 0);

        elements.emergency.textContent = emergency;

        elements.openNote.textContent = emergency
            ? `${emergency} emergency ${emergency === 1 ? 'request needs' : 'requests need'} attention`
            : 'Waiting to be started';
        elements.emergencyNote.textContent = emergency
            ? 'Not yet resolved'
            : 'No emergencies open';
    };

    const numberOr = (value, fallback) => {
        const parsed = Number(value);

        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const createStatusBadge = (status) => {
        const slug = String(status || '').toLowerCase().replace(/[^a-z]+/g, '-');

        return createElement('span', `status-badge ${slug}`, status);
    };

    const createUrgencyBadge = (urgency) => {
        const slug = String(urgency || '').toLowerCase().replace(/[^a-z]+/g, '-');

        return createElement('span', `urgency-badge ${slug}`, urgency);
    };

    const buildRequestRow = (item) => {
        const row = document.createElement('tr');
        row.dataset.requestId = item.id;

        const requestCell = document.createElement('td');
        const title = createElement('strong', '', item.title);
        const category = createElement('small', 'cell-subline', item.category);
        requestCell.append(title, category);

        const tenantCell = document.createElement('td');
        tenantCell.append(
            createElement('span', 'cell-primary', item.tenantName),
            createElement('small', 'cell-subline', item.unit ? `Unit ${item.unit}` : item.tenantEmail)
        );

        const propertyCell = document.createElement('td');
        propertyCell.append(
            createElement('span', 'cell-primary', item.propertyName || 'Unknown property'),
            createElement('small', 'cell-subline', item.propertyId || '')
        );

        const urgencyCell = document.createElement('td');
        urgencyCell.append(createUrgencyBadge(item.urgency));

        const raisedCell = createElement('td', '', formatDate(item.createdAt));
        const statusCell = document.createElement('td');
        statusCell.append(createStatusBadge(item.status));

        const actionsCell = document.createElement('td');
        const viewButton = createElement('button', 'table-action-btn', 'Manage');
        viewButton.type = 'button';
        viewButton.dataset.action = 'manage';
        viewButton.dataset.requestId = item.id;
        viewButton.setAttribute('aria-label', `Manage the request ${item.title}`);
        actionsCell.append(viewButton);

        row.append(
            requestCell,
            tenantCell,
            propertyCell,
            urgencyCell,
            raisedCell,
            statusCell,
            actionsCell
        );

        return row;
    };

    const renderRequests = () => {
        const listed = state.requests;
        const isFiltered = Boolean(state.filters.search || state.filters.property || state.filters.status !== 'all');

        elements.body.replaceChildren();

        if (!listed.length) {
            elements.empty.hidden = false;
            elements.emptyTitle.textContent = isFiltered
                ? 'No maintenance requests match these filters'
                : 'No maintenance requests yet';
            elements.emptyText.textContent = isFiltered
                ? 'Try a different property, status or search term.'
                : 'Requests raised by tenants will appear here.';
        } else {
            elements.empty.hidden = true;
            listed.forEach((item) => elements.body.appendChild(buildRequestRow(item)));
        }

        const total = numberOr(state.counts?.all, listed.length);

        elements.count.textContent = isFiltered
            ? `Showing ${listed.length} of ${total} request${total === 1 ? '' : 's'}`
            : `${total} request${total === 1 ? '' : 's'} from tenants`;
    };

    const populatePropertyOptions = () => {
        const currentValue = elements.propertyFilter.value;

        elements.propertyFilter.replaceChildren();
        const allOption = document.createElement('option');

        allOption.value = '';
        allOption.textContent = 'All properties';
        elements.propertyFilter.appendChild(allOption);

        state.properties.forEach((property) => {
            const option = document.createElement('option');

            option.value = property.id;
            option.textContent = property.name;
            elements.propertyFilter.appendChild(option);
        });

        /* Keeps a filter that is still valid after the list is rebuilt. */
        elements.propertyFilter.value = state.properties.some((item) => item.id === currentValue)
            ? currentValue
            : '';
    };

    const loadPropertyOptions = async () => {
        if (!state.properties.length) {
            const { ok, data } = await requestJson('/api/properties').catch(() => ({ ok: false, data: [] }));

            if (ok && Array.isArray(data)) {
                state.properties = data;
            }
        }

        if (state.properties.length) {
            populatePropertyOptions();
        }
    };

    const load = async () => {
        elements.count.textContent = 'Loading maintenance requests…';

        const { ok, data } = await requestJson(`/api/maintenance?${buildQuery()}`).catch(() => ({
            ok: false,
            status: 0,
            data: { error: 'The maintenance list could not be loaded.' }
        }));

        if (!ok) {
            elements.count.textContent = data.error || 'The maintenance list could not be loaded.';
            state.requests = [];
            state.counts = {};
            renderStats();
            renderRequests();
            return;
        }

        state.requests = Array.isArray(data.requests) ? data.requests : [];
        state.counts = data.counts || {};
        renderStats();
        renderRequests();
    };

    const openDialog = (item) => {
        state.editingId = item.id;
        elements.dialogTitle.textContent = item.title;
        elements.id.value = item.id;
        elements.formStatus.value = item.status;
        elements.formNotes.value = item.landlordNotes || '';
        setFormError('');
        elements.dialogContent.replaceChildren(buildDetailList(item));
        elements.dialog.showModal();
    };

    const buildDetailList = (item) => {
        const list = document.createElement('dl');
        list.className = 'dialog-detail-list';

        const details = [
            ['Request ID', item.id],
            ['Tenant', item.tenantName],
            ['Email', item.tenantEmail || 'Not provided'],
            ['Phone', item.tenantPhone || 'Not provided'],
            ['Property', item.propertyName || 'Unknown property'],
            ['Unit', item.unit || 'Not recorded'],
            ['Category', item.category],
            ['Urgency', item.urgency],
            ['Raised', formatDate(item.createdAt)],
            ['Last updated', formatDate(item.updatedAt)],
            ['Status', item.status]
        ];

        details.forEach(([label, value]) => {
            const term = createElement('dt', '', label);
            const definition = createElement('dd', '', value || '—');

            list.append(term, definition);
        });

        const descriptionTerm = createElement('dt', '', 'What the tenant reported');
        const descriptionValue = createElement('dd', 'maintenance-description', item.description || '—');

        list.append(descriptionTerm, descriptionValue);

        if (item.landlordNotes) {
            list.append(
                createElement('dt', '', 'Your last note'),
                createElement('dd', 'maintenance-description', item.landlordNotes)
            );
        }

        return list;
    };

    const closeDialog = () => {
        state.editingId = '';
        elements.form.reset();
        setFormError('');

        if (elements.dialog.open) {
            elements.dialog.close();
        }
    };

    elements.body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action="manage"]');

        if (!button) {
            return;
        }

        const item = state.requests.find((entry) => entry.id === button.dataset.requestId);

        if (item) {
            openDialog(item);
        }
    });

    elements.form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormError('');

        const requestId = elements.id.value || state.editingId;

        if (!requestId) {
            setFormError('That request could not be identified. Close the panel and try again.');
            return;
        }

        elements.save.disabled = true;
        elements.save.textContent = 'Saving…';

        try {
            const { ok, data } = await requestJson(`/api/maintenance/${encodeURIComponent(requestId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: elements.formStatus.value,
                    landlordNotes: elements.formNotes.value
                })
            });

            if (!ok) {
                setFormError(data.error || 'That request could not be updated.');
                return;
            }

            closeDialog();
            notify(data.message || 'The maintenance request was updated.');
            await load();
        } catch (error) {
            setFormError('The maintenance service could not be reached. Try again.');
        } finally {
            elements.save.disabled = false;
            elements.save.textContent = 'Save changes';
        }
    });

    elements.cancel.addEventListener('click', closeDialog);
    elements.close.addEventListener('click', closeDialog);

    let searchTimer = null;

    elements.search.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            state.filters.search = elements.search.value.trim();
            load();
        }, 250);
    });

    elements.statusFilter.addEventListener('change', () => {
        state.filters.status = elements.statusFilter.value;
        load();
    });

    elements.propertyFilter.addEventListener('change', () => {
        state.filters.property = elements.propertyFilter.value;
        load();
    });

    elements.resetFilters.addEventListener('click', () => {
        state.filters = { search: '', status: 'all', property: '' };
        elements.search.value = '';
        elements.statusFilter.value = 'all';
        elements.propertyFilter.value = '';
        load();
    });

    loadPropertyOptions();
    load();
})();
