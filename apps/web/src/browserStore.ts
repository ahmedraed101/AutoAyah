import Dexie, { type Table } from "dexie";
import { ProjectSchema, projectName, type Project, type VideoConfig } from "@autoayah/core";

export type BrowserKeys = {
  pexels?: string;
  unsplash?: string;
  pixabay?: string;
  freesound?: string;
  qfClientId?: string;
  qfClientSecret?: string;
};

class AutoAyahDB extends Dexie {
  projects!: Table<Project, string>;
  keys!: Table<{ id: string } & BrowserKeys, string>;

  constructor() {
    super("autoayah");
    this.version(1).stores({
      projects: "id, updatedAt",
      keys: "id",
    });
  }
}

const db = new AutoAyahDB();

export const browserStore = {
  async listProjects(): Promise<Project[]> {
    return db.projects.orderBy("updatedAt").reverse().toArray();
  },
  /** Projects are named by their attributes; saving a video that already has a project updates that project. */
  async saveProject(input: { id?: string; config: VideoConfig }): Promise<Project> {
    const now = new Date().toISOString();
    const name = projectName(input.config);
    const sameName = (await db.projects.toArray()).find((p) => p.name === name);
    const id = sameName?.id ?? input.id ?? crypto.randomUUID();
    const existing = await db.projects.get(id);
    const project: Project = {
      id,
      name,
      config: input.config,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.projects.put(project);
    return project;
  },
  async deleteProject(id: string) {
    await db.projects.delete(id);
  },
  async getKeys(): Promise<BrowserKeys> {
    const { id: _id, ...keys } = (await db.keys.get("default")) ?? { id: "default" };
    return keys;
  },
  async setKeys(keys: BrowserKeys) {
    await db.keys.put({ id: "default", ...keys });
  },
  exportProject(project: Project) {
    return JSON.stringify(project, null, 2);
  },
  /** Validates an exported project; the import gets a fresh id so it never overwrites an existing one. */
  importProject(json: string): { config: VideoConfig } {
    const parsed = ProjectSchema.pick({ config: true }).safeParse(JSON.parse(json));
    if (!parsed.success) throw new Error(`Invalid project file: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
    return parsed.data;
  },
};
