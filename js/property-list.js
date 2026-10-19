(() => {
    'use strict';

    const grid = document.querySelector('#property-grid');
    const countLine = document.querySelector('#properties-count');

    if (!grid) {
        return;
    }

    const makeElement = (tagName, className, text) => {
        const element = document.createElement(tagName);

        if (className) {
            element.className = className;
        }

        if (text !== undefined) {
            element.textContent = text;
        }

        return element;
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

    const createHero = (property, images) => {
        const wrap = makeElement('div', 'property-image');
        const source = images[0];

        if (source) {
            const image = document.createElement('img');
            image.src = source;
            image.alt = property.alt || property.name;
            image.loading = 'lazy';
            /* No image files ship with the demo, so fall back to the gradient
             * already painted on .property-image rather than a broken icon. */
            image.addEventListener('error', () => {
                image.remove();
            }, { once: true });
            wrap.appendChild(image);
        }

        if (images.length > 1) {
            const badge = makeElement('span', 'property-image-count', `📷 ${images.length} photos`);
            wrap.appendChild(badge);
        }

        if (property.availability) {
            wrap.appendChild(makeElement('span', 'property-image-availability', property.availability));
        }

        return wrap;
    };

    const createPropertyCard = (property) => {
        const images = getImages(property);
        const card = makeElement('article', 'property-card');
        card.dataset.propertyId = property.id;

        const content = makeElement('div', 'property-content');

        content.appendChild(makeElement(
            'span',
            `property-status${property.status === 'Occupied' ? ' occupied' : ''}`,
            property.status
        ));

        const heading = makeElement('h3', '', property.name);

        if (property.type) {
            const type = makeElement('span', 'property-type', property.type);
            heading.appendChild(document.createTextNode(' '));
            heading.appendChild(type);
        }

        content.appendChild(heading);
        content.appendChild(makeElement('p', 'location', `📍 ${property.location}`));

        if (property.description) {
            content.appendChild(makeElement('p', 'property-description', property.description));
        }

        const details = makeElement('div', 'property-details');

        if (property.beds !== undefined && property.beds !== null) {
            details.appendChild(makeElement('span', '', `🛏 ${property.beds} bed${property.beds === 1 ? '' : 's'}`));
        }

        if (property.baths !== undefined && property.baths !== null) {
            details.appendChild(makeElement('span', '', `🛁 ${property.baths} bath${property.baths === 1 ? '' : 's'}`));
        }

        if (property.parking) {
            details.appendChild(makeElement('span', '', `🚗 ${property.parking}`));
        }

        if (details.childElementCount) {
            content.appendChild(details);
        }

        if (property.owner) {
            const owner = makeElement('p', 'property-owner');
            owner.append(
                makeElement('span', 'property-owner-icon', '🏢'),
                makeElement('span', '', property.owner)
            );
            content.appendChild(owner);
        }

        if (property.id) {
            const identifier = makeElement('p', 'property-identifier');
            identifier.append(
                makeElement('span', 'property-identifier-label', 'Property ID'),
                makeElement('code', '', property.id)
            );
            content.appendChild(identifier);
        }

        const footer = makeElement('div', 'property-footer');
        const price = makeElement('strong', '', property.price || 'Rent on request');
        const actions = makeElement('div', 'property-footer-actions');
        const link = makeElement('a', 'btn small-btn', 'View Details');
        link.href = `property-details.html?id=${encodeURIComponent(property.id)}`;
        const payLink = makeElement('a', 'btn small-btn property-pay-btn', 'Make Payment');
        payLink.href = `tenant-payment.html?property=${encodeURIComponent(property.id)}`;
        actions.append(link, payLink);
        footer.append(price, actions);
        content.appendChild(footer);

        card.append(createHero(property, images), content);

        return card;
    };

    const render = (properties, source) => {
        grid.replaceChildren(...properties.map(createPropertyCard));

        if (countLine) {
            const homes = `${properties.length} ${properties.length === 1 ? 'property' : 'properties'}`;
            countLine.textContent = source === 'api'
                ? `${homes} · live from the EstatePro database`
                : `${homes} · showing saved details, the server is not reachable`;
        }
    };

    const loadProperties = async () => {
        try {
            const response = await fetch('/api/properties', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`Property request failed with status ${response.status}`);
            }

            const properties = await response.json();

            if (Array.isArray(properties) && properties.length) {
                render(properties, 'api');
                return;
            }

            throw new Error('Property request returned no records');
        } catch (error) {
            const fallback = window.EstateProProperties;

            /* Only overwrite the server-rendered markup if there is something
             * better to show; otherwise the static cards in index.html stand. */
            if (Array.isArray(fallback) && fallback.length) {
                render(fallback, 'fallback');
            }
        }
    };

    loadProperties();
})();
