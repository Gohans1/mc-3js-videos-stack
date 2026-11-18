export const PROVIDER_IDS = ["elevenlabs", "minimax", "capcut"];
export const providerForModel = (id = "") =>
  id === "capcut" ? "capcut" : id.startsWith("speech-") ? "minimax" : "elevenlabs";
export const defaultProviderModel = (provider) =>
  provider === "minimax" ? "speech-2.8-hd" : provider === "capcut" ? "capcut" : "eleven_v4";
export const languageForProvider = (provider, language, languages) =>
  provider === "minimax"
    ? languages.find((entry) => entry.code === language || entry.name === language)?.name ||
      language
    : languages.find((entry) => entry.name === language)?.code || language;

export const FALLBACK_PROVIDER_LANGUAGES = {
  minimax: [
    {
      code: "Afrikaans",
      name: "Afrikaans",
    },
    {
      code: "Arabic",
      name: "Arabic",
    },
    {
      code: "Bulgarian",
      name: "Bulgarian",
    },
    {
      code: "Cantonese",
      name: "Cantonese",
    },
    {
      code: "Catalan",
      name: "Catalan",
    },
    {
      code: "Chinese (Mandarin)",
      name: "Chinese (Mandarin)",
    },
    {
      code: "Croatian",
      name: "Croatian",
    },
    {
      code: "Czech",
      name: "Czech",
    },
    {
      code: "Danish",
      name: "Danish",
    },
    {
      code: "Dutch",
      name: "Dutch",
    },
    {
      code: "English",
      name: "English",
    },
    {
      code: "Filipino",
      name: "Filipino",
    },
    {
      code: "Finnish",
      name: "Finnish",
    },
    {
      code: "French",
      name: "French",
    },
    {
      code: "German",
      name: "German",
    },
    {
      code: "Greek",
      name: "Greek",
    },
    {
      code: "Hebrew",
      name: "Hebrew",
    },
    {
      code: "Hindi",
      name: "Hindi",
    },
    {
      code: "Hungarian",
      name: "Hungarian",
    },
    {
      code: "Indonesian",
      name: "Indonesian",
    },
    {
      code: "Italian",
      name: "Italian",
    },
    {
      code: "Japanese",
      name: "Japanese",
    },
    {
      code: "Korean",
      name: "Korean",
    },
    {
      code: "Malay",
      name: "Malay",
    },
    {
      code: "Norwegian",
      name: "Norwegian",
    },
    {
      code: "Nynorsk",
      name: "Nynorsk",
    },
    {
      code: "Persian",
      name: "Persian",
    },
    {
      code: "Polish",
      name: "Polish",
    },
    {
      code: "Portuguese",
      name: "Portuguese",
    },
    {
      code: "Romanian",
      name: "Romanian",
    },
    {
      code: "Russian",
      name: "Russian",
    },
    {
      code: "Slovak",
      name: "Slovak",
    },
    {
      code: "Slovenian",
      name: "Slovenian",
    },
    {
      code: "Spanish",
      name: "Spanish",
    },
    {
      code: "Swedish",
      name: "Swedish",
    },
    {
      code: "Tamil",
      name: "Tamil",
    },
    {
      code: "Thai",
      name: "Thai",
    },
    {
      code: "Turkish",
      name: "Turkish",
    },
    {
      code: "Ukrainian",
      name: "Ukrainian",
    },
    {
      code: "Vietnamese",
      name: "Vietnamese",
    },
  ],
  capcut: [
    {
      code: "zh",
      name: "Chinese",
    },
    {
      code: "en",
      name: "English",
    },
    {
      code: "id",
      name: "Indonesian",
    },
    {
      code: "ja",
      name: "Japanese",
    },
    {
      code: "pt",
      name: "Portuguese",
    },
    {
      code: "es",
      name: "Spanish",
    },
    {
      code: "th",
      name: "Thai",
    },
    {
      code: "vi",
      name: "Vietnamese",
    },
  ],
};

export function providerLanguageOptions(provider, catalog, model) {
  const choices =
    catalog.providerLanguages?.[provider] ??
    (provider === "elevenlabs" ? catalog.languages : FALLBACK_PROVIDER_LANGUAGES[provider]);
  if (!model?.languages?.length) return [...choices];
  const supported = new Set(
    model.languages.flatMap((language) =>
      [language.language_id, language.name].map((value) => value.toLowerCase()),
    ),
  );
  return choices.filter(
    (language) =>
      supported.has(language.code.toLowerCase()) || supported.has(language.name.toLowerCase()),
  );
}

export const CAPCUT_TONES = [
  "Gentle / Kind",
  "Cute",
  "Steady",
  "Freaky",
  "Terrorism",
  "Stupid",
  "Atmosphere",
  "Sexy",
  "Mysterious",
  "Magnetic",
  "Deep",
  "ASMR",
  "High",
  "Weak",
  "Technology",
  "Mistress",
  "Refreshing/Fierce",
  "Chinese Style",
  "Retro",
];
export function resolveProviderLanguage(provider, language, catalog, model) {
  const code = languageForProvider(provider, language, [
    ...(catalog.providerLanguages?.[provider] ?? []),
    ...catalog.languages,
  ]);
  if (
    (provider !== "elevenlabs" || model?.languages?.length) &&
    !providerLanguageOptions(provider, catalog, model).some(
      (option) =>
        option.code.toLowerCase() === code.toLowerCase() ||
        option.name.toLowerCase() === code.toLowerCase(),
    )
  )
    throw Object.assign(
      new Error(`${provider} does not support language ${language}; choose one from its catalog`),
      { status: 400 },
    );
  return code;
}
