export const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim() ?? '';
export const mobileWalletConnectionConfigured = reownProjectId.length > 0;
