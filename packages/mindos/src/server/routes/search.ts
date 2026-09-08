import { handleSearch } from '../handlers/search.js';
import { handleSearchPrewarm } from '../handlers/search-prewarm.js';
import { defineRoutes } from '../route-table.js';

export const searchRoutes = defineRoutes([
  { id: 'search', method: 'GET', path: '/api/search', auth: 'required',
    handler: ({ query, services }) => handleSearch(query, services) },
  { id: 'search.prewarm', method: 'GET', path: '/api/search/prewarm', auth: 'required',
    handler: ({ services }) => handleSearchPrewarm(services) },
]);
