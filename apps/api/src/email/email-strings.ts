// Every customer-facing email string (future i18n catalogue). No passport/DOB ever goes in an email.

export const EMAIL_STRINGS = {
  footer: (brand: string) => `You received this email because a booking was made on ${brand}.`,
  demoNote:
    'TEST BOOKING — this booking was made against test inventory and a test payment. No real ticket was issued and no real money was taken.',
  reference: 'Booking reference',
  pnr: 'Airline reference (PNR)',
  flights: 'Flights',
  passengers: 'Passengers',
  extras: 'Extras',
  totalPaid: 'Total paid',
  refundAmount: 'Refund amount',
  flight: (code: string, number: string) => `${code} ${number}`,
  greeting: (name: string) => `Hello ${name},`,
  signOff: (brand: string) => `— The ${brand} team`,

  confirmed: {
    subject: (brand: string, reference: string) => `${brand}: your booking ${reference} is confirmed`,
    heading: 'Your booking is confirmed',
    intro: 'Your flights are booked. Keep the references below — the airline reference (PNR) is what you show at check-in.',
  },
  refundInitiated: {
    subject: (brand: string, reference: string) => `${brand}: refund started for booking ${reference}`,
    heading: 'We have started a full refund',
    intro: {
      BOOKING_FAILED: "We couldn't confirm your ticket with the airline, so no ticket was issued. A full refund has been initiated.",
      LATE_PAYMENT: 'Your payment arrived after this fare had expired, so no ticket was issued. A full refund has been initiated.',
      DUPLICATE_PAYMENT: 'We received more than one payment for this booking. The extra payment is being refunded in full.',
    },
    timing: 'Refunds usually reach your account within 5–7 working days, depending on your bank.',
  },
  refundCompleted: {
    subject: (brand: string, reference: string) => `${brand}: your refund for booking ${reference} is complete`,
    heading: 'Your refund is complete',
    intro: 'The refund has been processed on our side. Depending on your bank it can take a few more days to appear on your statement.',
  },
} as const;
