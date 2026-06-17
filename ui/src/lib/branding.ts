export type BrandingConfig = {
  name: string;
  logoUrl: string;
  faviconUrl: string;
  welcomeTitle: string;
  welcomeMessage: string;
  hasCustomLogo: boolean;
};

export const DEFAULT_BRANDING: BrandingConfig = {
  name: "KiwiFS",
  logoUrl: "/kiwifs.png",
  faviconUrl: "/favicon.svg",
  welcomeTitle: "Welcome to KiwiFS",
  welcomeMessage:
    "Your knowledge base is ready. Get started by creating a page or exploring existing content.",
  hasCustomLogo: false,
};

/** Map workspace-relative asset paths to /raw/ URLs. */
export function resolveBrandingAssetUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("/") || url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `/raw/${url.replace(/^\.\//, "")}`;
}

export function resolveBranding(raw: {
  name?: string;
  logoUrl?: string;
  faviconUrl?: string;
  welcomeTitle?: string;
  welcomeMessage?: string;
}): BrandingConfig {
  const hasCustomLogo = Boolean(raw.logoUrl);
  return {
    name: raw.name || DEFAULT_BRANDING.name,
    logoUrl: raw.logoUrl
      ? resolveBrandingAssetUrl(raw.logoUrl)
      : DEFAULT_BRANDING.logoUrl,
    faviconUrl: raw.faviconUrl
      ? resolveBrandingAssetUrl(raw.faviconUrl)
      : DEFAULT_BRANDING.faviconUrl,
    welcomeTitle: raw.welcomeTitle || DEFAULT_BRANDING.welcomeTitle,
    welcomeMessage: raw.welcomeMessage || DEFAULT_BRANDING.welcomeMessage,
    hasCustomLogo,
  };
}
