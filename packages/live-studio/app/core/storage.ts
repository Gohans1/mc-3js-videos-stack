export const stored = {
  get: (key: string, area: Storage = localStorage) => {
    try {
      return area.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string, area: Storage = localStorage) => {
    try {
      area.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove: (key: string, area: Storage = localStorage) => {
    try {
      area.removeItem(key);
    } catch {}
  },
};
