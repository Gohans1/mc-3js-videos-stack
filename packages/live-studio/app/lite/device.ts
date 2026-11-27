export const PHONE_QUERY =
  "(pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 599px)";

export const isPhoneViewport = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(PHONE_QUERY).matches;
};

export const syncPhoneDataset = (): boolean => {
  const phone = isPhoneViewport();
  if (typeof document !== "undefined" && document.documentElement?.dataset) {
    if (phone) document.documentElement.dataset.phone = "true";
    else delete document.documentElement.dataset.phone;
  }
  return phone;
};
