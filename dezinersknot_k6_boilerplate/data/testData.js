
export const testData = {
  client: {
    email: __ENV.CLIENT_EMAIL || 'k6journey_client1@yopmail.com',
    password: __ENV.CLIENT_PASSWORD || '',
  },
  designer: {
    email: __ENV.DESIGNER_EMAIL || 'k6journey_designer2@yopmail.com',
    password: __ENV.DESIGNER_PASSWORD || '',
  }
};
