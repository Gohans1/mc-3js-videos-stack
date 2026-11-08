// The search boxes (sounds, objects, notes): every word typed must begin a word of the item, so "hum" finds room_hum and
// "Humming" but not "thump". Words split at spaces, punctuation, "_" and camelCase; case and accents don't count, Vietnamese
// đ included (NFD leaves it whole), so "dap" finds "đập"
const words = (s: string) =>
  s.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export const matcher = (q: string) => {
  const want = words(q);
  return (text: string) => {
    if (!want.length) return true;
    const have = words(text);
    return want.every((w) => have.some((h) => h.startsWith(w)));
  };
};
