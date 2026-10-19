(() => {
    'use strict';

    const form = document.querySelector('#recommendation-form');

    if (!form) {
        return;
    }

    /* Generated from data/properties.json by js/property-fallback.js. */
    const fallbackProperties = window.EstateProProperties || [];

    const elements = {
        results: document.querySelector('#recommendation-results'),
        empty: document.querySelector('#recommendation-empty'),
        status: document.querySelector('#recommendation-status'),
        count: document.querySelector('#recommendation-count'),
        title: document.querySelector('#recommendation-title'),
        budget: document.querySelector('#max-budget'),
        chips: [...document.querySelectorAll('.recommendation-chip')]
    };

    let activeNeed = '';

    const labels = {
        'single-room': 'single rooms',
        bedsitter: 'bedsitters',
        '1-bedroom': '1-bedroom apartments',
        '2-bedroom': '2-bedroom apartments',
        '3-bedroom': '3-bedroom apartments',
        '4-bedroom': '4-bedroom homes'
    };

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

    const getBedroomLabel = (property) => {
        if (property.size === 'single-room') {
            return 'Single room';
        }

        if (property.size === 'bedsitter') {
            return 'Bedsitter';
        }

        return `${property.beds} bedroom${property.beds === 1 ? '' : 's'}`;
    };

    const createRecommendationCard = (property) => {
        const card = makeElement('article', 'recommendation-card');
        const imageWrap = makeElement('div', 'recommendation-image');
        const image = document.createElement('img');

        image.src = property.image || 'images/property1.jpg';
        image.alt = property.alt || property.name;
        image.loading = 'lazy';
        image.addEventListener('error', () => {
            image.style.display = 'none';
        }, { once: true });
        imageWrap.appendChild(image);

        const content = makeElement('div', 'recommendation-content');
        const status = makeElement(
            'span',
            `property-status${property.status === 'Occupied' ? ' occupied' : ''}`,
            property.status
        );
        const title = makeElement('h3', '', property.name);
        const location = makeElement('p', 'location', `📍 ${property.location}`);
        const description = makeElement('p', 'recommendation-description', property.description);
        const details = makeElement('div', 'recommendation-mini-details');

        [
            ['🛏', getBedroomLabel(property)],
            ['🛁', `${property.baths} bath${property.baths === 1 ? '' : 's'}`],
            ['🚗', property.parking]
        ].forEach(([icon, label]) => {
            const detail = makeElement('span');
            detail.append(
                makeElement('span', 'recommendation-mini-icon', icon),
                makeElement('span', '', label)
            );
            details.appendChild(detail);
        });

        const footer = makeElement('div', 'recommendation-footer');
        const price = makeElement('strong', '', property.price);
        const link = makeElement('a', 'btn small-btn', 'View details');
        link.href = `property-details.html?id=${encodeURIComponent(property.id)}`;
        footer.append(price, link);
        content.append(status, title, location, description, details);

        if (property.owner) {
            const owner = makeElement('p', 'recommendation-owner');
            owner.append(
                makeElement('span', 'property-owner-icon', '🏢'),
                makeElement('span', '', property.owner)
            );
            content.appendChild(owner);
        }

        content.append(footer);
        card.append(imageWrap, content);

        return card;
    };

    const filterFallback = (need, maxBudget) => fallbackProperties.filter((property) => {
        const typeMatches = !need || property.size === need;
        const budgetMatches = !maxBudget || property.monthlyRent <= maxBudget;
        return typeMatches && budgetMatches && property.status === 'Available';
    });

    const renderRecommendations = (properties) => {
        const recommendations = properties.filter((property) => property.status === 'Available');
        const typeLabel = labels[activeNeed] || 'available homes';

        elements.results.replaceChildren(
            ...recommendations.map(createRecommendationCard)
        );
        elements.count.textContent = `${recommendations.length} ${recommendations.length === 1 ? 'match' : 'matches'}`;
        elements.status.textContent = activeNeed
            ? `Showing ${typeLabel} for you.`
            : 'Showing all currently available homes.';
        elements.title.textContent = activeNeed
            ? `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)}`
            : 'Recommended homes';
        elements.empty.hidden = recommendations.length > 0;
    };

    const loadRecommendations = async () => {
        const maxBudget = Number(elements.budget.value) || 0;
        const query = new URLSearchParams();

        if (activeNeed) {
            query.set('type', activeNeed);
        }

        if (maxBudget) {
            query.set('maxBudget', String(maxBudget));
        }

        elements.status.textContent = 'Finding the best matches…';
        elements.count.textContent = '';

        try {
            const response = await fetch(`/api/properties/recommend?${query.toString()}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`Recommendation request failed with status ${response.status}`);
            }

            renderRecommendations(await response.json());
        } catch (error) {
            renderRecommendations(filterFallback(activeNeed, maxBudget));
        }
    };

    const setActiveChip = (need) => {
        activeNeed = need;
        elements.chips.forEach((chip) => {
            const isActive = chip.dataset.need === need;
            chip.classList.toggle('active', isActive);
            chip.setAttribute('aria-pressed', String(isActive));
        });
    };

    elements.chips.forEach((chip) => {
        chip.addEventListener('click', () => {
            setActiveChip(chip.dataset.need || '');
            loadRecommendations();
        });
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        loadRecommendations();
    });

    setActiveChip('');
    loadRecommendations();
})();
