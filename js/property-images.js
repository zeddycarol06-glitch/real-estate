(() => {
    'use strict';

    const list = document.querySelector('#property-photos-list');
    const message = document.querySelector('#property-photos-message');

    if (!list || !message) {
        return;
    }

    const maxPhotos = 20;
    const maxPhotoBytes = 5 * 1024 * 1024;
    const allowedTypes = new Set(['image/jpeg', 'image/jfif', 'image/pjpeg', 'image/png', 'image/webp', 'image/gif']);
    let properties = [];

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

    const getImages = (property) => {
        const images = Array.isArray(property.images) ? property.images.filter(Boolean) : [];
        return images.length ? images : (property.image ? [property.image] : []);
    };

    const requestJson = async (url, options) => {
        const response = await fetch(url, {
            ...options,
            credentials: 'same-origin',
            headers: { Accept: 'application/json', ...(options?.headers || {}) }
        });

        if (response.status === 401) {
            window.location.replace('admin-login.html?reason=expired');
            throw new Error('Your admin session has expired. Sign in again to manage property photos.');
        }

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || 'The property photo request failed.');
        }
        return result;
    };

    const setMessage = (text, isError = false) => {
        message.textContent = text;
        message.classList.toggle('is-error', isError);
    };

    const render = () => {
        list.replaceChildren();

        properties.forEach((property) => {
            const images = getImages(property);
            const card = makeElement('article', 'property-photo-card');
            const heading = makeElement('div', 'property-photo-card-heading');
            const propertyName = makeElement('h3', '', property.name || 'Property');
            const photoCount = makeElement('span', 'property-photo-count', `${images.length} / ${maxPhotos} photos`);
            const uploadForm = document.createElement('form');
            const uploadLabel = makeElement('label', 'property-photo-upload');
            const uploadPrompt = makeElement('span', '', 'Add photos');
            const input = document.createElement('input');

            uploadForm.className = 'property-photo-form';
            uploadForm.method = 'post';
            uploadForm.enctype = 'multipart/form-data';
            uploadForm.action = `/api/properties/${encodeURIComponent(property.id)}/images`;
            uploadForm.addEventListener('submit', (event) => event.preventDefault());
            input.type = 'file';
            input.accept = 'image/jpeg,image/jfif,image/png,image/webp,image/gif,.jfif,.jpg,.jpeg,.png,.webp,.gif';
            input.multiple = true;
            input.name = 'image';
            input.setAttribute('aria-label', `Add photos for ${property.name}`);
            input.dataset.propertyId = property.id;
            uploadLabel.append(uploadPrompt, input);
            uploadForm.appendChild(uploadLabel);
            heading.append(propertyName, photoCount, uploadForm);
            card.appendChild(heading);

            const gallery = makeElement('div', 'property-photo-gallery');
            if (images.length) {
                images.forEach((source, index) => {
                    const item = makeElement('div', 'property-photo-item');
                    const image = document.createElement('img');
                    const remove = makeElement('button', 'property-photo-remove', 'Remove');
                    image.src = source;
                    image.alt = `${property.name} photo ${index + 1}`;
                    image.loading = 'lazy';
                    image.addEventListener('error', () => {
                        image.remove();
                        item.classList.add('is-unavailable');
                        item.prepend(makeElement('span', 'property-photo-unavailable', 'Image unavailable'));
                    }, { once: true });
                    remove.type = 'button';
                    remove.dataset.propertyId = property.id;
                    remove.dataset.imageIndex = String(index);
                    remove.setAttribute('aria-label', `Remove photo ${index + 1} from ${property.name}`);
                    item.append(image, remove);
                    gallery.appendChild(item);
                });
            } else {
                gallery.appendChild(makeElement('p', 'property-photo-empty', 'No photos added yet.'));
            }
            card.appendChild(gallery);
            list.appendChild(card);
        });

        if (!properties.length) {
            setMessage('No properties are available to manage.', true);
        } else {
            setMessage('Select one or more photos to add them to a property gallery.');
        }
    };

    const loadProperties = async () => {
        try {
            const result = await requestJson('/api/properties', { cache: 'no-store' });
            if (!Array.isArray(result)) {
                throw new Error('The properties request returned an invalid response.');
            }
            properties = result;
            render();
            return true;
        } catch (error) {
            setMessage(error.message || 'Could not load properties. Please refresh and try again.', true);
            return false;
        }
    };

    list.addEventListener('change', async (event) => {
        const input = event.target.closest('input[type="file"][data-property-id]');
        if (!input || !input.files?.length) {
            return;
        }

        const property = properties.find((item) => item.id === input.dataset.propertyId);
        if (!property) {
            setMessage('That property could not be found. Refresh the page and try again.', true);
            return;
        }

        const selected = Array.from(input.files);
        const remaining = maxPhotos - getImages(property).length;
        if (selected.length > remaining) {
            input.value = '';
            setMessage(`You can add up to ${remaining} more photo${remaining === 1 ? '' : 's'} to ${property.name}.`, true);
            return;
        }

        const unsupported = selected.find((file) => (
            !allowedTypes.has(file.type) && !/\.(jpe?g|jfif|png|webp|gif)$/i.test(file.name)
        ));
        if (unsupported) {
            input.value = '';
            setMessage('Use JPEG, PNG, WebP, or GIF photos.', true);
            return;
        }

        if (selected.some((file) => file.size > maxPhotoBytes)) {
            input.value = '';
            setMessage('Each photo must be 5 MB or smaller.', true);
            return;
        }

        const form = input.closest('form');
        if (!form) {
            setMessage('The photo upload form could not be found. Refresh the page and try again.', true);
            return;
        }

        input.disabled = true;
        try {
            for (const file of selected) {
                setMessage(`Uploading ${file.name} to ${property.name}…`);
                const formData = new FormData();
                formData.append('image', file);
                await requestJson(form.action, {
                    method: form.method,
                    body: formData
                });
            }
            if (await loadProperties()) {
                setMessage(`${selected.length} photo${selected.length === 1 ? '' : 's'} added to ${property.name}.`);
            }
        } catch (error) {
            await loadProperties();
            setMessage(error.message || 'The photo could not be uploaded.', true);
        } finally {
            input.value = '';
            input.disabled = false;
        }
    });

    list.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-property-id][data-image-index]');
        if (!button) {
            return;
        }

        const property = properties.find((item) => item.id === button.dataset.propertyId);
        if (!property) {
            setMessage('That property could not be found. Refresh the page and try again.', true);
            return;
        }

        button.disabled = true;
        try {
            await requestJson(
                `/api/properties/${encodeURIComponent(property.id)}/images/${encodeURIComponent(button.dataset.imageIndex)}`,
                { method: 'DELETE' }
            );
            await loadProperties();
            setMessage(`Photo removed from ${property.name}.`);
        } catch (error) {
            button.disabled = false;
            setMessage(error.message || 'The photo could not be removed.', true);
        }
    });

    loadProperties();
})();
