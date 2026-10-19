(() => {
    'use strict';

    const page = document.querySelector('.landlord-dashboard');

    if (!page) {
        return;
    }

    const ADMIN_SIGN_IN_PATH = 'admin-login.html';
    const SERVER_URL = 'http://localhost:3000';

    const getSignInUrl = (reason = 'required') => {
        const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
        const next = `/${currentPage}${window.location.hash}`;

        return `${ADMIN_SIGN_IN_PATH}?next=${encodeURIComponent(next)}&reason=${encodeURIComponent(reason)}`;
    };

    const elements = {
        lockScreen: document.querySelector('#admin-lock'),
        lockMessage: document.querySelector('#admin-lock-message'),
        lockSignIn: document.querySelector('#admin-lock-signin'),
        totalBilled: document.querySelector('#total-billed'),
        totalCollected: document.querySelector('#total-collected'),
        totalOutstanding: document.querySelector('#total-outstanding'),
        totalOverdue: document.querySelector('#total-overdue'),
        activeTenants: document.querySelector('#active-tenants'),
        totalBilledNote: document.querySelector('#total-billed-note'),
        collectionRate: document.querySelector('#collection-rate'),
        outstandingNote: document.querySelector('#outstanding-note'),
        overdueNote: document.querySelector('#overdue-note'),
        tenantNote: document.querySelector('#tenant-note'),
        paymentChart: document.querySelector('#payment-chart'),
        chartData: document.querySelector('#payment-chart-data'),
        propertyBreakdown: document.querySelector('#property-breakdown'),
        paymentSearch: document.querySelector('#payment-search'),
        propertyFilter: document.querySelector('#property-filter'),
        statusFilter: document.querySelector('#status-filter'),
        periodFilter: document.querySelector('#period-filter'),
        resetFilters: document.querySelector('#reset-filters'),
        paymentCount: document.querySelector('#payment-count'),
        paymentsBody: document.querySelector('#payments-body'),
        paymentsEmpty: document.querySelector('#payments-empty'),
        paymentsEmptyTitle: document.querySelector('#payments-empty-title'),
        paymentsEmptyText: document.querySelector('#payments-empty-text'),
        refreshPayments: document.querySelector('#refresh-payments'),
        exportPayments: document.querySelector('#export-payments'),
        pendingPaymentCount: document.querySelector('#pending-payment-count'),
        pendingPaymentsBody: document.querySelector('#pending-payments-body'),
        pendingPaymentsEmpty: document.querySelector('#pending-payments-empty'),
        lastUpdated: document.querySelector('#last-updated'),
        reminderCopy: document.querySelector('#reminder-copy'),
        profileName: document.querySelector('#profile-name'),
        paymentDialog: document.querySelector('#payment-dialog'),
        paymentDialogTitle: document.querySelector('#payment-dialog-title'),
        paymentDialogContent: document.querySelector('#payment-dialog-content'),
        closePaymentDialog: document.querySelector('#close-payment-dialog'),
        toast: document.querySelector('#dashboard-toast'),
        logoutButton: document.querySelector('#logout-button')
    };

    let isLocked = false;

    const lockDashboard = (message) => {
        if (isLocked) {
            return;
        }

        isLocked = true;
        document.querySelectorAll('#payment-dialog, #dashboard-toast').forEach((element) => {
            if (element.tagName === 'DIALOG' && typeof element.close === 'function') {
                element.close();
            }
        });
        page.hidden = true;
        elements.lockMessage.textContent = message;
        elements.lockSignIn.href = window.location.protocol === 'file:'
            ? `${SERVER_URL}/${ADMIN_SIGN_IN_PATH}`
            : getSignInUrl('required');
        elements.lockScreen.hidden = false;
        elements.lockScreen.focus();
    };

    const redirectToSignIn = (reason) => {
        window.location.replace(getSignInUrl(reason));
    };

    const state = {
        payments: [],
        pendingPaymentRequests: [],
        dataSource: 'loading',
        currentPeriod: '',
        filters: {
            search: '',
            property: '',
            status: '',
            period: ''
        }
    };

    const numberFormatter = new Intl.NumberFormat('en-KE', {
        maximumFractionDigits: 0
    });

    const formatCurrency = (value) => `KSh ${numberFormatter.format(Math.max(0, Number(value) || 0))}`;
    const formatShortCurrency = (value) => {
        const amount = Math.max(0, Number(value) || 0);

        if (amount >= 1000000) {
            return `KSh ${(amount / 1000000).toFixed(1)}m`;
        }

        if (amount >= 1000) {
            return `KSh ${Math.round(amount / 1000)}k`;
        }

        return formatCurrency(amount);
    };

    const formatDate = (dateString) => {
        if (!dateString) {
            return 'Not paid';
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

    const getInitials = (name) => String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

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

    const getPaymentAmount = (payment) => Math.max(0, Number(payment.amount) || 0);
    const getPaidAmount = (payment) => Math.max(0, Number(payment.paidAmount) || 0);

    /* Only tenants who have paid are shown. A record counts as paid once it has
       money received against it and a payment date. */
    const hasRecordedPayment = (payment) => getPaidAmount(payment) > 0 && Boolean(payment?.paidOn);

    /* Each payment is its own ledger row, so a rent period can appear several
       times over. This key gathers those rows back into the single rent period
       they were all paying towards, and is keyed on the tenant so a changed
       email or unit does not split one month's rent into two. */
    const rentPeriodKeyOf = (payment) => {
        const tenantId = String(payment?.tenantId || '').trim();

        if (tenantId) {
            return `${tenantId}|${String(payment?.monthKey || payment?.period || '')}`;
        }

        return [
            'unlinked',
            String(payment?.tenantEmail || '').trim().toLowerCase(),
            String(payment?.propertyId || ''),
            String(payment?.unit || '').trim().toLowerCase(),
            String(payment?.monthKey || payment?.period || '')
        ].join('|');
    };

    /* Rent is billed once for a period, so totals are grouped by period. Adding
       up every row would count the same rent again for each part payment. */
    const groupByRentPeriod = (paymentList) => {
        const groups = new Map();

        paymentList.forEach((payment) => {
            const key = rentPeriodKeyOf(payment);
            const group = groups.get(key) || {
                label: payment.period,
                monthKey: payment.monthKey || '',
                propertyId: payment.propertyId,
                propertyName: payment.propertyName,
                location: payment.location,
                unit: payment.unit,
                rent: getPaymentAmount(payment),
                paid: 0,
                overdue: false
            };

            group.paid += getPaidAmount(payment);
            group.overdue = group.overdue || payment.status === 'Overdue';
            groups.set(key, group);
        });

        groups.forEach((group) => {
            group.outstanding = Math.max(0, group.rent - group.paid);
        });

        return groups;
    };

    const getPeriodOutstanding = (payment, groups) => groups.get(rentPeriodKeyOf(payment))?.outstanding || 0;

    const getUniquePeriods = () => [...new Set(state.payments.map((payment) => payment.period))]
        .filter(Boolean)
        .sort((first, second) => {
            const firstKey = state.payments.find((payment) => payment.period === first)?.monthKey || '';
            const secondKey = state.payments.find((payment) => payment.period === second)?.monthKey || '';
            return secondKey.localeCompare(firstKey);
        });

    const populateFilters = () => {
        const properties = new Map();

        state.payments.forEach((payment) => {
            if (payment.propertyId) {
                properties.set(payment.propertyId, {
                    name: payment.propertyName,
                    location: payment.location
                });
            }
        });

        elements.propertyFilter.replaceChildren();
        const allPropertiesOption = createElement('option', '', 'All properties');
        allPropertiesOption.value = '';
        elements.propertyFilter.appendChild(allPropertiesOption);

        [...properties.entries()]
            .sort((first, second) => first[1].name.localeCompare(second[1].name))
            .forEach(([propertyId, property]) => {
                const option = createElement('option', '', `${property.name} · ${property.location}`);
                option.value = propertyId;
                elements.propertyFilter.appendChild(option);
            });

        const periods = getUniquePeriods();
        const currentCalendarPeriod = new Intl.DateTimeFormat('en-KE', {
            month: 'long',
            year: 'numeric'
        }).format(new Date());
        state.currentPeriod = periods.includes(currentCalendarPeriod) ? currentCalendarPeriod : (periods[0] || '');
        state.filters.period = state.currentPeriod;

        elements.periodFilter.replaceChildren();
        const allPeriodsOption = createElement('option', '', 'All periods');
        allPeriodsOption.value = '';
        elements.periodFilter.appendChild(allPeriodsOption);

        periods.forEach((period) => {
            const option = createElement('option', '', period);
            option.value = period;
            elements.periodFilter.appendChild(option);
        });

        elements.periodFilter.value = state.filters.period;
    };

    const getScopedPayments = () => state.payments.filter((payment) => {
        const propertyMatches = !state.filters.property || payment.propertyId === state.filters.property;
        const periodMatches = !state.filters.period || payment.period === state.filters.period;
        return propertyMatches && periodMatches;
    });

    const getFilteredPayments = () => {
        const searchTerm = state.filters.search.trim().toLowerCase();

        return getScopedPayments().filter((payment) => {
            const statusMatches = !state.filters.status || payment.status === state.filters.status;
            const searchMatches = !searchTerm || [
                payment.tenantName,
                payment.tenantEmail,
                payment.propertyName,
                payment.location,
                payment.unit,
                payment.reference,
                payment.payerPhone,
                payment.tenantPhone
            ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

            return statusMatches && searchMatches;
        });
    };

    const renderSummary = () => {
        const scopedPayments = getScopedPayments();
        const scopedPeriods = [...groupByRentPeriod(scopedPayments).values()];
        const totalBilled = scopedPeriods.reduce((total, period) => total + period.rent, 0);
        const totalCollected = scopedPeriods.reduce((total, period) => total + period.paid, 0);
        const totalOutstanding = scopedPeriods.reduce((total, period) => total + period.outstanding, 0);
        const totalOverdue = scopedPeriods
            .filter((period) => period.overdue)
            .reduce((total, period) => total + period.outstanding, 0);
        const collectionRate = totalBilled ? Math.round((totalCollected / totalBilled) * 100) : 0;
        /* Counted on the tenant rather than the email, so one tenant is one
           payer even after they change their address. */
        const tenantCount = new Set(scopedPayments.map((payment) => payment.tenantId || payment.tenantEmail || payment.tenantName)).size;
        const propertyCount = new Set(scopedPayments.map((payment) => payment.propertyId)).size;
        const outstandingCount = scopedPeriods.filter((period) => period.outstanding > 0).length;
        const periodLabel = state.filters.period || 'all periods';

        elements.totalBilled.textContent = formatCurrency(totalBilled);
        elements.totalCollected.textContent = formatCurrency(totalCollected);
        elements.totalOutstanding.textContent = formatCurrency(totalOutstanding);
        elements.totalOverdue.textContent = formatCurrency(totalOverdue);
        elements.activeTenants.textContent = numberFormatter.format(tenantCount);
        elements.totalBilledNote.textContent = `For ${periodLabel}`;
        elements.collectionRate.textContent = `${collectionRate}% collection rate`;
        elements.outstandingNote.textContent = `${outstandingCount} payment${outstandingCount === 1 ? '' : 's'} awaiting balance`;
        elements.overdueNote.textContent = 'Unpaid rent is not recorded';
        elements.tenantNote.textContent = `Across ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'}`;
        elements.reminderCopy.textContent = outstandingCount
            ? `${outstandingCount} part payment${outstandingCount === 1 ? '' : 's'} still ${outstandingCount === 1 ? 'has' : 'have'} a balance to clear.`
            : 'Every recorded payment is complete. Tenants appear here only after they pay.';
    };

    const renderChart = () => {
        elements.paymentChart.replaceChildren();
        elements.chartData.replaceChildren();

        const monthTotals = new Map();

        groupByRentPeriod(state.payments).forEach((period) => {
            const key = period.monthKey || period.label;
            const current = monthTotals.get(key) || {
                label: period.label,
                collected: 0,
                billed: 0
            };

            current.collected += period.paid;
            current.billed += period.rent;
            monthTotals.set(key, current);
        });

        const months = [...monthTotals.entries()]
            .sort((first, second) => first[0].localeCompare(second[0]))
            .slice(-6);
        const maximum = Math.max(...months.map(([, totals]) => totals.collected), 1);

        if (!months.length) {
            const emptyMessage = createElement('p', 'chart-empty', 'No collection history is available yet.');
            elements.paymentChart.appendChild(emptyMessage);
            elements.chartData.textContent = emptyMessage.textContent;
            return;
        }

        const chartItems = createElement('ul', 'chart-data-list');
        const firstPeriod = months[0][1].label;
        const lastPeriod = months[months.length - 1][1].label;

        months.forEach(([monthKey, totals]) => {
            const column = createElement('div', 'chart-column');
            const value = createElement('span', 'chart-value', formatShortCurrency(totals.collected));
            const barArea = createElement('div', 'chart-bar-area');
            const bar = createElement('span', 'chart-bar');
            const shortMonthLabel = String(totals.label || '').split(' ')[0].slice(0, 3);
            const hasCollection = totals.collected > 0;
            const label = createElement('span', 'chart-label', shortMonthLabel);

            if (totals.label === (state.filters.period || state.currentPeriod)) {
                column.classList.add('current');
            }

            bar.style.height = hasCollection ? `${Math.max(5, (totals.collected / maximum) * 100)}%` : '0%';
            if (!hasCollection) {
                bar.classList.add('empty');
            }
            bar.title = `${totals.label}: ${formatCurrency(totals.collected)} collected from ${formatCurrency(totals.billed)} billed`;
            barArea.appendChild(bar);
            column.append(value, barArea, label);
            elements.paymentChart.appendChild(column);
            chartItems.appendChild(createElement('li', '', `${totals.label}: ${formatCurrency(totals.collected)} collected from ${formatCurrency(totals.billed)} billed.`));
        });

        elements.paymentChart.setAttribute('aria-label', `Monthly rent collection from ${firstPeriod} to ${lastPeriod}`);
        elements.chartData.appendChild(chartItems);
    };

    const renderPropertyBreakdown = () => {
        elements.propertyBreakdown.replaceChildren();

        const propertyTotals = new Map();

        /* Grouping by rent period first means a unit that settled its rent in
           two parts is still only billed that rent once. */
        groupByRentPeriod(getScopedPayments()).forEach((period) => {
            const current = propertyTotals.get(period.propertyId) || {
                name: period.propertyName,
                location: period.location,
                billed: 0,
                collected: 0,
                units: new Set()
            };

            current.billed += period.rent;
            current.collected += period.paid;
            current.units.add(period.unit);
            propertyTotals.set(period.propertyId, current);
        });

        const properties = [...propertyTotals.values()]
            .sort((first, second) => (second.billed - second.collected) - (first.billed - first.collected));

        if (!properties.length) {
            elements.propertyBreakdown.appendChild(createElement('p', 'chart-empty', 'No property records match this period.'));
            return;
        }

        properties.forEach((property) => {
            const outstanding = Math.max(0, property.billed - property.collected);
            const percentage = property.billed ? Math.round((property.collected / property.billed) * 100) : 0;
            const item = createElement('article', 'property-performance-item');
            const head = createElement('div', 'property-performance-head');
            const nameGroup = createElement('div');
            const status = createElement('span', 'property-performance-status');
            const progress = createElement('div', 'property-progress');
            const progressBar = createElement('span');
            const meta = createElement('div', 'property-performance-meta');

            nameGroup.append(
                createElement('strong', '', property.name),
                createElement('small', '', `${property.location} · ${property.units.size} unit${property.units.size === 1 ? '' : 's'}`)
            );
            status.textContent = outstanding ? `${percentage}% collected` : 'Fully collected';
            if (outstanding) {
                status.classList.add('partial');
            }

            progressBar.style.width = `${percentage}%`;
            progress.appendChild(progressBar);
            meta.append(
                createElement('span', '', `${formatCurrency(property.collected)} collected`),
                createElement('span', '', `${formatCurrency(outstanding)} outstanding`)
            );
            head.append(nameGroup, status);
            item.append(head, progress, meta);
            elements.propertyBreakdown.appendChild(item);
        });
    };

    const createPaymentIdCell = (payment) => {
        const cell = document.createElement('td');
        const wrapper = createElement('div', 'payment-id-cell');
        const reference = payment.reference || payment.receiptNumber || 'No reference';

        wrapper.append(
            createElement('strong', 'payment-id-value', payment.id || reference),
            createElement('small', '', reference)
        );
        cell.appendChild(wrapper);
        return cell;
    };

    const createTenantCell = (payment) => {
        const cell = document.createElement('td');
        const wrapper = createElement('div', 'tenant-cell');
        const avatar = createElement('span', 'tenant-avatar', getInitials(payment.tenantName));
        const details = createElement('div');

        details.append(
            createElement('strong', '', payment.tenantName),
            createElement('small', '', payment.tenantEmail),
            createElement('small', '', `Paid from: ${payment.payerPhone || payment.tenantPhone || 'Number not recorded'}`)
        );
        wrapper.append(avatar, details);
        cell.appendChild(wrapper);
        return cell;
    };

    const createPropertyCell = (payment) => {
        const cell = document.createElement('td');
        const wrapper = createElement('div', 'property-cell');
        const details = createElement('div');

        details.append(
            createElement('strong', '', payment.propertyName),
            createElement('small', '', `Unit ${payment.unit} · ${payment.location}`)
        );
        wrapper.appendChild(details);
        cell.appendChild(wrapper);
        return cell;
    };

    const createPaymentDateCell = (payment) => {
        const cell = document.createElement('td');
        const wrapper = createElement('div', 'period-cell');
        const paidOn = createElement('time', '', formatDate(payment.paidOn));

        if (payment.paidOn) {
            paidOn.dateTime = payment.paidOn;
        }

        wrapper.append(paidOn, createElement('small', '', payment.period));
        cell.appendChild(wrapper);
        return cell;
    };

    const renderPayments = () => {
        const payments = getFilteredPayments();
        const periodGroups = groupByRentPeriod(state.payments);
        elements.paymentsBody.replaceChildren();
        elements.paymentCount.textContent = `Showing ${payments.length} of ${state.payments.length} payment records`;
        elements.paymentsEmpty.hidden = payments.length !== 0;

        const hasActiveFilters = Boolean(
            state.filters.search.trim()
            || state.filters.property
            || state.filters.status
            || state.filters.period
        );

        if (!state.payments.length) {
            elements.paymentsEmptyTitle.textContent = state.dataSource === 'error'
                ? 'Payment service unavailable'
                : 'No payments recorded yet';
            elements.paymentsEmptyText.textContent = state.dataSource === 'error'
                ? 'Start the EstatePro API to load the landlord ledger.'
                : 'A tenant is listed here only after a payment has been made.';
        } else if (!hasActiveFilters) {
            elements.paymentsEmptyTitle.textContent = 'No payments recorded yet';
            elements.paymentsEmptyText.textContent = 'A tenant is listed here only after a payment has been made.';
        } else {
            elements.paymentsEmptyTitle.textContent = 'No payments match these filters';
            elements.paymentsEmptyText.textContent = 'Try a different property, period or payment status.';
        }

        const statusOrder = { Partial: 0, Paid: 1 };
        payments
            .slice()
            .sort((first, second) => {
                const statusDifference = (statusOrder[first.status] ?? 9) - (statusOrder[second.status] ?? 9);

                return statusDifference || String(second.paidOn || '').localeCompare(String(first.paidOn || ''));
            })
            .forEach((payment) => {
                const row = document.createElement('tr');
                const amountCell = document.createElement('td');
                const methodCell = document.createElement('td');
                const statusCell = document.createElement('td');
                const actionCell = document.createElement('td');
                const periodOutstanding = getPeriodOutstanding(payment, periodGroups);
                const amount = createElement('span', 'amount-cell', formatCurrency(getPaidAmount(payment)));
                const amountDetail = createElement('small', 'amount-detail', periodOutstanding > 0
                    ? `${formatCurrency(periodOutstanding)} left of ${payment.period} rent`
                    : `${payment.period} rent settled`);
                const method = createElement('span', 'method-cell', payment.method || '—');
                const status = createElement('span', `status ${String(payment.status || '').toLowerCase()}`, payment.status);
                const action = createElement('button', 'table-action', 'View');

                amountCell.className = 'amount-cell';
                amountCell.append(amount, amountDetail);
                methodCell.appendChild(method);
                statusCell.appendChild(status);
                action.type = 'button';
                action.dataset.paymentId = payment.id;
                action.setAttribute('aria-label', `View payment ${payment.id || ''} for ${payment.tenantName}`);
                actionCell.appendChild(action);
                row.append(
                    createPaymentIdCell(payment),
                    createTenantCell(payment),
                    createPropertyCell(payment),
                    amountCell,
                    createPaymentDateCell(payment),
                    methodCell,
                    statusCell,
                    actionCell
                );
                elements.paymentsBody.appendChild(row);
            });
    };

    const renderPendingPaymentRequests = () => {
        const requests = state.pendingPaymentRequests;
        elements.pendingPaymentCount.textContent = `${requests.length} awaiting verification`;
        elements.pendingPaymentsBody.replaceChildren();
        elements.pendingPaymentsEmpty.hidden = requests.length !== 0;

        requests.forEach((request) => {
            const row = document.createElement('tr');
            const tenant = createElement('td');
            const tenantDetails = createElement('div', 'tenant-cell');
            const tenantName = createElement('strong', '', request.tenantName);
            const tenantContact = createElement('small', '', [
                request.tenantEmail,
                `Payer: ${request.payerPhone || request.tenantPhone || 'number not recorded'}`
            ].filter(Boolean).join(' · '));
            const property = createElement('td');
            const propertyDetails = createElement('div', 'property-cell');
            const propertyName = createElement('strong', '', request.propertyName);
            const propertyUnit = createElement('small', '', `Unit ${request.unit} · ${request.location}`);
            const amount = createElement('td', 'amount-cell');
            amount.appendChild(createElement('span', '', formatCurrency(request.requestedAmount)));
            if (Number.isFinite(Number(request.providerAmount))) {
                amount.appendChild(createElement('small', 'amount-detail', `Safaricom reported ${formatCurrency(request.providerAmount)}`));
            }
            const reference = createElement(
                'td',
                'pending-payment-reference',
                request.providerReceipt || request.reference || 'No receipt received'
            );
            const submitted = createElement('td', '', new Date(request.createdAt).toLocaleString('en-KE'));
            const actions = createElement('td', 'pending-payment-actions');

            tenantDetails.append(tenantName, tenantContact);
            tenant.appendChild(tenantDetails);
            propertyDetails.append(propertyName, propertyUnit);
            property.appendChild(propertyDetails);
            if (request.paymentRequestStatus === 'callback_review') {
                actions.classList.add('pending-payment-review-state');
                actions.append(
                    createElement('strong', '', 'Needs reconciliation'),
                    createElement('small', '', request.failureReason || 'Check the Safaricom transaction before recording rent.')
                );
            } else {
                const confirm = createElement('button', 'table-action pending-payment-confirm', 'Confirm');
                const reject = createElement('button', 'table-action pending-payment-reject', 'Reject');
                confirm.type = 'button';
                confirm.dataset.requestId = request.id;
                confirm.dataset.requestAction = 'confirm';
                confirm.setAttribute('aria-label', `Confirm verified Pochi payment ${request.reference} from ${request.tenantName}`);
                reject.type = 'button';
                reject.dataset.requestId = request.id;
                reject.dataset.requestAction = 'reject';
                reject.setAttribute('aria-label', `Reject Pochi payment request ${request.reference} from ${request.tenantName}`);
                actions.append(confirm, reject);
            }
            row.append(tenant, property, amount, reference, submitted, actions);
            elements.pendingPaymentsBody.appendChild(row);
        });
    };

    const renderAll = () => {
        renderSummary();
        renderChart();
        renderPropertyBreakdown();
        renderPayments();
        renderPendingPaymentRequests();

        const loadedTime = new Intl.DateTimeFormat('en-KE', {
            hour: 'numeric',
            minute: '2-digit'
        }).format(new Date());

        if (state.dataSource === 'api') {
            elements.lastUpdated.textContent = `Loaded from EstatePro API at ${loadedTime}`;
        } else if (state.dataSource === 'error') {
            elements.lastUpdated.textContent = 'Payment service unavailable';
        } else {
            elements.lastUpdated.textContent = 'Loading payment activity…';
        }
    };

    const showToast = (message) => {
        elements.toast.textContent = message;
        elements.toast.hidden = false;
        window.clearTimeout(showToast.timeout);
        showToast.timeout = window.setTimeout(() => {
            elements.toast.hidden = true;
        }, 3200);
    };

    const openPaymentDialog = (payment) => {
        elements.paymentDialogTitle.textContent = `${payment.tenantName} · ${payment.period}`;
        elements.paymentDialogContent.replaceChildren();
        elements.paymentDialogContent.appendChild(createElement('div', 'dialog-payment-amount', formatCurrency(getPaidAmount(payment))));
        const details = document.createElement('dl');
        details.className = 'dialog-detail-list';
        const periodOutstanding = getPeriodOutstanding(payment, groupByRentPeriod(state.payments));

        const detailValues = [
            ['Payment ID', payment.id || 'Not available'],
            ['Tenant', payment.tenantName],
            ['Email', payment.tenantEmail || 'Not provided'],
            ['Paid from number', payment.payerPhone || payment.tenantPhone || 'Not recorded'],
            ['Property', `${payment.propertyName} · Unit ${payment.unit}`],
            ['Location', payment.location],
            ['Amount received', formatCurrency(getPaidAmount(payment))],
            ['Payment date', payment.paidOn ? formatDate(payment.paidOn) : 'Not paid'],
            ['Payment method', payment.method || 'Not recorded'],
            ['Payment status', payment.status],
            ['Rent period', payment.period],
            ['Due date', formatDate(payment.dueDate)],
            ['Rent for this period', formatCurrency(getPaymentAmount(payment))],
            ['Still owed for this period', formatCurrency(periodOutstanding)],
            ['Reference', payment.reference || 'Not available'],
            ['Receipt number', payment.receiptNumber || 'Not available']
        ];

        detailValues.forEach(([label, value]) => {
            const group = document.createElement('div');
            group.append(createElement('dt', '', label), createElement('dd', '', value));
            details.appendChild(group);
        });

        elements.paymentDialogContent.appendChild(details);

        if (typeof elements.paymentDialog.showModal === 'function') {
            elements.paymentDialog.showModal();
        } else {
            elements.paymentDialog.setAttribute('open', '');
        }
    };

    const closePaymentDialog = () => {
        if (typeof elements.paymentDialog.close === 'function') {
            elements.paymentDialog.close();
        } else {
            elements.paymentDialog.removeAttribute('open');
        }
    };

    const exportCsv = () => {
        const payments = getFilteredPayments();

        if (!payments.length) {
            showToast('There are no payments to export with these filters.');
            return;
        }

        const escapeCsv = (value) => {
            let text = String(value ?? '');

            if (/^[=+\-@]/.test(text)) {
                text = `'${text}`;
            }

            return `"${text.replaceAll('"', '""')}"`;
        };
        /* The full ledger is used for balances so filtering the export can never
           hide a part payment and understate what is still owed. */
        const periodGroups = groupByRentPeriod(state.payments);
        const headers = ['Payment ID', 'Tenant', 'Property', 'Amount received', 'Payment date', 'Payment method', 'Payment status', 'Email', 'Payer phone', 'Location', 'Unit', 'Rent period', 'Rent for period', 'Still owed for period', 'Reference', 'Receipt number'];
        const rows = payments.map((payment) => [
            payment.id,
            payment.tenantName,
            payment.propertyName,
            getPaidAmount(payment),
            payment.paidOn || '',
            payment.method,
            payment.status,
            payment.tenantEmail,
            payment.payerPhone || payment.tenantPhone,
            payment.location,
            payment.unit,
            payment.period,
            getPaymentAmount(payment),
            getPeriodOutstanding(payment, periodGroups),
            payment.reference,
            payment.receiptNumber
        ]);
        const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = `estatepro-payments-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`${payments.length} payment record${payments.length === 1 ? '' : 's'} exported.`);
    };

    const updateFilters = () => {
        state.filters.search = elements.paymentSearch.value;
        state.filters.property = elements.propertyFilter.value;
        state.filters.status = elements.statusFilter.value;
        state.filters.period = elements.periodFilter.value;
        renderSummary();
        renderChart();
        renderPropertyBreakdown();
        renderPayments();
    };

    const resetFilters = () => {
        elements.paymentSearch.value = '';
        elements.propertyFilter.value = '';
        elements.statusFilter.value = '';
        elements.periodFilter.value = state.currentPeriod;
        state.filters = {
            search: '',
            property: '',
            status: '',
            period: state.currentPeriod
        };
        updateFilters();
    };

    const loadPayments = async () => {
        if (window.location.protocol === 'file:') {
            lockDashboard(`This dashboard must be opened through the EstatePro server at ${SERVER_URL} so the admin password can be verified. Opening the file directly cannot be protected.`);
            return;
        }

        try {
            const response = await fetch('/api/payments', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            if (response.status === 401) {
                redirectToSignIn('expired');
                return;
            }

            if (!response.ok) {
                throw new Error('Payment API unavailable');
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                throw new Error('Payment API returned an invalid response');
            }

            const requestsResponse = await fetch('/api/payment-requests', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            if (requestsResponse.status === 401) {
                redirectToSignIn('expired');
                return;
            }

            if (!requestsResponse.ok) {
                throw new Error('Pochi payment requests could not be loaded');
            }

            const requests = await requestsResponse.json();
            if (!Array.isArray(requests)) {
                throw new Error('Pochi payment requests returned an invalid response');
            }

            state.payments = data.filter(hasRecordedPayment);
            state.pendingPaymentRequests = requests;
            state.dataSource = 'api';
        } catch (error) {
            state.payments = [];
            state.pendingPaymentRequests = [];
            state.dataSource = 'error';
        }

        populateFilters();
        renderAll();
    };

    const refreshPaymentLedger = async () => {
        const button = elements.refreshPayments;
        const originalLabel = button?.innerHTML;

        if (button) {
            button.disabled = true;
            button.textContent = 'Refreshing…';
        }

        await loadPayments();

        if (button) {
            button.disabled = false;
            button.innerHTML = originalLabel;
        }

        showToast('Payment ledger refreshed.');
    };

    const setProfileName = () => {
        try {
            const sessionValue = window.localStorage.getItem('estateproSession') || window.sessionStorage.getItem('estateproSession');
            const session = sessionValue ? JSON.parse(sessionValue) : null;
            elements.profileName.textContent = session?.fullName || 'Landlord';
        } catch (error) {
            elements.profileName.textContent = 'Landlord';
        }
    };

    elements.paymentSearch.addEventListener('input', updateFilters);
    elements.propertyFilter.addEventListener('change', updateFilters);
    elements.statusFilter.addEventListener('change', updateFilters);
    elements.periodFilter.addEventListener('change', updateFilters);
    elements.resetFilters.addEventListener('click', resetFilters);
    elements.refreshPayments.addEventListener('click', refreshPaymentLedger);
    elements.exportPayments.addEventListener('click', exportCsv);

    elements.paymentsBody.addEventListener('click', (event) => {
        const action = event.target.closest('[data-payment-id]');

        if (!action) {
            return;
        }

        const payment = state.payments.find((item) => item.id === action.dataset.paymentId);

        if (payment) {
            openPaymentDialog(payment);
        }
    });

    elements.pendingPaymentsBody.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-request-id][data-request-action]');
        if (!button) {
            return;
        }

        const request = state.pendingPaymentRequests.find((item) => item.id === button.dataset.requestId);
        if (!request) {
            return;
        }

        const action = button.dataset.requestAction;
        const confirmMessage = action === 'confirm'
            ? `Have you verified M-Pesa code ${request.reference} in Safaricom's transaction history and confirmed KSh ${numberFormatter.format(request.requestedAmount)} was received?`
            : `Reject payment request ${request.reference} from ${request.tenantName}?`;
        if (!window.confirm(confirmMessage)) {
            return;
        }

        button.disabled = true;
        try {
            const response = await fetch(`/api/payment-requests/${encodeURIComponent(request.id)}/${action}`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            const result = await response.json().catch(() => ({}));
            if (response.status === 401) {
                redirectToSignIn('expired');
                return;
            }
            if (!response.ok) {
                throw new Error(result.error || 'The payment request could not be updated.');
            }

            await loadPayments();
            showToast(action === 'confirm'
                ? 'Verified payment recorded in the rent ledger.'
                : 'Payment request rejected.');
        } catch (error) {
            showToast(error.message || 'The payment request could not be updated.');
            button.disabled = false;
        }
    });

    elements.closePaymentDialog.addEventListener('click', closePaymentDialog);

    /* Tenant management lives in its own file and reports back through these
       two events: one to show a message, one to say the ledger has moved. */
    document.addEventListener('estatepro:notify', (event) => {
        showToast(event.detail?.message || '');
    });
    document.addEventListener('estatepro:tenants-changed', () => {
        loadPayments();
    });

    elements.paymentDialog.addEventListener('click', (event) => {
        if (event.target === elements.paymentDialog) {
            closePaymentDialog();
        }
    });

    elements.logoutButton.addEventListener('click', async () => {
        elements.logoutButton.disabled = true;
        window.localStorage.removeItem('estateproSession');
        window.sessionStorage.removeItem('estateproSession');

        try {
            await fetch('/api/admin/session', {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
        } catch (error) {
            // The session cookie may already be gone; continue to the gate page.
        }

        window.location.replace(getSignInUrl('signed-out'));
    });

    const verifyAdminSession = async () => {
        if (window.location.protocol === 'file:') {
            return;
        }

        try {
            const response = await fetch('/api/admin/session', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });

            if (response.status === 401) {
                redirectToSignIn('expired');
                return;
            }

            if (!response.ok) {
                return;
            }

            const session = await response.json();

            if (!session.authenticated) {
                redirectToSignIn(session.configured ? 'required' : 'setup');
            }
        } catch (error) {
            lockDashboard(window.location.protocol === 'file:'
                ? 'This dashboard was opened from the file system. Open http://localhost:3000/dashboard.html through the running EstatePro server.'
                : 'The EstatePro server is not answering. Start it with "npm start", then reload this page.');
        }
    };

    verifyAdminSession();
    setProfileName();
    loadPayments();
})();
