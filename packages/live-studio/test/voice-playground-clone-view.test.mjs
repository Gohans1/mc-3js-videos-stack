import { expect, test } from "bun:test";

import { cloneVoiceOption, visibleCloudClones } from "../src/voice-playground-clone-view.mjs";

test("casting never advertises an old preview after a shared cloud clone was recreated", () => {
  const record = {
    id: "local",
    remoteId: "cloud",
    phase: "ready",
    scope: "global",
    settings: { name: "Me", language: "Vietnamese" },
    sampleAudioFile: "old.wav",
    previewStale: true,
  };
  expect(cloneVoiceOption(record).previewUrl).toBeUndefined();
  expect(cloneVoiceOption({ ...record, previewStale: false }).previewUrl).toContain("old.wav");
});

test("cloud clone discovery exposes current project, Global and unassigned voices, while excluding another project's voices", () => {
  const cloud = [{ id: "a" }, { id: "b" }, { id: "global" }, { id: "unassigned" }];
  const bindings = [
    { remoteId: "a", scope: "project", projectKey: "film-a" },
    { remoteId: "b", scope: "project", projectKey: "film-b" },
    { remoteId: "global", scope: "global" },
  ];
  expect(
    visibleCloudClones(cloud, bindings, { scope: "project", projectKey: "film-a" }).map(
      (voice) => voice.id,
    ),
  ).toEqual(["a", "global", "unassigned"]);
  expect(
    visibleCloudClones(cloud, bindings, { scope: "project", projectKey: "film-b" }).map(
      (voice) => voice.id,
    ),
  ).toEqual(["b", "global", "unassigned"]);
  expect(
    visibleCloudClones(cloud, bindings, { scope: "global", projectKey: "film-a" }).map(
      (voice) => voice.id,
    ),
  ).toEqual(["global", "unassigned"]);
  expect(
    visibleCloudClones(cloud, [...bindings, { remoteId: "a", scope: "global" }], {
      scope: "project",
      projectKey: "film-b",
    }).map((voice) => voice.id),
  ).toEqual(["a", "b", "global", "unassigned"]);
});
