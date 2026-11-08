// The kit's one random number: the same n and k always give the same value in [0, 1), so a film plays the same every time
// and every render matches the studio. The modules seed their own streams with k. Changing this formula re-times every blink,
// glance and sigh a film was reviewed with.
export const hash = (n: number, k = 0) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
