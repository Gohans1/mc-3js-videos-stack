import { useId } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CAPCUT_TONES } from "../../src/voice-playground-providers.mjs";
import type { PlaygroundVoiceOption } from "../../src/voice-playground.mjs";

export type ProviderCastingFilters = {
  language: string;
  gender: string;
  age: string;
  accent: string;
  useCase: string;
  emotion: string;
};
export const EMPTY_PROVIDER_FILTERS: ProviderCastingFilters = {
  language: "",
  gender: "",
  age: "",
  accent: "",
  useCase: "",
  emotion: "",
};
const MINI_ACCENTS = ["EN-British", "EN-US (General)", "EN-Australian", "US (General)", "Standard"];
const MINI_ROLES = [
  "Anime & Animation",
  "Audio Drama",
  "Audiobooks & Novels",
  "Character Dubbing",
  "Character Voice Acting",
  "Commercials & Trailers",
  "Corporate & Narration",
  "Documentary",
  "E-Learning",
  "Games & RPG",
  "Online Education",
  "Podcast & Social Media",
  "Podcasts & Social",
];

export function VoiceProviderFilters({
  provider,
  value,
  onChange,
  languages,
  voices = [],
}: {
  provider: "minimax" | "capcut";
  value: ProviderCastingFilters;
  onChange: (value: ProviderCastingFilters) => void;
  languages: readonly { code: string; name: string }[];
  voices?: readonly PlaygroundVoiceOption[];
}) {
  const uid = useId();
  const ages = Array.from(
    new Set([
      "Child",
      "Young",
      "Youth",
      "Middle-aged",
      "Elderly",
      ...voices.flatMap((voice) => (voice.age ? [voice.age] : [])),
      ...value.age
        .split(",")
        .map((age) => age.trim())
        .filter(Boolean),
    ]),
  );
  const fields = [
    {
      key: "language",
      label: "Language",
      items: languages.map((language) => ({ value: language.code, label: language.name })),
    },
    {
      key: "gender",
      label: "Gender",
      items: (provider === "capcut"
        ? ["Male", "Female", "Gender Diversity"]
        : ["Male", "Female"]
      ).map((option) => ({ value: option, label: option })),
    },
    ...(provider === "capcut"
      ? [
          {
            key: "age",
            label: "Age",
            items: ["Elderly", "Middle-aged", "Teenager", "Children", "Baby", "No Age"].map(
              (option) => ({ value: option, label: option }),
            ),
          },
          {
            key: "emotion",
            label: "Emotion",
            items: [
              "Excited",
              "Plain",
              "Pleasure",
              "Shy",
              "Proud",
              "Admire",
              "Angery",
              "Sad",
              "Disgust",
              "Flattery",
              "Fear",
              "Embarrassing",
              "Confused",
            ].map((option) => ({ value: option, label: option === "Angery" ? "Angry" : option })),
          },
          {
            key: "accent",
            label: "Tone",
            items: CAPCUT_TONES.map((option) => ({ value: option, label: option })),
          },
        ]
      : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map(({ key, label, items }) => (
        <Field key={key} className="min-w-0">
          <FieldLabel variant="compact" htmlFor={`${uid}-${key}`}>
            {label}
          </FieldLabel>
          <Select
            items={[{ value: "all", label: `Any ${label.toLowerCase()}` }, ...items]}
            value={value[key as keyof ProviderCastingFilters] || "all"}
            onValueChange={(next) =>
              onChange({ ...value, [key]: next === "all" ? "" : (next ?? "") })
            }
          >
            <SelectTrigger size="sm" id={`${uid}-${key}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
              <SelectItem value="all">Any {label.toLowerCase()}</SelectItem>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ))}
      {provider === "minimax" && (
        <>
          <Field className="col-span-2 min-w-0">
            <FieldLabel variant="compact" htmlFor={`${uid}-age`}>
              Age (choose any)
            </FieldLabel>
            <Select
              multiple
              items={ages.map((age) => ({ value: age, label: age }))}
              value={value.age
                .split(",")
                .map((age) => age.trim())
                .filter(Boolean)}
              onValueChange={(next) => onChange({ ...value, age: next.join(",") })}
            >
              <SelectTrigger size="sm" id={`${uid}-age`} className="w-full">
                <SelectValue placeholder="Any age" />
              </SelectTrigger>
              <SelectContent finalFocus>
                {ages.map((age) => (
                  <SelectItem key={age} value={age}>
                    {age}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {(
            [
              {
                key: "accent",
                label: "Accent",
                options: Array.from(
                  new Set([
                    ...MINI_ACCENTS,
                    ...voices.flatMap((voice) => (voice.accent ? [voice.accent] : [])),
                  ]),
                ),
              },
              {
                key: "useCase",
                label: "Role",
                options: Array.from(
                  new Set([
                    ...MINI_ROLES,
                    ...voices.flatMap(
                      (voice) => voice.useCase?.split("·").map((role) => role.trim()) ?? [],
                    ),
                  ]),
                ),
              },
            ] as const
          ).map(({ key, label, options }) => (
            <Field key={key} className="min-w-0">
              <FieldLabel variant="compact" htmlFor={`${uid}-${key}`}>
                {label}
              </FieldLabel>
              <Input
                size="sm"
                id={`${uid}-${key}`}
                list={`${uid}-${key}-suggestions`}
                value={value[key]}
                placeholder={`Any ${label.toLowerCase()}`}
                onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              />
              <datalist id={`${uid}-${key}-suggestions`}>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </datalist>
            </Field>
          ))}
          <p className="text-muted-foreground col-span-2 max-w-[60ch] text-sm leading-relaxed text-pretty">
            Accent and role offer suggestions; type a different value if needed. Separate several
            roles with commas.
          </p>
        </>
      )}
    </div>
  );
}
