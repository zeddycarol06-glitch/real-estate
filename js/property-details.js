(() => {
    'use strict';

    const propertyId = new URLSearchParams(window.location.search).get('id')
        || 'sunrise-residences';

    /* Generated from data/properties.json by js/property-fallback.js. */
    const fallbackProperties = window.EstateProProperties || [];

    const elements = {
        loading: document.querySelector('#details-loading'),
        detail: document.querySelector('#property-detail'),
        extra: document.querySelector('#details-extra'),
        error: document.querySelector('#details-error'),
        image: document.querySelector('#details-image'),
        gallery: document.querySelector('#details-gallery'),
        galleryThumbs: document.querySelector('#details-gallery-thumbs'),
        status: document.querySelector('#details-status'),
        type: document.querySelector('#details-type'),
        title: document.querySelector('#details-title'),
        location: document.querySelector('#details-location'),
        identifier: document.querySelector('#details-id'),
        owner: document.querySelector('#details-owner'),
        description: document.querySelector('#details-description'),
        price: document.querySelector('#details-price'),
        availability: document.querySelector('#details-availability'),
        beds: document.querySelector('#details-beds'),
        baths: document.querySelector('#details-baths'),
        parking: document.querySelector('#details-parking'),
        amenities: document.querySelector('#details-amenities-list'),
        requestViewing: document.querySelector('#request-viewing'),
        payRent: document.querySelector('#pay-rent')
    };

    const setText = (element, value) => {
        if (element) {
            element.textContent = value ?? '—';
        }
    };

    /* The gallery is the source of truth for images; `image` stays as the hero
     * so older records without a gallery still render. */
    const getImages = (property) => {
        const images = Array.isArray(property.images) ? property.images.filter(Boolean) : [];

        if (images.length) {
            return images;
        }

        return property.image ? [property.image] : [];
    };

    /* Swap the hero image; a missing file leaves the styled gradient showing. */
    const showImage = (source, property) => {
        elements.image.alt = property.alt || property.name;
        elements.image.src = source;
        elements.image.style.display = '';

        elements.image.onerror = () => {
            elements.image.style.display = 'none';
        };
    };

    /* A cached 404 can fire before the listener is attached, so also check
     * straight away whether the image already failed to load. */
    const watchForFailure = (image, onFailure) => {
        const fail = () => {
            onFailure();
        };

        image.addEventListener('error', fail, { once: true });

        if (image.complete && image.naturalWidth === 0) {
            fail();
        }
    };

    /* The demo ships no image files, so every thumb 404s. Drop the ones that
     * fail and hide the strip once nothing is left to show. */
    const renderGallery = (property, images) => {
        if (!elements.gallery || !elements.galleryThumbs) {
            return;
        }

        const hideGalleryIfEmpty = () => {
            elements.gallery.hidden = elements.galleryThumbs.childElementCount === 0;
        };

        elements.galleryThumbs.replaceChildren();
        hideGalleryIfEmpty();

        if (images.length >= 2) {
            images.slice(1).forEach((source, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'details-gallery-thumb';
                button.setAttribute('aria-label', `Show photo ${index + 2} of ${images.length}`);

                const image = document.createElement('img');
                image.alt = '';
                image.loading = 'lazy';
                /* Set the source before watching, because an <img> with no src
                 * reports complete === true with naturalWidth === 0. */
                image.src = source;

                button.appendChild(image);
                button.addEventListener('click', () => {
                    showImage(source, property);
                });

                elements.galleryThumbs.appendChild(button);
                watchForFailure(image, () => {
                    button.remove();
                    hideGalleryIfEmpty();
                });
            });

            hideGalleryIfEmpty();
        }
    };

    const renderProperty = (property) => {
        const images = getImages(property);

        setText(elements.title, property.name);
        setText(elements.location, `📍 ${property.location}`);
        setText(elements.identifier, property.id);
        setText(elements.owner, property.owner);
        setText(elements.description, property.description);
        setText(elements.price, property.price);
        setText(elements.type, property.type);
        setText(elements.availability, property.availability);
        setText(elements.beds, property.beds);
        setText(elements.baths, property.baths);
        setText(elements.parking, property.parking);

        document.title = `${property.name} | EstatePro`;
        elements.status.className = `property-status${property.status === 'Occupied' ? ' occupied' : ''}`;
        setText(elements.status, property.status);

        showImage(images[0] || property.image || 'images/property1.jpg', property);
        renderGallery(property, images);

        elements.amenities.replaceChildren(
            ...(property.amenities || []).map((amenity) => {
                const item = document.createElement('li');
                item.textContent = amenity;
                return item;
            })
        );

        const subject = encodeURIComponent(`Property enquiry: ${property.name}`);
        elements.requestViewing.href = `mailto:info@estatepro.com?subject=${subject}`;
        elements.payRent.href = `tenant-payment.html?property=${encodeURIComponent(property.id)}`;

        elements.loading.hidden = true;
        elements.error.hidden = true;
        elements.detail.hidden = false;
        elements.extra.hidden = false;
    };

    const showError = () => {
        elements.loading.hidden = true;
        elements.detail.hidden = true;
        elements.extra.hidden = true;
        elements.error.hidden = false;
    };

    const loadProperty = async () => {
        try {
            const response = await fetch(`/api/properties/${encodeURIComponent(propertyId)}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`Property request failed with status ${response.status}`);
            }

            renderProperty(await response.json());
        } catch (error) {
            const fallbackProperty = fallbackProperties.find((item) => item.id === propertyId);

            if (fallbackProperty) {
                renderProperty(fallbackProperty);
            } else {
                showError();
            }
        }
    };

    const currentYear = String(new Date().getFullYear());
    document.querySelectorAll('[data-year]').forEach((element) => {
        element.textContent = currentYear;
    });

    /* Hide unavailable images so the styled gradient fallbacks remain visible */
    document.querySelectorAll('img').forEach((image) => {
        const hideImage = () => {
            image.style.display = 'none';
        };

        image.addEventListener('error', hideImage, { once: true });

        if (image.complete && image.naturalWidth === 0) {
            hideImage();
        }
    });

    loadProperty();
})();
