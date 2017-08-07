export const API_URL = 'https://backend';
console.log(process.env);

if (!API_URL) {
  console.error('Set `API_URL` in `app/js/actions/index.js` to your deployed endpoint');
}
