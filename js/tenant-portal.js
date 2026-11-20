(() => {
    'use strict';

    const content = document.querySelector('.portal-content');

    if (!content) {
        return;
    }

    const numberFormatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
    const dayFormatter = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
    const dateTimeFormatter = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const elements = {
        tenantName: document.querySelector('#portal-tenant-name'),
        heroTitle: document.querySelector('#portal-hero-title'),
        heroText: document.querySelector('#portal-hero-text'),
        heroPeriod: document.querySelector('#portal-hero-period'),
        notice: document.querySelector('#portal-notice'),
        signOut: document.querySelector('#portal-signout'),
        toast: document.querySelector('#portal-toast'),

        dashboardSummary: document.querySelector('#dashboard-summary'),
        dashboardBadge: document.querySelector('#dashboard-badge'),
        statRent: document.querySelector('#stat-rent'),
        statRentNote: document.querySelector('#stat-rent-note'),
        statPaid: document.querySelector('#stat-paid'),
        statPaidNote: document.querySelector('#stat-paid-note'),
        statDue: document.querySelector('#stat-due'),
        statDueNote: document.querySelector('#stat-due-note'),
        statRequests: document.querySelector('#stat-requests'),
        statRequestsNote: document.querySelector('#stat-requests-note'),
        dashboardPropertyNote: document.querySelector('#dashboard-property-note'),
        dashboardPropertyMeta: document.querySelector('#dashboard-property-meta'),
        dashboardPropertyGallery: document.querySelector('#dashboard-property-gallery'),
        dashboardPropertyPhotoButton: document.querySelector('#dashboard-property-photo-button'),
        dashboardPropertyPhoto: document.querySelector('#dashboard-property-photo'),
        dashboardPropertyPhotoFallback: document.querySelector('#dashboard-property-photo-fallback'),
        dashboardPropertyPhotoStrip: document.querySelector('#dashboard-property-photo-strip'),
        dashboardPayments: document.querySelector('#dashboard-payments'),
        dashboardRequests: document.querySelector('#dashboard-requests'),

        propertyDetailsLink: document.querySelector('#property-details-link'),
        propertyUnassigned: document.querySelector('#property-unassigned'),
        propertyPanel: document.querySelector('.portal-property'),
        gallery: document.querySelector('#property-gallery'),
        galleryHero: document.querySelector('#property-gallery-hero'),
        galleryThumbs: document.querySelector('#property-gallery-thumbs'),
        photoFallback: document.querySelector('#property-photo-fallback'),
        fallbackInitial: document.querySelector('#property-fallback-initial'),
        propertyType: document.querySelector('#property-type'),
        propertyName: document.querySelector('#property-name'),
        propertyLocation: document.querySelector('#property-location'),
        propertyPrice: document.querySelector('#property-price'),
        propertyDescription: document.querySelector('#property-description'),
        propertyMeta: document.querySelector('#property-meta'),
        propertyAvailability: document.querySelector('#property-availability'),
        propertyAmenities: document.querySelector('#property-amenities'),
        propertyAmenitiesList: document.querySelector('#property-amenities-list'),

        rentBadge: document.querySelector('#rent-badge'),
        rentForm: document.querySelector('#rent-form'),
        rentFormError: document.querySelector('#rent-form-error'),
        rentPaymentRequestStatus: document.querySelector('#rent-payment-request-status'),
        rentAmount: document.querySelector('#rent-amount'),
        rentAmountHint: document.querySelector('#rent-amount-hint'),
        rentMethod: document.querySelector('#rent-method'),
        rentPeriod: document.querySelector('#rent-period'),
        rentUnit: document.querySelector('#rent-unit'),
        rentPaymentPhone: document.querySelector('#rent-payment-phone'),
        rentSubmit: document.querySelector('#rent-submit'),
        rentPayNote: document.querySelector('#rent-pay-note'),
        rentSummary: document.querySelector('#rent-summary'),
        rentPaytoNumber: document.querySelector('#rent-payto-number'),
        rentPaymentDetails: document.querySelector('#rent-payment-details'),
        rentPendingPayer: document.querySelector('#rent-pending-payer'),
        rentPendingPaidTo: document.querySelector('#rent-pending-paid-to'),
        rentPendingReceipt: document.querySelector('#rent-pending-receipt'),
        rentClaimForm: document.querySelector('#rent-claim-form'),
        rentClaimError: document.querySelector('#rent-claim-error'),
        rentClaimStatus: document.querySelector('#rent-claim-status'),
        rentClaimAmount: document.querySelector('#rent-claim-amount'),
        rentClaimAmountHint: document.querySelector('#rent-claim-amount-hint'),
        rentClaimPeriod: document.querySelector('#rent-claim-period'),
        rentClaimUnit: document.querySelector('#rent-claim-unit'),
        rentClaimReference: document.querySelector('#rent-claim-reference'),
        rentClaimPhone: document.querySelector('#rent-claim-phone'),
        rentClaimSubmit: document.querySelector('#rent-claim-submit'),
        rentClaims: document.querySelector('#rent-claims'),
        rentClaimsList: document.querySelector('#rent-claims-list'),
        paymentHistoryCount: document.querySelector('#payment-history-count'),
        rentPaymentsBody: document.querySelector('#rent-payments-body'),
        rentPaymentsEmpty: document.querySelector('#rent-payments-empty'),

        maintenanceBadge: document.querySelector('#maintenance-badge'),
        maintenanceForm: document.querySelector('#maintenance-form'),
        maintenanceFormError: document.querySelector('#maintenance-form-error'),
        maintenanceCategory: document.querySelector('#maintenance-category'),
        maintenanceUrgency: document.querySelector('#maintenance-urgency'),
        maintenanceTitle: document.querySelector('#maintenance-request-title'),
        maintenanceDescription: document.querySelector('#maintenance-description'),
        maintenanceSubmit: document.querySelector('#maintenance-submit'),
        maintenanceList: document.querySelector('#maintenance-list'),

        profileForm: document.querySelector('#profile-form'),
        profileFormError: document.querySelector('#profile-form-error'),
        profileFormSuccess: document.querySelector('#profile-form-success'),
        profileFullName: document.querySelector('#profile-full-name'),
        profileEmail: document.querySelector('#profile-email'),
        profilePhone: document.querySelector('#profile-phone'),
        profileUnit: document.querySelector('#profile-unit'),
        profileSubmit: document.querySelector('#profile-submit'),
        passwordForm: document.querySelector('#password-form'),
        passwordFormError: document.querySelector('#password-form-error'),
        passwordFormSuccess: document.querySelector('#password-form-success'),
        passwordCurrent: document.querySelector('#password-current'),
        passwordNew: document.querySelector('#password-new'),
        passwordConfirm: document.querySelector('#password-confirm'),
        passwordSubmit: document.querySelector('#password-submit'),
        accountMeta: document.querySelector('#account-meta'),

        receiptDialog: document.querySelector('#receipt-dialog'),
        receiptContent: document.querySelector('#receipt-dialog-content'),
        receiptPrintArea: document.querySelector('#receipt-print-area'),
        receiptClose: document.querySelector('#close-receipt-dialog'),
        receiptPrint: document.querySelector('#receipt-print'),
        receiptDownload: document.querySelector('#receipt-download')
    };

    const state = {
        portal: null,
        pendingPaymentRequestId: '',
        pendingPayerPhone: '',
        receiptPayment: null
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

    const formatDateTime = (value) => {
        const date = value ? new Date(value) : new Date();

        return Number.isNaN(date.getTime()) ? formatDate(value) : dateTimeFormatter.format(date);
    };

    const setMessage = (element, message) => {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.hidden = !message;
    };

    const showToast = (message) => {
        if (!elements.toast) {
            return;
        }

        elements.toast.textContent = message;
        elements.toast.hidden = false;
        window.clearTimeout(showToast.timeout);
        showToast.timeout = window.setTimeout(() => {
            elements.toast.hidden = true;
        }, 3200);
    };

    const redirectToSignIn = () => {
        const next = `${window.location.pathname}${window.location.search}`;

        window.location.replace(`tenant-login.html?next=${encodeURIComponent(next)}&reason=expired`);
    };

    /* Opened straight off disk there is no server to answer, and every fetch
       would fail with an unhelpful "could not be recorded". Say what is wrong
       once, up front, instead of letting each form report a mystery. */
    const isDirectFile = window.location.protocol === 'file:';
    const serverHint = 'Start the EstatePro server and open this page at http://localhost:3000/tenant-portal.html. Records can only be saved when the server is running.';

    const requestJson = async (url, options = {}) => {
        if (isDirectFile) {
            return { ok: false, status: 0, data: { error: serverHint } };
        }

        let response;

        try {
            /* options is spread first so the caller's headers merge with ours
               instead of replacing them and dropping Content-Type. */
            response = await fetch(url, {
                credentials: 'same-origin',
                ...options,
                headers: { Accept: 'application/json', ...(options.headers || {}) }
            });
        } catch (error) {
            return { ok: false, status: 0, data: { error: 'The EstatePro server could not be reached. Make sure it is still running, then try again.' } };
        }

        if (response.status === 401) {
            return { ok: false, status: 401, data: { error: 'Your tenant session has ended.' } };
        }

        let data = {};

        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        return { ok: response.ok, status: response.status, data };
    };

    /* Matches the .details-meta-item wrapper used on the property details page
       so both places lay out identically. */
    const buildMetaList = (rows, target) => {
        if (!target) {
            return;
        }

        target.replaceChildren();

        rows.forEach(([label, value]) => {
            const item = document.createElement('div');

            item.className = 'details-meta-item';
            item.append(
                createElement('dt', '', label),
                createElement('dd', '', value === undefined || value === null || value === '' ? '—' : String(value))
            );
            target.appendChild(item);
        });
    };

    const slugify = (value) => String(value || '').toLowerCase().replace(/[^a-z]+/g, '-');

    const createStatusBadge = (status) => createElement('span', `status-badge ${slugify(status)}`, status);

    /* --- gallery ------------------------------------------------------- */

    const hideGalleryIfEmpty = () => {
        if (!elements.gallery || !elements.galleryThumbs) {
            return;
        }

        const hasHero = elements.galleryHero && !elements.galleryHero.hidden && elements.galleryHero.getAttribute('src');
        const hasThumbs = elements.galleryThumbs.childElementCount > 0;

        if (!hasHero && !hasThumbs) {
            elements.gallery.hidden = true;
        }
    };

    /* Property images are placeholders until real photos are uploaded, so a
       thumb that fails is removed and the remaining gallery closes up. */
    const watchForFailure = (image) => {
        image.addEventListener('error', () => {
            image.remove();

            if (elements.galleryHero === image) {
                elements.galleryHero.hidden = true;
                showPhotoFallback();
            }

            hideGalleryIfEmpty();
        });
    };

    const showPhotoFallback = () => {
        if (!elements.photoFallback) {
            return;
        }

        const property = state.portal?.property;
        const initial = String(property?.name || 'EstatePro').trim().charAt(0).toUpperCase() || 'E';

        if (elements.fallbackInitial) {
            elements.fallbackInitial.textContent = initial;
        }

        elements.photoFallback.hidden = false;
    };

    const renderGallery = (images) => {
        const list = (Array.isArray(images) ? images : []).filter(Boolean);

        if (!elements.gallery || !elements.galleryThumbs) {
            return;
        }

        elements.galleryThumbs.replaceChildren();
        elements.galleryHero.hidden = true;
        elements.galleryHero.removeAttribute('src');
        elements.photoFallback.hidden = true;
        elements.gallery.hidden = list.length === 0;

        if (!list.length) {
            showPhotoFallback();
            return;
        }

        list.forEach((source, index) => {
            const thumb = document.createElement('button');

            thumb.type = 'button';
            thumb.className = 'details-gallery-thumb';
            thumb.setAttribute('aria-label', `Show photo ${index + 1}`);

            const image = document.createElement('img');

            image.src = source;
            image.alt = `Photo ${index + 1} of ${state.portal?.property?.name || 'the property'}`;
            image.loading = 'lazy';
            watchForFailure(image);
            thumb.appendChild(image);

            thumb.addEventListener('click', () => {
                if (!elements.galleryHero) {
                    return;
                }

                /* The hero is the same failing URL in the worst case, so it is
                   only swapped once the new image has actually loaded. */
                const probe = new Image();

                probe.addEventListener('load', () => {
                    elements.galleryHero.src = source;
                    elements.galleryHero.alt = image.alt;
                    elements.galleryHero.hidden = false;
                    elements.photoFallback.hidden = true;
                    elements.gallery.hidden = false;
                });

                probe.src = source;
            });

            elements.galleryThumbs.appendChild(thumb);
        });

        /* The first entry doubles as the hero, matching the singular image
           field older pages still read. */
        if (list[0]) {
            const heroProbe = new Image();

            heroProbe.addEventListener('load', () => {
                elements.galleryHero.src = list[0];
                elements.galleryHero.alt = `Photo 1 of ${state.portal?.property?.name || 'the property'}`;
                elements.galleryHero.hidden = false;
                elements.photoFallback.hidden = true;
                elements.gallery.hidden = false;
            });

            heroProbe.src = list[0];
        }
    };

    /* --- rendering ------------------------------------------------------ */

    const renderProperty = () => {
        const property = state.portal?.property;
        const tenant = state.portal?.tenant;

        if (!property) {
            elements.propertyPanel.hidden = true;
            elements.propertyUnassigned.hidden = false;
            return;
        }

        elements.propertyPanel.hidden = false;
        elements.propertyUnassigned.hidden = true;

        elements.propertyType.textContent = property.type || '';
        elements.propertyType.hidden = !property.type;
        elements.propertyName.textContent = property.name || 'Your property';
        elements.propertyLocation.textContent = property.location || '';
        elements.propertyLocation.hidden = !property.location;
        elements.propertyPrice.textContent = property.price || (property.monthlyRent ? `${formatCurrency(property.monthlyRent)} per month` : '');
        elements.propertyDescription.textContent = property.description || '';

        const isAvailable = property.status === 'Available';

        elements.propertyAvailability.textContent = property.availability
            || (isAvailable ? 'Available' : (property.status || 'Status not recorded'));
        elements.propertyAvailability.className = `availability-chip ${slugify(property.availability || property.status)}`;

        buildMetaList([
            ['Property ID', property.id],
            ['Location', property.location],
            ['Type', property.type],
            ['Bedrooms', property.beds],
            ['Bathrooms', property.baths],
            ['Size', property.size],
            ['Parking', property.parking],
            ['Monthly rent', property.monthlyRent ? formatCurrency(property.monthlyRent) : ''],
            ['Availability', property.availability || property.status],
            ['Owner / landlord', property.owner],
            ['Your unit', tenant?.unit]
        ], elements.propertyMeta);

        elements.propertyDetailsLink.href = `property-details.html?id=${encodeURIComponent(property.id)}`;

        const amenities = Array.isArray(property.amenities) ? property.amenities.filter(Boolean) : [];

        elements.propertyAmenities.hidden = amenities.length === 0;
        elements.propertyAmenitiesList.replaceChildren();
        amenities.forEach((item) => {
            elements.propertyAmenitiesList.appendChild(createElement('li', '', item));
        });

        renderGallery(property.images || (property.image ? [property.image] : []));
    };

    /* The house photo on the dashboard card, so a tenant sees their home the
       moment they sign in instead of having to open "My property". Clicking it
       jumps to the full photo gallery. */
    const renderDashboardPropertyPhotos = (property) => {
        const gallery = elements.dashboardPropertyGallery;

        if (!gallery) {
            return;
        }

        const images = (Array.isArray(property?.images) ? property.images : [])
            .filter((image) => typeof image === 'string' && image);
        const photos = images.length ? images : (property?.image ? [property.image] : []);
        const hero = elements.dashboardPropertyPhoto;
        const fallback = elements.dashboardPropertyPhotoFallback;
        const strip = elements.dashboardPropertyPhotoStrip;

        strip?.replaceChildren();
        hero?.setAttribute('hidden', '');
        hero?.removeAttribute('src');
        fallback?.setAttribute('hidden', '');

        if (!property) {
            gallery.hidden = true;
            return;
        }

        gallery.hidden = false;

        const homeName = property.name || 'your home';
        const initial = String(property.name || 'EstatePro').trim().charAt(0).toUpperCase() || 'E';

        if (elements.dashboardPropertyPhotoButton) {
            elements.dashboardPropertyPhotoButton.setAttribute('aria-label', `View photos of ${homeName}`);
        }

        /* No photos uploaded yet: the lettered tile matches the "My property"
           fallback rather than leaving an empty space. */
        if (!photos.length) {
            if (fallback) {
                fallback.textContent = initial;
                fallback.hidden = false;
            }
            return;
        }

        /* The hero only appears once the image has actually loaded, so a broken
           path falls back to the lettered tile instead of a blank frame. */
        const heroProbe = new Image();

        heroProbe.addEventListener('load', () => {
            hero.src = photos[0];
            hero.alt = `Photo of ${homeName}`;
            hero.hidden = false;

            if (fallback) {
                fallback.hidden = true;
            }
        });
        heroProbe.addEventListener('error', () => {
            if (fallback) {
                fallback.textContent = initial;
                fallback.hidden = false;
            }
        });
        heroProbe.src = photos[0];

        /* A few more photos as a strip; broken ones remove themselves. */
        photos.slice(1, 5).forEach((source, index) => {
            const thumb = document.createElement('img');

            thumb.className = 'dashboard-property-photo-thumb';
            thumb.src = source;
            thumb.alt = `Photo ${index + 2} of ${homeName}`;
            thumb.loading = 'lazy';
            thumb.addEventListener('error', () => thumb.remove());
            strip?.appendChild(thumb);
        });
    };

    const renderDashboard = () => {
        const portal = state.portal;
        const rent = portal.rent;
        const property = portal.property;

        elements.heroTitle.textContent = portal.tenant.fullName
            ? `Welcome back, ${portal.tenant.fullName.split(' ')[0]}`
            : 'Welcome back';
        elements.heroPeriod.textContent = rent.currentPeriod ? `${rent.currentPeriod.toUpperCase()} · TENANT AREA` : 'TENANT AREA';
        elements.heroText.textContent = rent.isCurrentMonthPaid
            ? `Your rent for ${rent.currentPeriod} is fully paid. Thank you.`
            : `${formatCurrency(rent.outstandingThisMonth)} of your ${rent.currentPeriod} rent is still due.`;

        elements.statRent.textContent = formatCurrency(rent.monthlyRent);
        elements.statRentNote.textContent = `Due by ${formatDate(rent.dueDate)}`;
        elements.statPaid.textContent = formatCurrency(rent.paidThisMonth);
        elements.statPaidNote.textContent = `of ${formatCurrency(rent.monthlyRent)}`;
        elements.statDue.textContent = formatCurrency(rent.outstandingThisMonth);
        elements.statDueNote.textContent = rent.isCurrentMonthPaid ? 'Nothing outstanding' : `For ${rent.currentPeriod}`;
        elements.statRequests.textContent = portal.openRequestCount;
        elements.statRequestsNote.textContent = portal.openRequestCount === 1
            ? 'Request open with your landlord'
            : 'Requests open with your landlord';

        elements.dashboardBadge.textContent = rent.isCurrentMonthPaid ? 'Rent paid' : 'Rent due';
        elements.dashboardSummary.textContent = rent.isCurrentMonthPaid
            ? `Your rent for ${rent.currentPeriod} is settled. You have paid ${formatCurrency(rent.totalPaid)} in total across ${rent.paymentCount} payment${rent.paymentCount === 1 ? '' : 's'}.`
            : `You still owe ${formatCurrency(rent.outstandingThisMonth)} for ${rent.currentPeriod}.`;

        elements.dashboardPropertyNote.textContent = property
            ? `${property.name} · ${property.location}`
            : 'No property is linked to your account yet.';

        renderDashboardPropertyPhotos(property);

        buildMetaList(property ? [
            ['Property', property.name],
            ['Unit', portal.tenant.unit],
            ['Owner / landlord', property.owner],
            ['Monthly rent', formatCurrency(rent.monthlyRent)]
        ] : [
            ['Status', 'No property linked yet'],
            ['Contact', 'Ask your landlord to add your property']
        ], elements.dashboardPropertyMeta);

        elements.dashboardPayments.replaceChildren();

        if (!portal.payments.length) {
            elements.dashboardPayments.append(createElement(
                'p',
                'portal-empty-note',
                'You have not made a payment yet. Your receipts will appear here.'
            ));
        } else {
            portal.payments.slice(0, 3).forEach((payment) => {
                elements.dashboardPayments.append(createPaymentRow(payment));
            });
        }

        elements.dashboardRequests.replaceChildren();

        if (!portal.maintenance.length) {
            elements.dashboardRequests.append(createElement(
                'p',
                'portal-empty-note',
                'You have not raised a maintenance request yet.'
            ));
        } else {
            portal.maintenance.slice(0, 3).forEach((item) => {
                elements.dashboardRequests.append(createMaintenanceRow(item, { compact: true }));
            });
        }
    };

    const createPaymentRow = (payment) => {
        const row = document.createElement('div');

        row.className = 'portal-list-row';

        const main = document.createElement('div');

        main.className = 'portal-list-main';
        main.append(
            createElement('strong', '', `${payment.period} · ${formatCurrency(payment.paidAmount)}`),
            createElement('small', 'cell-subline', `${payment.receiptNumber || payment.reference || 'Receipt not issued'} · ${formatDate(payment.paidOn)} · ${payment.method || 'Method not recorded'}`)
        );

        const side = document.createElement('div');

        side.className = 'portal-list-side';
        side.append(createStatusBadge(payment.status), createReceiptButton(payment));

        row.append(main, side);
        return row;
    };

    /* Every recorded payment can be opened as a receipt, from the recent
       payments list on the dashboard and from the full history table. */
    const createReceiptButton = (payment, label = 'Receipt') => {
        const button = createElement('button', 'table-action-btn payment-receipt-open', label);

        button.type = 'button';
        button.dataset.receiptPayment = payment.id;
        button.setAttribute('aria-label', `View the receipt for ${payment.period} (${formatCurrency(payment.paidAmount)})`);
        return button;
    };

    /* --- receipts -------------------------------------------------------- */

    /* The receipt is built by the shared module (js/rent-receipt.js) so the
       pay-rent page and this portal render exactly the same document. */
    const receiptContext = (payment) => ({
        payment,
        tenant: state.portal?.tenant || {},
        property: state.portal?.property || {},
        monthlyRent: state.portal?.rent?.monthlyRent || 0,
        paidTo: state.portal?.receivingNumber || ''
    });

    const buildReceiptNode = (payment) => window.EstateProRentReceipt.build(receiptContext(payment));

    const openReceipt = (payment) => {
        if (!elements.receiptDialog || !elements.receiptContent || !payment) {
            return;
        }

        state.receiptPayment = payment;
        elements.receiptContent.replaceChildren(buildReceiptNode(payment));

        if (typeof elements.receiptDialog.showModal === 'function') {
            if (!elements.receiptDialog.open) {
                elements.receiptDialog.showModal();
            }
        } else {
            elements.receiptDialog.setAttribute('open', '');
        }
    };

    const closeReceipt = () => {
        state.receiptPayment = null;

        if (!elements.receiptDialog) {
            return;
        }

        if (elements.receiptDialog.open && typeof elements.receiptDialog.close === 'function') {
            elements.receiptDialog.close();
        } else {
            elements.receiptDialog.removeAttribute('open');
        }

        elements.receiptContent?.replaceChildren();
    };

    const printReceipt = () => {
        const payment = state.receiptPayment;

        if (!payment || !elements.receiptPrintArea) {
            return;
        }

        /* The dialog is a modal, so printing it directly is unreliable across
           browsers. The shared module prints a hidden copy instead, which the
           @media print rule reveals. */
        window.EstateProRentReceipt.print(receiptContext(payment), elements.receiptPrintArea);
    };

    const downloadReceipt = () => {
        const payment = state.receiptPayment;

        if (!payment) {
            return;
        }

        window.EstateProRentReceipt.download(receiptContext(payment));
        showToast('Receipt downloaded. Open it and use Print → Save as PDF for a PDF copy.');
    };

    const handleReceiptClick = (event) => {
        const button = event.target.closest('[data-receipt-payment]');

        if (!button) {
            return;
        }

        const payment = state.portal?.payments?.find((item) => String(item.id) === button.dataset.receiptPayment);

        if (payment) {
            openReceipt(payment);
        }
    };

    const createMaintenanceRow = (item, { compact = false } = {}) => {
        const row = document.createElement('div');

        row.className = 'portal-list-row';

        const main = document.createElement('div');

        main.className = 'portal-list-main';
        main.append(
            createElement('strong', '', item.title),
            createElement('small', 'cell-subline', `${item.category} · ${item.urgency} · raised ${formatDate(item.createdAt)}`)
        );

        if (!compact) {
            main.append(createElement('p', 'maintenance-description', item.description));
        }

        if (item.landlordNotes) {
            main.append(createElement('p', 'maintenance-note', `Landlord: ${item.landlordNotes}`));
        }

        row.append(main);

        const side = document.createElement('div');

        side.className = 'portal-list-side';
        side.append(createStatusBadge(item.status));

        /* Only an open request can be withdrawn. */
        if (item.status === 'Open' || item.status === 'In progress') {
            const cancelButton = createElement('button', 'table-action-btn', 'Cancel');

            cancelButton.type = 'button';
            cancelButton.dataset.cancelRequest = item.id;
            cancelButton.setAttribute('aria-label', `Cancel the request ${item.title}`);
            side.append(cancelButton);
        }

        row.append(side);
        return row;
    };

    /* A settled month has nothing left to pay, so the button stays disabled.
       Called after every render and after every submit, because the submit
       handler must not re-enable a button the new state just turned off. */
    const syncRentSubmitState = () => {
        const rent = state.portal?.rent;

        if (!rent) {
            return;
        }

        elements.rentSubmit.disabled = rent.isCurrentMonthPaid || !state.portal.property || Boolean(state.pendingPaymentRequestId);
    };

    /* Pochi claims the tenant has already submitted. They are not rent yet:
       each waits for the landlord to check the M-Pesa code, so they are shown
       separately from the payment history with their verification state. */
    const renderRentClaims = () => {
        const portal = state.portal;
        const rent = portal.rent;
        const claims = portal.claims || [];

        if (elements.rentClaimAmount) {
            elements.rentClaimAmount.max = String(rent.monthlyRent || 1);
        }

        if (elements.rentClaimAmountHint) {
            elements.rentClaimAmountHint.textContent = rent.isCurrentMonthPaid
                ? `Your ${rent.currentPeriod} rent is already settled.`
                : `Your ${rent.currentPeriod} rent is ${formatCurrency(rent.monthlyRent)}.`;
        }

        /* Prefilled with the same figures as the STK form so a tenant who paid
           by Pochi only has to add the M-Pesa code. */
        elements.rentClaimPeriod.value = rent.currentMonthKey;
        elements.rentClaimAmount.value = rent.isCurrentMonthPaid ? '' : String(rent.outstandingThisMonth || rent.monthlyRent);
        elements.rentClaimUnit.value = portal.tenant.unit || '';

        if (!elements.rentClaimPhone.value) {
            elements.rentClaimPhone.value = portal.tenant.phone || '';
        }

        if (!elements.rentClaims || !elements.rentClaimsList) {
            return;
        }

        elements.rentClaimsList.replaceChildren();
        elements.rentClaims.hidden = claims.length === 0;

        claims.forEach((claim) => {
            const row = document.createElement('li');

            row.className = 'rent-claim-row';

            const main = document.createElement('div');

            main.className = 'rent-claim-main';
            main.append(
                createElement('strong', '', `${formatCurrency(claim.amount)} · ${claim.period || '—'}`),
                createElement(
                    'small',
                    'cell-subline',
                    `M-Pesa code ${claim.reference || '—'} · submitted ${formatDate(claim.submittedAt)}`
                )
            );

            const side = document.createElement('div');

            side.className = 'rent-claim-side';
            side.append(createElement(
                'span',
                `rent-claim-status rent-claim-status-${claim.status || 'pending'}`,
                claim.statusLabel || 'Awaiting verification'
            ));

            row.append(main, side);
            elements.rentClaimsList.appendChild(row);
        });
    };

    const renderRent = () => {
        const portal = state.portal;
        const rent = portal.rent;

        /* The number rent is received on comes from the server, so changing it
           in configuration updates the portal without a code change. */
        if (portal.receivingNumber && elements.rentPaytoNumber) {
            elements.rentPaytoNumber.textContent = portal.receivingNumber;
        }

        elements.rentBadge.textContent = rent.isCurrentMonthPaid
            ? `${rent.currentPeriod} paid`
            : `${formatCurrency(rent.outstandingThisMonth)} due`;

        elements.rentAmount.max = String(rent.monthlyRent || 1);
        elements.rentAmountHint.textContent = rent.isCurrentMonthPaid
            ? `Your ${rent.currentPeriod} rent is already settled.`
            : `Your ${rent.currentPeriod} rent is ${formatCurrency(rent.monthlyRent)}.`;
        elements.rentPayNote.textContent = rent.isCurrentMonthPaid
            ? `Your ${rent.currentPeriod} rent is fully paid. Nothing more is due this month.`
            : `${formatCurrency(rent.outstandingThisMonth)} of ${formatCurrency(rent.monthlyRent)} is still due for ${rent.currentPeriod}.`;

        /* The month defaults to the current one, and the amount to what is
           genuinely still owed, so a partial payment is topped up not doubled. */
        elements.rentPeriod.value = rent.currentMonthKey;
        elements.rentAmount.value = rent.isCurrentMonthPaid ? '' : String(rent.outstandingThisMonth || rent.monthlyRent);
        elements.rentUnit.value = portal.tenant.unit || '';
        if (!elements.rentPaymentPhone.value) {
            elements.rentPaymentPhone.value = portal.tenant.phone || '';
        }
        syncRentSubmitState();

        buildMetaList([
            ['Monthly rent', formatCurrency(rent.monthlyRent)],
            ['Paid this month', `${formatCurrency(rent.paidThisMonth)} of ${formatCurrency(rent.monthlyRent)}`],
            ['Still due this month', formatCurrency(rent.outstandingThisMonth)],
            ['Due date', formatDate(rent.dueDate)],
            ['Total paid to date', formatCurrency(rent.totalPaid)],
            ['Part payments outstanding', formatCurrency(rent.outstanding)],
            ['Payments recorded', rent.paymentCount],
            ['Last payment', rent.lastPaymentOn ? formatDate(rent.lastPaymentOn) : 'None yet']
        ], elements.rentSummary);

        elements.rentPaymentsBody.replaceChildren();
        elements.paymentHistoryCount.textContent = `${portal.payments.length} payment${portal.payments.length === 1 ? '' : 's'}`;
        elements.rentPaymentsEmpty.hidden = portal.payments.length > 0;

        portal.payments.forEach((payment) => {
            const row = document.createElement('tr');

            [
                payment.receiptNumber || payment.reference || '—',
                payment.period,
                formatCurrency(payment.paidAmount),
                formatDate(payment.paidOn),
                payment.method || '—'
            ].forEach((value) => row.append(createElement('td', '', value)));

            const statusCell = document.createElement('td');

            statusCell.append(createStatusBadge(payment.status));
            row.append(statusCell);

            const receiptCell = document.createElement('td');

            receiptCell.className = 'portal-table-action';
            receiptCell.append(createReceiptButton(payment, 'View'));
            row.append(receiptCell);
            elements.rentPaymentsBody.appendChild(row);
        });

        renderRentClaims();
    };

    const renderMaintenance = () => {
        const portal = state.portal;

        elements.maintenanceBadge.textContent = `${portal.openRequestCount} open`;

        elements.maintenanceList.replaceChildren();

        if (!portal.maintenance.length) {
            elements.maintenanceList.append(createElement(
                'p',
                'portal-empty-note',
                'You have not raised a maintenance request yet. Use the form to tell your landlord what needs fixing.'
            ));
            return;
        }

        portal.maintenance.forEach((item) => {
            elements.maintenanceList.append(createMaintenanceRow(item));
        });
    };

    const renderProfile = () => {
        const portal = state.portal;
        const tenant = portal.tenant;

        elements.tenantName.textContent = tenant.fullName || tenant.email;
        elements.profileFullName.value = tenant.fullName || '';
        elements.profileEmail.value = tenant.email || '';
        elements.profilePhone.value = tenant.phone || '';
        elements.profileUnit.value = tenant.unit || '';

        buildMetaList([
            ['Tenant ID', tenant.id],
            ['Account status', tenant.status],
            ['Property', tenant.propertyName || portal.property?.name || 'Not linked'],
            ['Unit', tenant.unit],
            ['Registered', formatDate(tenant.createdAt)],
            ['Can sign in with a password', tenant.hasPassword ? 'Yes' : 'Not yet']
        ], elements.accountMeta);

        if (!tenant.hasPassword) {
            setMessage(
                elements.passwordFormError,
                'This account was added by your landlord, so there is no password on it yet. Re-register on this page to set one.'
            );
            elements.passwordForm.querySelectorAll('input, button').forEach((field) => {
                field.disabled = true;
            });
        }
    };

    const renderAll = () => {
        renderDashboard();
        renderProperty();
        renderRent();
        renderMaintenance();
        renderProfile();
    };

    /* --- data ------------------------------------------------------------ */

    const applyPortal = (portal) => {
        state.portal = portal;
        renderAll();
    };

    const loadPortal = async () => {
        const { ok, status, data } = await requestJson('/api/tenant/portal').catch(() => ({
            ok: false,
            status: 0,
            data: { error: 'Your tenant area could not be loaded. Check that the EstatePro server is running.' }
        }));

        if (status === 401) {
            redirectToSignIn();
            return;
        }

        if (!ok || !data.tenant) {
            setMessage(elements.notice, data.error || 'Your tenant area could not be loaded. Try again.');
            return;
        }

        setMessage(elements.notice, '');
        applyPortal(data);
    };

    /* The pay-to number and the in-flight payment details are the same story
       the public pay-rent page tells: where rent is received, and what
       Safaricom was asked for while the prompt is still open. */
    const setRentPendingDetails = ({ payer, paidTo, receipt } = {}) => {
        if (payer !== undefined && elements.rentPendingPayer) {
            elements.rentPendingPayer.textContent = payer || '—';
        }

        if (paidTo !== undefined && elements.rentPendingPaidTo) {
            elements.rentPendingPaidTo.textContent = paidTo || '—';
        }

        if (receipt !== undefined && elements.rentPendingReceipt) {
            elements.rentPendingReceipt.textContent = receipt || '—';
        }
    };

    const setRentPendingVisibility = (visible) => {
        if (elements.rentPaymentDetails) {
            elements.rentPaymentDetails.hidden = !visible;
        }
    };

    /* After a confirmed payment the portal is reloaded; the recorded payment is
       matched by its receipt number, falling back to the newest record because
       that is the one the confirmation just wrote. */
    const findRecordedPayment = (paid) => {
        const records = state.portal?.payments || [];
        const wanted = [paid.receiptNumber, paid.reference].filter(Boolean);

        return records.find((payment) => wanted.includes(payment.receiptNumber) || wanted.includes(payment.reference))
            || records[0]
            || null;
    };

    const pollStkPayment = async (requestId) => {
        if (state.pendingPaymentRequestId !== requestId) {
            return;
        }

        const { ok, status, data } = await requestJson(
            `/api/payment-requests/${encodeURIComponent(requestId)}/status`,
            { cache: 'no-store' }
        );

        if (status === 401) {
            redirectToSignIn();
            return;
        }

        if (ok && data.state === 'paid') {
            const reference = data.receiptNumber || data.reference || '';
            const payerPhone = data.payerPhone || state.pendingPayerPhone || '—';

            state.pendingPaymentRequestId = '';
            state.pendingPayerPhone = '';
            setRentPendingDetails({
                payer: payerPhone,
                paidTo: data.paidTo || data.receivingNumber || state.portal?.receivingNumber || '—',
                receipt: reference || 'Confirmed'
            });
            setMessage(
                elements.rentPaymentRequestStatus,
                `Safaricom confirmed payment ${data.reference || data.receiptNumber}. Your rent has been updated.`
            );

            /* Reload first so the rent position and history include the new
               payment, then open its receipt straight away. */
            await loadPortal();

            const recorded = findRecordedPayment(data);

            if (recorded) {
                openReceipt(recorded);
                showToast(reference
                    ? `Payment ${reference} received. Your receipt is ready.`
                    : 'Your payment has been received. Your receipt is ready.');
            } else {
                showToast('Your payment has been received and recorded.');
            }
            return;
        }

        if (ok && data.state === 'failed') {
            state.pendingPaymentRequestId = '';
            state.pendingPayerPhone = '';
            setRentPendingVisibility(false);
            setMessage(elements.rentPaymentRequestStatus, data.message || 'The STK Push was not completed. You can try again.');
            syncRentSubmitState();
            return;
        }

        if (ok && data.state === 'review') {
            setMessage(
                elements.rentPaymentRequestStatus,
                data.message || 'This payment needs reconciliation. Contact the landlord and do not pay again.'
            );
            return;
        }

        if (ok) {
            setMessage(
                elements.rentPaymentRequestStatus,
                data.message || 'STK Push sent. Approve the prompt on your phone; rent is not yet recorded.'
            );
        } else {
            setMessage(
                elements.rentPaymentRequestStatus,
                data.error || 'Checking M-Pesa payment status. Do not submit another payment while this request is pending.'
            );
        }

        window.setTimeout(() => pollStkPayment(requestId), 3000);
    };

    /* --- forms ----------------------------------------------------------- */

    elements.rentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.rentFormError, '');
        setMessage(elements.rentPaymentRequestStatus, '');

        const amount = Number(elements.rentAmount.value);

        if (!Number.isFinite(amount) || amount <= 0) {
            setMessage(elements.rentFormError, 'Enter an amount greater than zero.');
            return;
        }

        if (!/^(?:0[17]\d{8}|\+?254[17]\d{8})$/.test(elements.rentPaymentPhone.value.trim())) {
            setMessage(elements.rentFormError, 'Enter a valid Safaricom number to receive the STK Push.');
            elements.rentPaymentPhone.focus();
            return;
        }

        elements.rentSubmit.disabled = true;
        elements.rentSubmit.textContent = 'Sending STK Push…';

        try {
            const { ok, status, data } = await requestJson('/api/tenant/payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount,
                    method: elements.rentMethod.value,
                    periodKey: elements.rentPeriod.value,
                    unit: elements.rentUnit.value,
                    phoneNumber: elements.rentPaymentPhone.value.trim()
                })
            });

            if (!ok) {
                /* Always say something. Returning quietly here is what left the
                   form looking broken with no explanation at all. */
                setMessage(
                    elements.rentFormError,
                    status === 0
                        ? 'The server response was lost, so we cannot confirm whether Safaricom received the STK request. Check your phone and contact your landlord before trying again.'
                        : (data.error || `The payment was not recorded (the server replied with status ${status}). Please try again.`)
                );
                return;
            }

            if (!data.request) {
                throw new Error('The server did not return a payment request.');
            }

            if (data.portal) {
                applyPortal(data.portal);
            }

            state.pendingPaymentRequestId = data.request.id;
            state.pendingPayerPhone = elements.rentPaymentPhone.value.trim();
            setRentPendingDetails({
                payer: state.pendingPayerPhone,
                paidTo: data.receivingNumber || state.portal?.receivingNumber || '—',
                receipt: 'Not received yet'
            });
            setRentPendingVisibility(true);
            syncRentSubmitState();
            setMessage(
                elements.rentPaymentRequestStatus,
                `STK Push ${data.request.id} was sent to ${data.request.phoneNumber}. Approve it on your phone; rent is not yet recorded.`
            );
            showToast('M-Pesa STK Push sent. Approve the prompt on your phone.');
            window.setTimeout(() => pollStkPayment(data.request.id), 1500);
        } catch (error) {
            setMessage(elements.rentFormError, error.message || 'The payment request could not be submitted. Try again.');
        } finally {
            elements.rentSubmit.textContent = 'Send STK Push';
            syncRentSubmitState();
        }
    });

    /* A tenant who sent rent to the Pochi la Biashara number records the M-Pesa
       code here. Nothing is marked paid: the landlord verifies the code against
       the M-Pesa statement from the dashboard first. */
    elements.rentClaimForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.rentClaimError, '');
        setMessage(elements.rentClaimStatus, '');

        const amount = Number(elements.rentClaimAmount.value);
        const reference = elements.rentClaimReference.value.trim().toUpperCase();
        const phoneNumber = elements.rentClaimPhone.value.trim();
        const unit = elements.rentClaimUnit.value.trim();
        const periodKey = elements.rentClaimPeriod.value;

        if (!Number.isFinite(amount) || amount <= 0) {
            setMessage(elements.rentClaimError, 'Enter the amount you sent.');
            return;
        }

        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
            setMessage(elements.rentClaimError, 'Choose the rent period you paid for.');
            return;
        }

        if (!unit) {
            setMessage(elements.rentClaimError, 'Enter the unit or house number.');
            elements.rentClaimUnit.focus();
            return;
        }

        if (!/^[A-Z0-9]{4,20}$/.test(reference)) {
            setMessage(elements.rentClaimError, 'Enter the M-Pesa confirmation code, such as SJL4K9ZQ2M.');
            elements.rentClaimReference.focus();
            return;
        }

        if (!/^(?:0[17]\d{8}|\+?254[17]\d{8})$/.test(phoneNumber)) {
            setMessage(elements.rentClaimError, 'Enter the Safaricom number you sent the money from.');
            elements.rentClaimPhone.focus();
            return;
        }

        elements.rentClaimSubmit.disabled = true;
        elements.rentClaimSubmit.textContent = 'Submitting…';

        try {
            const { ok, status, data } = await requestJson('/api/tenant/payments/pochi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, periodKey, unit, reference, phoneNumber })
            });

            if (!ok) {
                /* A duplicate code is the one failure worth spelling out: it
                   means the tenant already submitted, or already paid. */
                setMessage(
                    elements.rentClaimError,
                    status === 409
                        ? (data.error || 'That M-Pesa code has already been submitted.')
                        : (status === 0
                            ? 'The server response was lost, so we cannot confirm whether your submission was received. Check the list below before trying again.'
                            : (data.error || `Your payment could not be submitted (the server replied with status ${status}). Please try again.`))
                );
                return;
            }

            elements.rentClaimReference.value = '';

            if (data.portal) {
                applyPortal(data.portal);
            }

            setMessage(
                elements.rentClaimStatus,
                data.message || 'Submitted. Your landlord will verify the M-Pesa code before your rent is recorded.'
            );
            showToast('Pochi payment submitted. It is awaiting your landlord\'s verification.');
        } catch (error) {
            setMessage(elements.rentClaimError, error.message || 'The payment service could not be reached. Try again.');
        } finally {
            elements.rentClaimSubmit.disabled = false;
            elements.rentClaimSubmit.textContent = 'Submit for verification';
        }
    });

    elements.maintenanceForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.maintenanceFormError, '');

        const title = elements.maintenanceTitle.value.trim();
        const description = elements.maintenanceDescription.value.trim();

        if (title.length < 4) {
            setMessage(elements.maintenanceFormError, 'Give the request a short title of at least 4 characters.');
            return;
        }

        if (description.length < 10) {
            setMessage(elements.maintenanceFormError, 'Describe the problem in at least 10 characters so your landlord knows what to expect.');
            return;
        }

        elements.maintenanceSubmit.disabled = true;
        elements.maintenanceSubmit.textContent = 'Sending…';

        try {
            const { ok, data } = await requestJson('/api/tenant/maintenance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: elements.maintenanceCategory.value,
                    urgency: elements.maintenanceUrgency.value,
                    title,
                    description
                })
            });

            if (!ok) {
                setMessage(elements.maintenanceFormError, data.error || 'Your request could not be sent. Try again.');
                return;
            }

            elements.maintenanceForm.reset();
            elements.maintenanceUrgency.value = 'Normal';

            if (data.portal) {
                applyPortal(data.portal);
            }

            showToast(data.message || 'Your maintenance request was sent.');
        } catch (error) {
            setMessage(elements.maintenanceFormError, 'The maintenance service could not be reached. Try again.');
        } finally {
            elements.maintenanceSubmit.disabled = false;
            elements.maintenanceSubmit.textContent = 'Send request';
        }
    });

    /* --- section navigation --------------------------------------------- */

    const sectionLinks = [...document.querySelectorAll('.portal-nav [data-section]')];

    const revealSection = (id) => {
        content.querySelectorAll('.portal-section').forEach((sectionNode) => {
            sectionNode.classList.toggle('is-active', sectionNode.id === id);
        });

        sectionLinks.forEach((link) => {
            const isCurrent = link.dataset.section === id;

            link.classList.toggle('active', isCurrent);

            if (isCurrent) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    };

    const goToSection = (id) => {
        const target = document.getElementById(id);

        revealSection(id);

        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    sectionLinks.forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            goToSection(link.dataset.section);
        });
    });

    /* The dashboard house photo is a shortcut into the full gallery. */
    elements.dashboardPropertyPhotoButton?.addEventListener('click', () => goToSection('property'));

    const initialSection = (window.location.hash || '').replace('#', '');

    if (initialSection && document.getElementById(initialSection)) {
        revealSection(initialSection);
    } else {
        revealSection('dashboard');
    }

    elements.profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.profileFormError, '');
        setMessage(elements.profileFormSuccess, '');

        const fullName = elements.profileFullName.value.trim();
        const email = elements.profileEmail.value.trim();

        if (fullName.length < 2) {
            setMessage(elements.profileFormError, 'Enter your full name.');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setMessage(elements.profileFormError, 'Enter a valid email address.');
            return;
        }

        elements.profileSubmit.disabled = true;
        elements.profileSubmit.textContent = 'Saving…';

        try {
            const { ok, data } = await requestJson('/api/tenant/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullName,
                    email,
                    phone: elements.profilePhone.value.trim(),
                    unit: elements.profileUnit.value.trim()
                })
            });

            if (!ok) {
                setMessage(elements.profileFormError, data.error || 'Your details could not be saved.');
                return;
            }

            if (data.portal) {
                applyPortal(data.portal);
            }

            setMessage(elements.profileFormSuccess, data.message || 'Your details have been saved.');
        } catch (error) {
            setMessage(elements.profileFormError, 'Your details could not be saved. Try again.');
        } finally {
            elements.profileSubmit.disabled = false;
            elements.profileSubmit.textContent = 'Save my details';
        }
    });

    elements.passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setMessage(elements.passwordFormError, '');
        setMessage(elements.passwordFormSuccess, '');

        const newPassword = elements.passwordNew.value;

        if (newPassword !== elements.passwordConfirm.value) {
            setMessage(elements.passwordFormError, 'The two new passwords do not match.');
            return;
        }

        elements.passwordSubmit.disabled = true;
        elements.passwordSubmit.textContent = 'Updating…';

        try {
            const { ok, data } = await requestJson('/api/tenant/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword: elements.passwordCurrent.value,
                    newPassword
                })
            });

            if (!ok) {
                setMessage(elements.passwordFormError, data.error || 'Your password could not be changed.');
                return;
            }

            elements.passwordForm.reset();
            setMessage(elements.passwordFormSuccess, data.message || 'Your password has been changed.');
        } catch (error) {
            setMessage(elements.passwordFormError, 'Your password could not be changed. Try again.');
        } finally {
            elements.passwordSubmit.disabled = false;
            elements.passwordSubmit.textContent = 'Update password';
        }
    });

    elements.maintenanceList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-cancel-request]');

        if (!button) {
            return;
        }

        const requestId = button.dataset.cancelRequest;

        if (!window.confirm('Cancel this maintenance request? Your landlord will see it as cancelled.')) {
            return;
        }

        button.disabled = true;
        button.textContent = 'Cancelling…';

        try {
            const { ok, data } = await requestJson(`/api/tenant/maintenance/${encodeURIComponent(requestId)}/cancel`, {
                method: 'POST'
            });

            if (!ok) {
                showToast(data.error || 'That request could not be cancelled.');
                return;
            }

            if (data.portal) {
                applyPortal(data.portal);
            }

            showToast(data.message || 'Your request has been cancelled.');
        } catch (error) {
            showToast('The maintenance service could not be reached. Try again.');
        } finally {
            button.disabled = false;
            button.textContent = 'Cancel';
        }
    });

    /* Receipts: opened from the recent payments list and the full history
       table, and closed by the button, the backdrop or the Escape key. */
    elements.receiptClose?.addEventListener('click', closeReceipt);
    elements.receiptPrint?.addEventListener('click', printReceipt);
    elements.receiptDownload?.addEventListener('click', downloadReceipt);
    elements.receiptDialog?.addEventListener('click', (event) => {
        if (event.target === elements.receiptDialog) {
            closeReceipt();
        }
    });
    elements.rentPaymentsBody?.addEventListener('click', handleReceiptClick);
    elements.dashboardPayments?.addEventListener('click', handleReceiptClick);

    elements.signOut.addEventListener('click', async () => {
        elements.signOut.disabled = true;

        try {
            await requestJson('/api/tenant/session', { method: 'DELETE' });
        } catch (error) {
            // The browser is sent to the sign-in page either way.
        }

        window.location.replace('tenant-login.html?reason=signed-out');
    });

    loadPortal();
})();
