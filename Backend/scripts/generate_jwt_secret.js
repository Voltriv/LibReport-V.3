// Prints a strong random JWT secret for .env
const crypto = require('node:crypto');

function gen(len = 48) {
  return crypto.randomBytes(len).toString('base64url');
}

if (require.main === module) {
  const secret = gen(48);
  console.log('Add this to Backend/.env on ALL PCs:');
  console.log('');
  console.log(`JWT_SECRET=${secret}`);
  console.log('');
  console.log('Keep the same value everywhere so tokens work across machines.');
}

module.exports = { gen };

