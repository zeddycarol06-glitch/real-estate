/*
 * Offline copy of the property records served by GET /api/properties.
 *
 * Generated from data/properties.json so the two cannot drift apart by hand.
 * It keeps the public property pages usable when the server is unreachable
 * (opened straight from disk, or before the server has finished starting).
 * After editing data/properties.json, re-run the generator in the session
 * notes to refresh this file.
 */
(() => {
    'use strict';

    const properties = [
        {
            id: 'sunrise-residences',
            name: 'Sunrise Residences',
            location: 'Nairobi, Kenya',
            status: 'Available',
            type: 'Apartment',
            size: '3-bedroom',
            monthlyRent: 40000,
            price: 'KSh 40,000/month',
            beds: 3,
            baths: 2,
            parking: 'Parking',
            description: 'Spacious contemporary apartments close to shopping, transport, schools, and everyday amenities.',
            image: 'images/property2.jpg',
            alt: 'Luxury apartment at Sunrise Residences',
            owner: 'Savannah Homes Ltd',
            images: ['images/property2.jpg', 'images/interior-living.jpg', 'images/exterior-view.jpg'],
            availability: 'Available now',
            amenities: ['Covered parking', 'Elevator access', 'Backup generator', 'Gym and communal lounge']
        },
        {
            id: 'royal-homes-apartment',
            name: 'Royal Homes Apartment',
            location: 'Nairobi, Kenya',
            status: 'Available',
            type: 'Apartment',
            size: '2-bedroom',
            monthlyRent: 35000,
            price: 'KSh 35,000/month',
            beds: 2,
            baths: 2,
            parking: 'Parking',
            description: 'A modern two-bedroom apartment with bright interiors, secure access, and convenient access to shopping and transport routes.',
            image: 'images/property2.jpg',
            alt: 'Modern two-bedroom Royal Homes apartment',
            owner: 'Royal Homes Ltd',
            images: ['images/property2.jpg', 'images/interior-living.jpg', 'images/exterior-view.jpg'],
            availability: 'Available now',
            amenities: ['Secure compound', 'Covered parking', 'Backup water supply', 'Close to shops and transport']
        },
        {
            id: 'molo-bedsitter',
            name: 'Molo Bedsitter',
            location: 'Nairobi, Kenya',
            status: 'Available',
            type: 'Bedsitter',
            size: 'bedsitter',
            monthlyRent: 18000,
            price: 'KSh 18,000/month',
            beds: 1,
            baths: 1,
            parking: 'Parking',
            description: 'A neat and comfortable bedsitter with a functional layout, reliable water, and convenient access to transport.',
            image: 'images/bedsitter.jpg',
            alt: 'Comfortable Molo bedsitter apartment',
            owner: 'Savannah Homes Ltd',
            images: ['images/bedsitter.jpg', 'images/interior-living.jpg', 'images/exterior-view.jpg'],
            availability: 'Available now',
            amenities: ['Shared compound', 'Water tank backup', 'Near public transport', 'Wi-Fi-ready']
        },
        {
            id: 'eldoret-single-room',
            name: 'Eldoret Single Room',
            location: 'Eldoret, Kenya',
            status: 'Available',
            type: 'Single room',
            size: 'single-room',
            monthlyRent: 9000,
            price: 'KSh 9,000/month',
            beds: 1,
            baths: 1,
            parking: 'Street parking',
            description: 'A well-maintained single room suitable for a tenant looking for an affordable home close to essential services.',
            image: 'images/single-room.jpg',
            alt: 'Affordable single room rental in Eldoret',
            owner: 'Highlands Property Partners',
            images: ['images/single-room.jpg', 'images/interior-living.jpg', 'images/exterior-view.jpg'],
            availability: 'Available now',
            amenities: ['Water tank backup', 'Secure gate', 'Near shops', 'Shared courtyard']
        },
        {
            id: 'kasarani-one-bedroom',
            name: 'Kasarani One Bedroom',
            location: 'Nairobi, Kenya',
            status: 'Available',
            type: 'Apartment',
            size: '1-bedroom',
            monthlyRent: 30000,
            price: 'KSh 30,000/month',
            beds: 1,
            baths: 1,
            parking: 'Parking',
            description: 'A comfortable one-bedroom apartment with good natural light and convenient access to shops and transport.',
            image: 'images/one-bedroom.jpg',
            alt: 'Comfortable one-bedroom apartment in Kasarani',
            owner: 'Metro Rentals Kenya',
            images: ['images/one-bedroom.jpg', 'images/interior-living.jpg', 'images/exterior-view.jpg'],
            availability: 'Available now',
            amenities: ['Secure parking', 'Water tank backup', 'Near public transport', 'Shared laundry area']
        },
        {
            id: 'lakeside-family-residence',
            name: 'Lakeside Family Residence',
            location: 'Kisumu, Kenya',
            status: 'Available',
            type: 'Family home',
            size: '4-bedroom',
            monthlyRent: 65000,
            price: 'KSh 65,000/month',
            beds: 4,
            baths: 3,
            parking: 'Garage',
            description: 'A spacious family residence with generous bedrooms, a private garage, and beautiful views close to the lakeside amenities.',
            image: 'images/property4.jpg',
            alt: 'Spacious four-bedroom family residence near the lake',
            owner: 'Lakeside Ventures',
            images: ['images/property4.jpg', 'images/interior-living.jpg', 'images/exterior-view.jpg'],
            availability: 'Available now',
            amenities: ['Private garage', 'Garden and patio', 'Borehole backup', 'Gated community']
        }
    ];

    window.EstateProProperties = properties;
})();
