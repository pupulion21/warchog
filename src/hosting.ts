// Vercel serves the playable frontend; online rooms still require the Node backend.
// Local development and standalone hosting retain all server-backed modes.
export const staticHosting = import.meta.env.VITE_WARCHOG_STATIC_HOST === 'true';
export const onlineUnavailable = 'Online duels are coming soon on this site. Play Training or VS Computer for now.';
