export const serviceCategories = [
  { id: 'utilities', label: 'Servicios públicos' },
  { id: 'mobile', label: 'Telefonía móvil' },
  { id: 'transport', label: 'Transporte' },
  { id: 'subscriptions', label: 'Suscripciones digitales' },
]

export const billableServices = [
  { id: 'water-eaab', category: 'utilities', name: 'Acueducto de Bogotá', referenceLabel: 'Número de contrato o referencia', referenceType: 'contract', preset: 'water' },
  { id: 'water-epm', category: 'utilities', name: 'EPM Agua', referenceLabel: 'Número de contrato o referencia', referenceType: 'contract', preset: 'water' },
  { id: 'electricity-enel', category: 'utilities', name: 'Enel Colombia', referenceLabel: 'Número de cliente o referencia', referenceType: 'contract', preset: 'electricity' },
  { id: 'electricity-epm', category: 'utilities', name: 'EPM Energía', referenceLabel: 'Número de contrato o referencia', referenceType: 'contract', preset: 'electricity' },
  { id: 'gas-vanti', category: 'utilities', name: 'Vanti Gas Natural', referenceLabel: 'Número de cuenta o referencia', referenceType: 'contract', preset: 'gas' },
  { id: 'gas-epm', category: 'utilities', name: 'EPM Gas', referenceLabel: 'Número de contrato o referencia', referenceType: 'contract', preset: 'gas' },
  { id: 'mobile-claro', category: 'mobile', name: 'Recarga Claro', referenceLabel: 'Número de celular', referenceType: 'phone', preset: 'mobile' },
  { id: 'mobile-movistar', category: 'mobile', name: 'Recarga Movistar', referenceLabel: 'Número de celular', referenceType: 'phone', preset: 'mobile' },
  { id: 'mobile-tigo', category: 'mobile', name: 'Recarga Tigo', referenceLabel: 'Número de celular', referenceType: 'phone', preset: 'mobile' },
  { id: 'mobile-wom', category: 'mobile', name: 'Recarga WOM', referenceLabel: 'Número de celular', referenceType: 'phone', preset: 'mobile' },
  { id: 'transport-tullave', category: 'transport', name: 'Recarga TuLlave', referenceLabel: 'Número de tarjeta TuLlave', referenceType: 'card', preset: 'transport' },
  { id: 'transport-civica', category: 'transport', name: 'Recarga Cívica', referenceLabel: 'Número de tarjeta Cívica', referenceType: 'card', preset: 'transport' },
  { id: 'transport-transcaribe', category: 'transport', name: 'Recarga TransCaribe', referenceLabel: 'Número de tarjeta o referencia', referenceType: 'card', preset: 'transport' },
  { id: 'subscription-netflix', category: 'subscriptions', name: 'Netflix', referenceLabel: 'Correo de la cuenta', referenceType: 'email', preset: 'subscription' },
  { id: 'subscription-spotify', category: 'subscriptions', name: 'Spotify', referenceLabel: 'Correo de la cuenta', referenceType: 'email', preset: 'subscription' },
  { id: 'subscription-disney', category: 'subscriptions', name: 'Disney+', referenceLabel: 'Correo de la cuenta', referenceType: 'email', preset: 'subscription' },
  { id: 'subscription-youtube', category: 'subscriptions', name: 'YouTube Premium', referenceLabel: 'Correo de la cuenta', referenceType: 'email', preset: 'subscription' },
  { id: 'subscription-max', category: 'subscriptions', name: 'Max', referenceLabel: 'Correo de la cuenta', referenceType: 'email', preset: 'subscription' },
]

export const mobileRechargePlans = {
  'mobile-claro': [
    { id: 'claro-3gb-9d', data: '3 GB', price: 11000, validity: '9 días' },
    { id: 'claro-5gb-15d', data: '5 GB', price: 18000, validity: '15 días' },
    { id: 'claro-10gb-30d', data: '10 GB', price: 32000, validity: '30 días' },
    { id: 'claro-20gb-30d', data: '20 GB', price: 50000, validity: '30 días' },
  ],
  'mobile-movistar': [
    { id: 'movistar-2gb-7d', data: '2 GB', price: 8000, validity: '7 días' },
    { id: 'movistar-5gb-15d', data: '5 GB', price: 16000, validity: '15 días' },
    { id: 'movistar-10gb-30d', data: '10 GB', price: 29000, validity: '30 días' },
    { id: 'movistar-20gb-30d', data: '20 GB', price: 45000, validity: '30 días' },
  ],
  'mobile-tigo': [
    { id: 'tigo-2gb-7d', data: '2 GB', price: 8000, validity: '7 días' },
    { id: 'tigo-5gb-15d', data: '5 GB', price: 15000, validity: '15 días' },
    { id: 'tigo-12gb-30d', data: '12 GB', price: 30000, validity: '30 días' },
    { id: 'tigo-20gb-30d', data: '20 GB', price: 46000, validity: '30 días' },
  ],
  'mobile-wom': [
    { id: 'wom-3gb-9d', data: '3 GB', price: 10000, validity: '9 días' },
    { id: 'wom-6gb-15d', data: '6 GB', price: 18000, validity: '15 días' },
    { id: 'wom-15gb-30d', data: '15 GB', price: 35000, validity: '30 días' },
    { id: 'wom-25gb-30d', data: '25 GB', price: 50000, validity: '30 días' },
  ],
}

export const serviceById = (id) => billableServices.find((service) => service.id === id)
export const rechargePlanById = (id) => Object.entries(mobileRechargePlans)
  .flatMap(([serviceId, plans]) => plans.map((plan) => ({ ...plan, serviceId })))
  .find((plan) => plan.id === id)
