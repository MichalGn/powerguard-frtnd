const runtime = (window as Record<string, any>)['env'] || {};
const backend = runtime['backend']
  || `${window.location.protocol}//${window.location.hostname}:8080/powerguard-bcknd/api/`;

export const environment = {
  production: false,
  apiUrl: `${backend}`,
  version: '261014k',
};
