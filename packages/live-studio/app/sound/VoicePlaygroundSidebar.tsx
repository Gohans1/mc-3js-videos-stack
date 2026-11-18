import {
  AudioLines,
  AudioWaveform,
  Bookmark,
  BookOpen,
  CircleAlert,
  Clock3,
  CloudDownload,
  Languages,
  Library,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  Star,
  TextCursorInput,
  Users,
} from "lucide-react";
import type { CSSProperties } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import type { ComposerDraft } from "./voice-playground-view";

export type PlaygroundPage =
  | ComposerDraft["mode"]
  | "voices"
  | "recordings"
  | "templates"
  | "favorites"
  | "archive"
  | "jobs"
  | "cloud"
  | "compare"
  | "help";
export const PLAYGROUND_PAGES: Record<
  PlaygroundPage,
  { label: string; description: string; icon: LucideIcon }
> = {
  tts: {
    label: "Speech",
    description: "Cast a voice, direct the performance, and keep every take.",
    icon: AudioLines,
  },
  dialogue: {
    label: "Dialogue",
    description: "Write the scene and give every character a voice.",
    icon: MessageSquare,
  },
  voice_changer: {
    label: "Voice changer",
    description: "Keep the performance. Try it with a different voice.",
    icon: AudioWaveform,
  },
  stt: {
    label: "Transcribe",
    description: "Turn speech into editable text, speaker turns and subtitles.",
    icon: TextCursorInput,
  },
  dubbing: {
    label: "Dubbing",
    description: "Translate a recording and keep its original, dubbed output and subtitles.",
    icon: Languages,
  },
  voices: {
    label: "Voices",
    description: "Find your cast across ElevenLabs, MiniMax, CapCut and your own voices.",
    icon: Users,
  },
  recordings: {
    label: "Recordings",
    description: "Listen, compare and use the takes worth keeping.",
    icon: Library,
  },
  templates: {
    label: "Templates",
    description: "Reusable voices, prompts and settings. Saving a template is free.",
    icon: Bookmark,
  },
  favorites: {
    label: "Favorites",
    description: "Your saved recordings and recipes, ready for another scene.",
    icon: Star,
  },
  archive: {
    label: "Archive",
    description: "Restore recordings and templates you moved out of the library.",
    icon: Library,
  },
  jobs: {
    label: "Jobs",
    description: "See what is running, what is ready and what needs attention.",
    icon: ListChecks,
  },
  cloud: {
    label: "Cloud recovery",
    description: "Check provider history and keep a local copy of work you need.",
    icon: CloudDownload,
  },
  compare: {
    label: "Compare",
    description: "Hear up to seven performances with one player.",
    icon: AudioWaveform,
  },
  help: {
    label: "Help & CLI",
    description: "Understand the tools, fees and recovery paths before you run them.",
    icon: BookOpen,
  },
};

export function VoicePlaygroundSidebar({
  page,
  projectName,
  running,
  needsAttention,
  onNavigate,
}: {
  page: PlaygroundPage;
  projectName: string;
  running: number;
  needsAttention: number;
  onNavigate: (page: PlaygroundPage, viaKeyboard: boolean) => void;
}) {
  const showJobCounts = running > 0 || needsAttention > 0;
  const groups: Array<{ label: string; pages: PlaygroundPage[] }> = [
    { label: "Daily tools", pages: ["tts", "voices", "compare", "recordings", "jobs"] },
    { label: "More tools", pages: ["dialogue", "voice_changer", "stt", "dubbing"] },
  ];
  return (
    <Sidebar
      collapsible="icon"
      motion="instant"
      className="absolute h-full"
      style={
        {
          "--sidebar-accent": "var(--tint)",
          "--sidebar-accent-foreground": "var(--primary-text)",
        } as CSSProperties
      }
      role="navigation"
      aria-label="Voice Playground navigation"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex min-h-12 items-center gap-3 py-1">
              <span className="bg-primary/15 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-lg">
                <AudioWaveform className="size-5" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5 group-data-[collapsible=icon]:hidden">
                <span className="text-foreground text-sm leading-tight font-semibold wrap-anywhere">
                  Voice Playground
                </span>
                <span className="text-muted-foreground truncate text-xs" title={projectName}>
                  {projectName}
                </span>
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="overflow-y-auto overscroll-contain">
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            {group.label !== "Daily tools" && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.pages.map((key) => {
                  const item = PLAYGROUND_PAGES[key],
                    Icon = item.icon,
                    mode =
                      key in PLAYGROUND_MODE_PRESENTATION
                        ? PLAYGROUND_MODE_PRESENTATION[key as ComposerDraft["mode"]]
                        : null;
                  const active =
                    page === key ||
                    (key === "jobs" && page === "cloud") ||
                    (key === "recordings" && ["favorites", "templates", "archive"].includes(page));
                  return (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton
                        id={`voice-playground-nav-${key}`}
                        type="button"
                        isActive={active}
                        aria-current={active ? "page" : undefined}
                        aria-describedby={
                          key === "jobs" && showJobCounts
                            ? "voice-playground-jobs-counts"
                            : undefined
                        }
                        onClick={(event) => onNavigate(key, event.detail === 0)}
                        tooltip={item.label}
                        size="wrapping"
                      >
                        <Icon
                          aria-hidden
                          className={page === key ? "text-primary-text" : mode?.text}
                        />
                        <span className="min-w-0 wrap-anywhere group-data-[collapsible=icon]:sr-only">
                          {item.label}
                        </span>
                        {key === "jobs" && showJobCounts && (
                          <span
                            aria-hidden="true"
                            className="ms-auto flex shrink-0 items-center gap-2 text-xs tabular-nums group-data-[collapsible=icon]:hidden"
                          >
                            {running > 0 && (
                              <span className="text-primary-text inline-flex items-center gap-1">
                                <Clock3 className="size-3" />
                                {running}
                              </span>
                            )}
                            {needsAttention > 0 && (
                              <span className="text-warn-text inline-flex items-center gap-1">
                                <CircleAlert className="size-3" />
                                {needsAttention}
                              </span>
                            )}
                          </span>
                        )}
                      </SidebarMenuButton>
                      {key === "jobs" && showJobCounts && (
                        <span id="voice-playground-jobs-counts" className="sr-only">
                          {running} running · {needsAttention} needing attention
                        </span>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Help & CLI"
              type="button"
              isActive={page === "help"}
              onClick={(event) => onNavigate("help", event.detail === 0)}
              size="comfortable"
            >
              <BookOpen />
              <span>Help & CLI</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
