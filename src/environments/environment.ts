const runtime = (window as Record<string, any>)['env'] || {};
const backend = runtime['backend']
  || `${window.location.protocol}//${window.location.host}/powerguard-bcknd/api/`;

export const environment = {
  production: true,
  apiUrl: `${backend}`,
  version: '261014k',
};
