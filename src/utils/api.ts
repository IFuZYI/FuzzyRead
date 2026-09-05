/**
 * Utility to construct API URLs using the configured environment variables (e.g. VITE_APP_URL)
 * Fallback to origin-relative paths for seamless same-domain hosting.
 */
export const getApiUrl = (path: string): string => {
  // If we are running in the AI Studio preview environment or localhost / 127.0.0.1,
  // we must use origin-relative paths to prevent sending requests to the production domain.
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isPreview = hostname.includes('ais-dev-') || 
                    hostname.includes('ais-pre-') || 
                    hostname.includes('localhost') || 
                    hostname.includes('127.0.0.1') || 
                    hostname === '';

  if (isPreview) {
    return path;
  }

  const baseUrl = ((import.meta as any).env?.VITE_APP_URL as string) || '';
  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const cleanPath = path.replace(/^\/+/, '');
    return `${cleanBase}/${cleanPath}`;
  }
  return path;
};
