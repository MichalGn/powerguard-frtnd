const env = ((window as Record<string, any>)['env'] || {});

const backend = env['backend'] || `${window.location.origin}/powerguard-bcknd/api/`;

export const environment = {
  production: true,
  version: '261014k',
  apiUrl: `${backend}`
};
