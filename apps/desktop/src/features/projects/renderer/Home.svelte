<script lang="ts">
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import PermissionsPanel from "#features/recording/renderer/PermissionsPanel.svelte";
  import ProjectDeleteConfirmation from "./ProjectDeleteConfirmation.svelte";
  import type { Project } from "#project-document/domain/recording";
  import ProjectCard from "./ProjectCard.svelte";
  import Select from "@teamblocks.dev/chord-ui/Select.svelte";
  import TopBar from "#platform/renderer/TopBar.svelte";
  import HomeView from "@teamblocks.dev/chord-ui/home/HomeView.svelte";
  import ProjectsEmpty from "@teamblocks.dev/chord-ui/home/ProjectsEmpty.svelte";
  import { recorder } from "#features/recording/renderer/recorder.svelte";
  import type { MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { formatDuration } from "#shared/domain/format";
  import { projectStore } from "#project-document/renderer/projects.svelte";
  import { router } from "#platform/renderer/router.svelte";
  import { scrollState } from "#features/recording/renderer/scroll.svelte";
  import {
    highlightTranscriptMatch,
    MIN_SEARCH_LENGTH,
    type TranscriptHit,
  } from "#features/transcription/contracts/transcriptSearch";

  /** The menu bar panel: narrower, with the cells' menus opening beside it. Other screens open in the main window. */
  let { panel = false }: { panel?: boolean } = $props();

  type View = "grid" | "list";
  type Sort = "updated" | "created" | "name";

  const views: { value: View; label: string; icon: "apps" | "list" }[] = [
    { value: "grid", label: "Grid view", icon: "apps" },
    { value: "list", label: "List view", icon: "list" },
  ];
  const sorts: { value: Sort; label: string }[] = [
    { value: "updated", label: "Last updated" },
    { value: "created", label: "Date created" },
    { value: "name", label: "Name" },
  ];

  let deletingProjectId = $state<string | null>(null);
  let deletingProject = $derived(
    deletingProjectId ? projectStore.get(deletingProjectId) : undefined,
  );

  /** The project's actions, the same from its menu button and a right-click. */
  function projectActions(project: Project): MenuEntry[] {
    const directory = project.recordings.find((recording) => recording.directory)?.directory;
    return [
      {
        label: "Open project",
        onselect: () => {
          if (projectStore.get(project.id)) router.push({ name: "project", id: project.id });
        },
      },
      {
        label: "Show in folder",
        icon: "folder",
        disabled: !directory,
        onselect: () => {
          if (directory)
            void window.chord.desktop.recording.reveal(directory.split("/").slice(0, -1).join("/"));
        },
      },
      "separator",
      {
        label: "Delete project",
        icon: "trash",
        destructive: true,
        onselect: () => {
          if (projectStore.get(project.id)) deletingProjectId = project.id;
        },
      },
    ];
  }

  let query = $state("");
  let view = $state<View>("grid");
  let sort = $state<Sort>("updated");
  let setup = $derived(projectStore.defaults);

  let visible = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return projectStore.projects
      .filter(
        (p) =>
          !needle ||
          [p.name, ...p.notes.flatMap((page) => [page.title, page.body])].some((text) =>
            text.toLowerCase().includes(needle),
          ),
      )
      .toSorted((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  });

  /** Where the search is said in recordings, from the main process, which reads the transcripts. */
  let spoken = $state<(TranscriptHit & { snippet: ReturnType<typeof highlightTranscriptMatch> })[]>(
    [],
  );
  let mentions = $derived(
    spoken.flatMap((hit) => {
      const project = projectStore.get(hit.projectId);
      return project ? [{ hit, project }] : [];
    }),
  );

  $effect(() => {
    const needle = query.trim();
    if (needle.length < MIN_SEARCH_LENGTH) {
      spoken = [];
      return;
    }
    let stale = false;
    // Typing doesn't wait on the transcripts, and only the last search to finish is shown.
    const timer = setTimeout(() => {
      window.chord.desktop.transcription.search(needle).then(
        (hits) => {
          if (!stale)
            spoken = hits.map((hit) => ({
              ...hit,
              snippet: highlightTranscriptMatch(hit, needle),
            }));
        },
        () => {
          if (!stale) spoken = [];
        },
      );
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  function newProject() {
    const project = projectStore.create();
    router.push({ name: "project", id: project.id });
  }
</script>

<TopBar
  onLogoClick={panel
    ? () => {
        void window.chord.desktop.openMain({ name: "home" });
      }
    : undefined}
/>

<div class="flex-1 overflow-y-auto overscroll-contain" {@attach scrollState.track}>
  <HomeView
    {setup}
    {panel}
    side={panel ? desktop.menubar.side : undefined}
    onRecord={() => recorder.start(setup)}
    onNewProject={newProject}
  >
    {#snippet notice()}<PermissionsPanel />{/snippet}
    {#snippet projects()}
      {#if !projectStore.loaded}
        <!-- Arrives from the main process right after the window opens. -->
      {:else if projectStore.projects.length > 0}
        <div class={["flex flex-wrap items-center", panel ? "mt-3 gap-2" : "mt-4 gap-3"]}>
          <div class={["relative min-w-0", panel ? "h-8 basis-full" : "h-9 flex-[2_1_16rem]"]}>
            <Icon
              name="search"
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-glass-500"
            />
            <input
              class={[
                "size-full rounded-lg border border-glass-800 bg-transparent pr-3 pl-9 text-neutral-100 placeholder:text-glass-600",
                panel ? "text-xs" : "text-sm",
              ]}
              placeholder="Search projects, notes, and recordings"
              aria-label="Search projects, notes, and recordings"
              bind:value={query}
            />
          </div>
          <div
            class={[
              "flex min-w-0 items-center",
              panel ? "basis-full gap-2" : "flex-[1_1_13rem] gap-3",
            ]}
          >
            <Select
              bind:value={sort}
              options={sorts}
              label="Sort"
              compact={panel}
              overlay={panel}
              class={panel ? "h-8!" : ""}
            />
            <div
              class={[
                "flex shrink-0 items-center rounded-lg border border-glass-800 p-0.5",
                panel ? "h-8" : "h-9",
              ]}
              role="group"
              aria-label="Project view"
            >
              {#each views as option (option.value)}
                <button
                  class={[
                    "flex h-full items-center justify-center rounded-md transition",
                    panel ? "w-7" : "w-8",
                    view === option.value
                      ? "bg-glass-800 text-neutral-100"
                      : "text-glass-500 hover:text-glass-300",
                  ]}
                  aria-label={option.label}
                  aria-pressed={view === option.value}
                  title={option.label}
                  onclick={() => (view = option.value)}
                >
                  <Icon name={option.icon} class="size-4" />
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      {#if !projectStore.loaded}
        <!-- Nothing yet. -->
      {:else if projectStore.projects.length === 0}
        <ProjectsEmpty compact={panel} onNewProject={newProject} />
      {:else if visible.length === 0 && mentions.length === 0}
        <div class="mt-12 text-center text-sm text-glass-500">No projects match.</div>
      {/if}

      {#if projectStore.loaded && projectStore.projects.length > 0 && visible.length > 0}
        <div
          data-projects
          class={[
            panel ? "mt-3" : "mt-5",
            view === "list"
              ? "flex flex-col divide-y divide-glass-800"
              : [
                  "grid",
                  panel
                    ? "grid-cols-1 gap-y-4"
                    : "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-5 gap-y-7",
                ],
          ]}
        >
          {#each visible as project (project.id)}
            <ProjectCard
              {project}
              {view}
              compact={panel}
              onclick={(time) => router.push({ name: "project", id: project.id, time })}
              actions={panel ? undefined : () => projectActions(project)}
            />
          {/each}
        </div>
      {/if}

      {#if projectStore.loaded && mentions.length > 0}
        <h3 class={["font-medium text-neutral-100", panel ? "mt-5 text-sm" : "mt-8 text-base"]}>
          In recordings
        </h3>
        <ul
          class={["flex flex-col divide-y divide-glass-800", panel ? "mt-1" : "mt-2"]}
          aria-label="Matches in recordings"
        >
          {#each mentions as { hit, project }, index (`${hit.recordingId}:${hit.time}:${index}`)}
            <li class="relative transition-[background-color] hover:bg-glass-800/40">
              <!-- The whole row opens the recording; the project name opens the project, above that. -->
              <button
                class="flex w-full min-w-0 flex-col gap-1 py-2.5 text-left after:absolute after:inset-0"
                onclick={() =>
                  router.push({
                    name: "project",
                    id: project.id,
                    recording: { id: hit.recordingId, time: hit.time },
                  })}
              >
                <span class={["min-w-0 truncate text-glass-400", panel ? "text-xs" : "text-sm"]}>
                  {hit.snippet.before}<mark class="bg-transparent font-medium text-neutral-100"
                    >{hit.snippet.match}</mark
                  >{hit.snippet.after}
                </span>
                <span class="flex min-w-0 items-center gap-3 text-xs text-glass-500">
                  <span class="invisible truncate">{project.name || "Untitled project"}</span>
                  <span class="shrink-0 tabular-nums">{formatDuration(hit.time)}</span>
                </span>
              </button>
              <button
                class="absolute bottom-2.5 left-0 z-10 max-w-[60%] truncate text-xs text-glass-500 hover:text-neutral-100 hover:underline"
                onclick={() => router.push({ name: "project", id: project.id })}
              >
                {project.name || "Untitled project"}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </HomeView>
</div>

{#if deletingProject}
  <ProjectDeleteConfirmation project={deletingProject} onclose={() => (deletingProjectId = null)} />
{/if}
